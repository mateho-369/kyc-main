const admin = require('firebase-admin');
const { User, FirebaseUser, SharegramIntegration, sequelize } = require('../../models');
const { Op } = require('sequelize');
const EventEmitter = require('events');

class FirebaseSyncService extends EventEmitter {
  constructor() {
    super();
    this.isInitialized = false;
    this.syncInterval = null;
    this.syncInProgress = false;
  }

  /**
   * Firebase Admin SDK初期化
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
          })
        });
      }
      
      this.isInitialized = true;
      this.emit('initialized');
      console.log('Firebase同期サービスが初期化されました');
    } catch (error) {
      console.error('Firebase同期サービスの初期化エラー:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 単一ユーザーの同期
   */
  async syncUser(firebaseUid) {
    if (!this.isInitialized) await this.initialize();

    const transaction = await sequelize.transaction();

    try {
      // Firebaseからユーザー情報を取得
      const firebaseUserRecord = await admin.auth().getUser(firebaseUid);
      
      // FirebaseUserレコードを更新または作成
      let [firebaseUser, created] = await FirebaseUser.findOrCreate({
        where: { firebaseUid },
        defaults: {
          firebaseUid: firebaseUserRecord.uid,
          email: firebaseUserRecord.email || '',
          displayName: firebaseUserRecord.displayName || '',
          photoURL: firebaseUserRecord.photoURL || null,
          phoneNumber: firebaseUserRecord.phoneNumber || null,
          emailVerified: firebaseUserRecord.emailVerified || false,
          disabled: firebaseUserRecord.disabled || false,
          providerId: firebaseUserRecord.providerData?.[0]?.providerId || 'unknown',
          customClaims: firebaseUserRecord.customClaims || {},
          firebaseMetadata: {
            lastSignInTime: firebaseUserRecord.metadata.lastSignInTime,
            creationTime: firebaseUserRecord.metadata.creationTime,
            lastRefreshTime: firebaseUserRecord.metadata.lastRefreshTime
          }
        },
        transaction
      });

      if (!created) {
        // 既存レコードを更新
        await firebaseUser.updateFromFirebase(firebaseUserRecord);
      }

      // ローカルユーザーとの同期
      if (!firebaseUser.userId) {
        const localUser = await firebaseUser.syncWithLocalUser();
        this.emit('userLinked', { firebaseUser, localUser });
      } else {
        // 既存のローカルユーザー情報を更新
        const localUser = await User.findByPk(firebaseUser.userId, { transaction });
        if (localUser) {
          await localUser.update({
            emailVerified: firebaseUserRecord.emailVerified,
            lastLoginAt: new Date()
          }, { transaction });
        }
      }

      await transaction.commit();

      this.emit('userSynced', {
        firebaseUid,
        created,
        firebaseUser: firebaseUser.toJSON()
      });

      return { success: true, firebaseUser, created };

    } catch (error) {
      await transaction.rollback();
      console.error('ユーザー同期エラー:', error);
      this.emit('syncError', { firebaseUid, error });
      throw error;
    }
  }

  /**
   * バッチ同期（複数ユーザー）
   */
  async batchSync(pageSize = 100) {
    if (!this.isInitialized) await this.initialize();
    if (this.syncInProgress) {
      console.log('同期が既に進行中です');
      return;
    }

    this.syncInProgress = true;
    this.emit('batchSyncStarted');

    try {
      const results = {
        total: 0,
        created: 0,
        updated: 0,
        failed: 0,
        errors: []
      };

      let nextPageToken;
      
      do {
        // Firebaseからユーザーリストを取得
        const listUsersResult = await admin.auth().listUsers(pageSize, nextPageToken);
        
        results.total += listUsersResult.users.length;

        // 各ユーザーを同期
        for (const firebaseUser of listUsersResult.users) {
          try {
            const { created } = await this.syncUser(firebaseUser.uid);
            if (created) {
              results.created++;
            } else {
              results.updated++;
            }
          } catch (error) {
            results.failed++;
            results.errors.push({
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              error: error.message
            });
          }
        }

        nextPageToken = listUsersResult.pageToken;
        
        // 進捗を通知
        this.emit('batchSyncProgress', {
          processed: results.total,
          created: results.created,
          updated: results.updated,
          failed: results.failed
        });

      } while (nextPageToken);

      // 同期統合レコードを更新
      const integration = await SharegramIntegration.findOne({
        where: {
          integrationType: 'firebase',
          isActive: true
        }
      });

      if (integration) {
        await integration.updateSyncStatus('success');
      }

      this.emit('batchSyncCompleted', results);
      return results;

    } catch (error) {
      console.error('バッチ同期エラー:', error);
      this.emit('batchSyncError', error);
      throw error;
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * 差分同期（最終同期時刻以降の変更のみ）
   */
  async deltaSync() {
    if (!this.isInitialized) await this.initialize();

    try {
      // 最終同期時刻を取得
      const lastSync = await FirebaseUser.max('lastSyncedAt');
      const lastSyncTime = lastSync || new Date(0);

      // ローカルで変更されたユーザーを同期
      const localChangedUsers = await User.findAll({
        where: {
          updatedAt: { [Op.gt]: lastSyncTime },
          firebaseUid: { [Op.ne]: null }
        }
      });

      const results = {
        localToFirebase: 0,
        firebaseToLocal: 0,
        conflicts: []
      };

      // ローカル変更をFirebaseに反映
      for (const user of localChangedUsers) {
        try {
          await admin.auth().updateUser(user.firebaseUid, {
            displayName: user.name,
            emailVerified: user.emailVerified
          });
          results.localToFirebase++;
        } catch (error) {
          results.conflicts.push({
            userId: user.id,
            error: error.message
          });
        }
      }

      // Firebase側の変更を取得（WebhookやCloud Functionsと連携が理想）
      // ここでは簡易的に全ユーザーをチェック
      const firebaseUsers = await FirebaseUser.findAll({
        where: {
          lastSyncedAt: { [Op.lt]: new Date(Date.now() - 3600000) } // 1時間以上前
        },
        limit: 100
      });

      for (const fbUser of firebaseUsers) {
        try {
          await this.syncUser(fbUser.firebaseUid);
          results.firebaseToLocal++;
        } catch (error) {
          results.conflicts.push({
            firebaseUid: fbUser.firebaseUid,
            error: error.message
          });
        }
      }

      this.emit('deltaSyncCompleted', results);
      return results;

    } catch (error) {
      console.error('差分同期エラー:', error);
      this.emit('deltaSyncError', error);
      throw error;
    }
  }

  /**
   * リアルタイム同期の開始
   */
  startRealtimeSync(intervalMinutes = 5) {
    if (this.syncInterval) {
      console.log('リアルタイム同期は既に実行中です');
      return;
    }

    // 初回実行
    this.deltaSync().catch(console.error);

    // 定期実行
    this.syncInterval = setInterval(() => {
      this.deltaSync().catch(console.error);
    }, intervalMinutes * 60 * 1000);

    this.emit('realtimeSyncStarted', { intervalMinutes });
    console.log(`リアルタイム同期を開始しました（${intervalMinutes}分間隔）`);
  }

  /**
   * リアルタイム同期の停止
   */
  stopRealtimeSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      this.emit('realtimeSyncStopped');
      console.log('リアルタイム同期を停止しました');
    }
  }

  /**
   * カスタムクレームの同期
   */
  async syncCustomClaims(userId) {
    try {
      const user = await User.findByPk(userId);
      if (!user || !user.firebaseUid) {
        throw new Error('ユーザーが見つからないか、Firebaseユーザーではありません');
      }

      // カスタムクレームを設定
      const customClaims = {
        role: user.role,
        safevideo: true,
        permissions: user.role === 'admin' ? ['read', 'write', 'delete'] : ['read']
      };

      await admin.auth().setCustomUserClaims(user.firebaseUid, customClaims);

      // FirebaseUserレコードを更新
      await FirebaseUser.update(
        { customClaims },
        { where: { firebaseUid: user.firebaseUid } }
      );

      this.emit('customClaimsSynced', { userId, customClaims });
      return { success: true, customClaims };

    } catch (error) {
      console.error('カスタムクレーム同期エラー:', error);
      this.emit('customClaimsSyncError', { userId, error });
      throw error;
    }
  }

  /**
   * 同期統計の取得
   */
  async getSyncStats() {
    const stats = {
      totalFirebaseUsers: await FirebaseUser.count(),
      linkedUsers: await FirebaseUser.count({ where: { userId: { [Op.ne]: null } } }),
      unlinkedUsers: await FirebaseUser.count({ where: { userId: null } }),
      lastSyncTime: await FirebaseUser.max('lastSyncedAt'),
      syncStatus: this.syncInProgress ? 'syncing' : 'idle',
      realtimeSync: this.syncInterval ? 'active' : 'inactive'
    };

    return stats;
  }
}

// シングルトンインスタンス
const firebaseSyncService = new FirebaseSyncService();

module.exports = firebaseSyncService;