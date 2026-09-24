// Firebase統合サービス
const { 
  getUser,
  getUserByEmail,
  createUser,
  updateUser,
  auth,
  logger
} = require('../config/firebase-admin');
const { User, FirebaseUser } = require('../models');
const crypto = require('crypto');

class FirebaseIntegrationService {
  // 既存ユーザーのFirebase移行
  async migrateUserToFirebase(userId) {
    try {
      const localUser = await User.findByPk(userId);
      if (!localUser) {
        throw new Error('ローカルユーザーが見つかりません');
      }

      // 既にFirebaseユーザーが存在するかチェック
      let firebaseUser = await FirebaseUser.findOne({
        where: { userId: localUser.id }
      });

      if (firebaseUser) {
        logger.info('User already migrated to Firebase', { userId });
        return firebaseUser;
      }

      // Firebase側でユーザーが存在するかチェック
      let firebaseUserRecord = null;
      try {
        firebaseUserRecord = await getUserByEmail(localUser.email);
      } catch (error) {
        if (error.code !== 'auth/user-not-found') {
          throw error;
        }
      }

      // Firebase側にユーザーが存在しない場合は作成
      if (!firebaseUserRecord) {
        firebaseUserRecord = await createUser({
          email: localUser.email,
          displayName: localUser.name,
          password: crypto.randomBytes(32).toString('hex'), // 仮パスワード
          emailVerified: localUser.emailVerified || false
        });

        logger.info('Firebase user created during migration', {
          userId,
          firebaseUid: firebaseUserRecord.uid
        });
      }

      // FirebaseUserレコードを作成
      firebaseUser = await FirebaseUser.create({
        userId: localUser.id,
        firebaseUid: firebaseUserRecord.uid,
        email: firebaseUserRecord.email,
        displayName: firebaseUserRecord.displayName || localUser.name,
        photoURL: firebaseUserRecord.photoURL,
        phoneNumber: firebaseUserRecord.phoneNumber,
        emailVerified: firebaseUserRecord.emailVerified,
        providerId: 'password',
        customClaims: { role: localUser.role },
        firebaseMetadata: {
          creationTime: firebaseUserRecord.metadata.creationTime,
          lastSignInTime: firebaseUserRecord.metadata.lastSignInTime
        }
      });

      // カスタムクレームを設定
      await this.setUserRole(firebaseUserRecord.uid, localUser.role);

      logger.info('User successfully migrated to Firebase', {
        userId,
        firebaseUid: firebaseUserRecord.uid
      });

      return firebaseUser;

    } catch (error) {
      logger.error('User migration to Firebase failed', {
        userId,
        error: error.message
      });
      throw error;
    }
  }

  // 全ユーザーの一括移行
  async migrateAllUsersToFirebase() {
    try {
      // Firebase移行していないユーザーを取得
      const unmigrated = await User.findAll({
        where: {
          '$FirebaseUser.userId$': null
        },
        include: [{
          model: FirebaseUser,
          required: false
        }]
      });

      const results = {
        total: unmigrated.length,
        migrated: 0,
        failed: 0,
        errors: []
      };

      logger.info('Starting bulk user migration', { total: results.total });

      for (const user of unmigrated) {
        try {
          await this.migrateUserToFirebase(user.id);
          results.migrated++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            userId: user.id,
            email: user.email,
            error: error.message
          });
        }
      }

      logger.info('Bulk user migration completed', results);
      return results;

    } catch (error) {
      logger.error('Bulk user migration failed', { error: error.message });
      throw error;
    }
  }

  // Firebase→ローカルDB同期
  async syncFirebaseUserToLocal(firebaseUid) {
    try {
      // Firebase側からユーザー情報を取得
      const firebaseUserRecord = await getUser(firebaseUid);
      
      // ローカルDBのFirebaseUserレコードを取得または作成
      let [firebaseUser, created] = await FirebaseUser.findOrCreate({
        where: { firebaseUid },
        defaults: {
          firebaseUid,
          email: firebaseUserRecord.email || '',
          displayName: firebaseUserRecord.displayName || '',
          photoURL: firebaseUserRecord.photoURL,
          phoneNumber: firebaseUserRecord.phoneNumber,
          emailVerified: firebaseUserRecord.emailVerified,
          disabled: firebaseUserRecord.disabled,
          providerId: firebaseUserRecord.providerData?.[0]?.providerId || 'unknown',
          customClaims: firebaseUserRecord.customClaims || {},
          firebaseMetadata: {
            creationTime: firebaseUserRecord.metadata.creationTime,
            lastSignInTime: firebaseUserRecord.metadata.lastSignInTime
          }
        }
      });

      if (!created) {
        // 既存レコードの更新
        await firebaseUser.updateFromFirebase(firebaseUserRecord);
      }

      // ローカルユーザーとの同期
      await firebaseUser.syncWithLocalUser();

      return firebaseUser;

    } catch (error) {
      logger.error('Firebase to local sync failed', {
        firebaseUid,
        error: error.message
      });
      throw error;
    }
  }

  // カスタムクレーム（ロール）の設定
  async setUserRole(firebaseUid, role) {
    try {
      const customClaims = { role };
      
      // Firebase側でカスタムクレームを設定
      await auth.setCustomUserClaims(firebaseUid, customClaims);

      // ローカルDBも更新
      await FirebaseUser.update(
        { customClaims },
        { where: { firebaseUid } }
      );

      logger.info('User role set', { firebaseUid, role });
      return true;

    } catch (error) {
      logger.error('Failed to set user role', {
        firebaseUid,
        role,
        error: error.message
      });
      throw error;
    }
  }

  // ユーザーアカウントの無効化
  async disableUser(firebaseUid) {
    try {
      // Firebase側で無効化
      await updateUser(firebaseUid, { disabled: true });

      // ローカルDBも更新
      await FirebaseUser.update(
        { disabled: true },
        { where: { firebaseUid } }
      );

      logger.info('User disabled', { firebaseUid });
      return true;

    } catch (error) {
      logger.error('Failed to disable user', {
        firebaseUid,
        error: error.message
      });
      throw error;
    }
  }

  // ユーザーアカウントの有効化
  async enableUser(firebaseUid) {
    try {
      // Firebase側で有効化
      await updateUser(firebaseUid, { disabled: false });

      // ローカルDBも更新
      await FirebaseUser.update(
        { disabled: false },
        { where: { firebaseUid } }
      );

      logger.info('User enabled', { firebaseUid });
      return true;

    } catch (error) {
      logger.error('Failed to enable user', {
        firebaseUid,
        error: error.message
      });
      throw error;
    }
  }

  // Firebase→ローカルの一括同期
  async syncAllFirebaseUsers() {
    try {
      const results = {
        processed: 0,
        updated: 0,
        failed: 0,
        errors: []
      };

      // Firebase側の全ユーザーを取得（バッチ処理）
      let nextPageToken;
      do {
        const listUsersResult = await auth.listUsers(1000, nextPageToken);
        
        for (const userRecord of listUsersResult.users) {
          results.processed++;
          
          try {
            await this.syncFirebaseUserToLocal(userRecord.uid);
            results.updated++;
          } catch (error) {
            results.failed++;
            results.errors.push({
              firebaseUid: userRecord.uid,
              error: error.message
            });
          }
        }

        nextPageToken = listUsersResult.pageToken;
      } while (nextPageToken);

      logger.info('Firebase users sync completed', results);
      return results;

    } catch (error) {
      logger.error('Firebase users sync failed', { error: error.message });
      throw error;
    }
  }

  // データ整合性チェック
  async validateDataConsistency() {
    try {
      const issues = {
        orphanedFirebaseUsers: [],
        orphanedLocalUsers: [],
        emailMismatches: [],
        missingCustomClaims: []
      };

      // 孤立したFirebaseUserレコード（対応するLocalUserがない）
      const orphanedFirebase = await FirebaseUser.findAll({
        where: {
          '$localUser.id$': null
        },
        include: [{
          model: User,
          as: 'localUser',
          required: false
        }]
      });

      issues.orphanedFirebaseUsers = orphanedFirebase.map(fu => ({
        id: fu.id,
        firebaseUid: fu.firebaseUid,
        email: fu.email
      }));

      // Firebase移行していないローカルユーザー
      const orphanedLocal = await User.findAll({
        where: {
          '$FirebaseUser.userId$': null
        },
        include: [{
          model: FirebaseUser,
          required: false
        }]
      });

      issues.orphanedLocalUsers = orphanedLocal.map(u => ({
        id: u.id,
        email: u.email,
        name: u.name
      }));

      // メールアドレスの不一致
      const allFirebaseUsers = await FirebaseUser.findAll({
        include: [{
          model: User,
          as: 'localUser'
        }]
      });

      for (const fu of allFirebaseUsers) {
        if (fu.localUser && fu.email !== fu.localUser.email) {
          issues.emailMismatches.push({
            firebaseUserId: fu.id,
            firebaseEmail: fu.email,
            localEmail: fu.localUser.email
          });
        }

        // カスタムクレームの不一致
        if (fu.localUser && 
            (!fu.customClaims.role || fu.customClaims.role !== fu.localUser.role)) {
          issues.missingCustomClaims.push({
            firebaseUserId: fu.id,
            firebaseUid: fu.firebaseUid,
            expectedRole: fu.localUser.role,
            currentClaims: fu.customClaims
          });
        }
      }

      logger.info('Data consistency check completed', {
        orphanedFirebase: issues.orphanedFirebaseUsers.length,
        orphanedLocal: issues.orphanedLocalUsers.length,
        emailMismatches: issues.emailMismatches.length,
        missingCustomClaims: issues.missingCustomClaims.length
      });

      return issues;

    } catch (error) {
      logger.error('Data consistency check failed', { error: error.message });
      throw error;
    }
  }

  // データ修復
  async repairDataInconsistencies() {
    try {
      const issues = await this.validateDataConsistency();
      const repairResults = {
        repairedFirebaseUsers: 0,
        migratedLocalUsers: 0,
        fixedEmailMismatches: 0,
        fixedCustomClaims: 0,
        errors: []
      };

      // 孤立したFirebaseUserのLocalUser作成
      for (const orphaned of issues.orphanedFirebaseUsers) {
        try {
          const firebaseUser = await FirebaseUser.findByPk(orphaned.id);
          await firebaseUser.syncWithLocalUser();
          repairResults.repairedFirebaseUsers++;
        } catch (error) {
          repairResults.errors.push({
            type: 'orphaned_firebase_user',
            id: orphaned.id,
            error: error.message
          });
        }
      }

      // 孤立したLocalUserのFirebase移行
      for (const orphaned of issues.orphanedLocalUsers) {
        try {
          await this.migrateUserToFirebase(orphaned.id);
          repairResults.migratedLocalUsers++;
        } catch (error) {
          repairResults.errors.push({
            type: 'orphaned_local_user',
            id: orphaned.id,
            error: error.message
          });
        }
      }

      // カスタムクレームの修復
      for (const claim of issues.missingCustomClaims) {
        try {
          await this.setUserRole(claim.firebaseUid, claim.expectedRole);
          repairResults.fixedCustomClaims++;
        } catch (error) {
          repairResults.errors.push({
            type: 'custom_claims',
            firebaseUid: claim.firebaseUid,
            error: error.message
          });
        }
      }

      logger.info('Data repair completed', repairResults);
      return repairResults;

    } catch (error) {
      logger.error('Data repair failed', { error: error.message });
      throw error;
    }
  }
}

module.exports = new FirebaseIntegrationService();