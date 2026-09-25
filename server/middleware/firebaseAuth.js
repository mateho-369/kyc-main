/**
 * Firebase認証ミドルウェア
 * Firebase AuthenticationによるSSO（シングルサインオン）を処理
 */

const admin = require('firebase-admin');
const { FirebaseUser, User } = require('../models');
const { validateToken } = require('../utils/tokenValidator');

/**
 * Firebase Admin SDKを初期化する。
 *
 * SharegramのSSOトークンは Sharegram のFirebaseプロジェクト
 * （例: adroit-standard-496710-r5）が発行する。この初期化が別のプロジェクトの
 * サービスアカウントで行われていると、verifyIdToken が必ず失敗して
 * 「Invalid token」になる。設定が不完全なときはサーバー全体を落とさず、
 * SSOエンドポイントが 503 FIREBASE_NOT_CONFIGURED を返すようにする。
 *
 * @returns {boolean} 初期化できたか
 */
const initializeFirebaseAdmin = () => {
  if (admin.apps.length) return true;

  if (process.env.DISABLE_FIREBASE === 'true') {
    console.warn('Firebase Admin SDK is disabled (DISABLE_FIREBASE=true)');
    return false;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      'Firebase Admin SDK is not configured: FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY are required for Sharegram SSO'
    );
    return false;
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey })
    });
    console.log('Firebase Admin SDK initialized for project:', projectId);
    return true;
  } catch (error) {
    console.error('Firebase Admin SDK initialization failed:', error.message);
    return false;
  }
};

initializeFirebaseAdmin();

/**
 * Firebase認証ユーザー用のランダムパスワードを生成する。
 *
 * Firebase SSOユーザーはパスワードでログインしないが、users.password は
 * NOT NULL かつ beforeCreate フックで bcrypt.hash() されるため、値が無いと
 * 「Cannot read properties of undefined」でユーザー作成そのものが失敗する。
 * 推測不能な値を入れておき、パスワードログインは事実上不可能にする。
 */
const generateUnusablePassword = () =>
  `firebase-sso:${require('crypto').randomBytes(32).toString('hex')}`;

/**
 * FirebaseUsers テーブル（同期用の写し）を更新する。
 *
 * このテーブルは Users とアソシエーションが定義されていないため
 * include は使えない。また写真URL等はバリデーションを持つので、
 * 書き込みに失敗してもログイン自体は止めない（ログのみ）。
 */
const upsertFirebaseUserMapping = async ({ uid, userId, email, name, picture, emailVerified, providerId }) => {
  try {
    const values = {
      userId,
      email,
      displayName: name || null,
      // photoURL は isUrl バリデーションを持つ。Sharegramのavatarは
      // 暗号化された文字列でURLではないため、URLのときだけ保存する。
      photoURL: /^https?:\/\//i.test(picture || '') ? picture : null,
      emailVerified: !!emailVerified,
      providerId: providerId || null,
      lastSyncedAt: new Date()
    };

    const [mapping, created] = await FirebaseUser.findOrCreate({
      where: { firebaseUid: uid },
      defaults: { firebaseUid: uid, ...values }
    });

    if (!created) {
      await mapping.update({
        ...values,
        userId: mapping.userId || userId,
        displayName: values.displayName || mapping.displayName,
        photoURL: values.photoURL || mapping.photoURL
      });
    }

    return mapping;
  } catch (error) {
    console.warn('FirebaseUser mapping could not be saved (login continues):', error.message);
    return null;
  }
};

/**
 * Firebaseトークンからユーザーを取得または作成する。
 *
 * 1. Firebase UID で既存ユーザーを探す
 * 2. 無ければメールアドレスで探す（Sharegramと同じメールなら同一人物）
 * 3. それでも無ければ新規作成
 *
 * どの経路でも「共有のテストユーザー」を返すことはない。
 *
 * @param {Object} decodedToken - デコードされたFirebaseトークン
 * @returns {Object} ユーザー情報
 */
const getOrCreateUserFromFirebase = async (decodedToken) => {
  const { uid, email, email_verified } = decodedToken;
  const name = decodedToken.name || decodedToken.displayName || null;
  const picture = decodedToken.picture || decodedToken.photoURL || null;
  const providerId = decodedToken.firebase?.sign_in_provider || 'custom';

  let user = await User.findOne({ where: { firebaseUid: uid } });
  if (!user && email) {
    user = await User.findOne({ where: { email } });
  }

  if (user) {
    await user.update({
      firebaseUid: uid,
      lastLoginAt: new Date(),
      emailVerified: user.emailVerified || !!email_verified
    });
    console.log('✅ Firebaseユーザーを既存アカウントに紐付け:', user.id, user.email);
  } else {
    user = await User.create({
      email,
      name: name || email.split('@')[0],
      role: 'user',
      isActive: true,
      emailVerified: !!email_verified,
      authProvider: 'firebase',
      // 次回のSSOで UID から直接引けるようにする（重複アカウント防止）
      firebaseUid: uid,
      lastLoginAt: new Date(),
      // users.password は NOT NULL かつ beforeCreate で bcrypt.hash() される。
      // 値が無いとユーザー作成そのものが失敗するため、推測不能な値を入れる。
      password: generateUnusablePassword()
    });
    console.log('✅ Firebaseユーザーを新規作成:', user.id, user.email);
  }

  await upsertFirebaseUserMapping({
    uid,
    userId: user.id,
    email: user.email,
    name: user.name,
    picture,
    emailVerified: email_verified,
    providerId
  });

  return user;
};

/**
 * リクエストからFirebase ID Token候補を優先順に取り出す。
 *
 * フロントエンドの /sso は SecureApiClient 経由で POST /api/auth/firebase-session
 * を叩く。axiosのインターセプターが localStorage に残った *ローカル* JWT を
 * Authorization ヘッダーに付けるため、ヘッダーだけを見るとSharegramが発行した
 * トークンが隠れてしまい "Invalid token" でSSOが失敗していた。
 * そこで ボディ → X-Firebase-Token → Authorization → クエリ の順に候補を集め、
 * Firebaseの検証を通った最初のものを使う。
 *
 * @param {Object} req - Expressリクエスト
 * @returns {Array<{token: string, source: string}>}
 */
const extractFirebaseIdTokenCandidates = (req) => {
  const candidates = [];

  const push = (token, source) => {
    if (typeof token === 'string' && token.trim().length > 0) {
      const value = token.trim();
      if (!candidates.some((candidate) => candidate.token === value)) {
        candidates.push({ token: value, source });
      }
    }
  };

  // 1) リクエストボディ（/sso が送る形）
  push(req.body?.idToken, 'body.idToken');
  push(req.body?.id_token, 'body.id_token');

  // 2) 専用ヘッダー（axiosインターセプターが付与する）
  push(req.headers?.['x-firebase-token'], 'header.X-Firebase-Token');

  // 3) Authorization: Bearer
  const authHeader = req.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    push(authHeader.slice('Bearer '.length), 'header.Authorization');
  }

  // 4) クエリパラメータ（後方互換・非推奨）
  push(req.query?.id_token, 'query.id_token');

  return candidates;
};

/**
 * Firebase認証ミドルウェア
 * @param {boolean} options.required - 認証が必須かどうか
 * @returns {Function} Expressミドルウェア
 */
const authenticateFirebase = (options = { required: true }) => {
  return async (req, res, next) => {
    // Firebaseが未設定のままリクエストを通すと、誰でも test@example.com
    // （Test User）としてログインできてしまう。開発環境であっても
    // 「認証済みのふり」をさせるのは危険なので、未設定は明示的に拒否する。
    if (process.env.DISABLE_FIREBASE === 'true' || !admin.apps.length) {
      console.error('Firebase Admin SDK is not initialized - rejecting Firebase authentication request');
      return res.status(503).json({
        success: false,
        error: 'Firebase authentication is not configured on this server',
        code: 'FIREBASE_NOT_CONFIGURED'
      });
    }

    const candidates = extractFirebaseIdTokenCandidates(req);

    if (candidates.length === 0) {
      if (options.required) {
        return res.status(401).json({
          success: false,
          error: 'No Firebase ID token provided',
          code: 'NO_TOKEN'
        });
      }
      return next();
    }

    if (candidates.some((candidate) => candidate.source === 'query.id_token')) {
      console.warn('⚠️ URLパラメータでのトークン送信は非推奨です。Authorizationヘッダーを使用してください。');
    }

    // 候補を順に検証し、SharegramのFirebaseプロジェクトが発行したトークンを
    // 見つける。全て失敗した場合は最初のエラーをそのまま返す。
    let decodedToken = null;
    let firstError = null;

    for (const candidate of candidates) {
      try {
        decodedToken = await admin.auth().verifyIdToken(candidate.token, true);
        req.firebaseTokenSource = candidate.source;
        break;
      } catch (error) {
        if (!firstError) firstError = error;
        console.warn(
          `Firebase token from ${candidate.source} was rejected: ${error.code || error.message}`
        );
      }
    }

    if (!decodedToken) {
      const error = firstError || new Error('Firebase authentication failed');
      console.error('Firebase authentication error:', error);

      if (error.code === 'auth/id-token-expired') {
        return res.status(401).json({
          success: false,
          error: 'Token has expired',
          code: 'TOKEN_EXPIRED'
        });
      }

      if (error.code === 'auth/id-token-revoked') {
        return res.status(401).json({
          success: false,
          error: 'Token has been revoked',
          code: 'TOKEN_REVOKED'
        });
      }

      if (error.code === 'auth/argument-error') {
        return res.status(400).json({
          success: false,
          error: 'Invalid token format',
          code: 'INVALID_TOKEN'
        });
      }

      return res.status(401).json({
        success: false,
        error: 'Authentication failed',
        code: 'AUTH_FAILED'
      });
    }

    try {
      // カスタムクレームをチェック（オプション）
      if (decodedToken.customClaims && decodedToken.customClaims.blocked) {
        return res.status(403).json({
          success: false,
          error: 'User account is blocked'
        });
      }

      // ユーザー情報を取得または作成
      const user = await getOrCreateUserFromFirebase(decodedToken);

      // リクエストオブジェクトにユーザー情報を追加
      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        firebaseUid: decodedToken.uid,
        isFirebaseAuth: true
      };

      req.firebaseToken = decodedToken;

      next();
    } catch (error) {
      console.error('Firebase user provisioning error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to provision the authenticated user',
        code: 'USER_PROVISIONING_FAILED'
      });
    }
  };
};

/**
 * Firebase認証とローカル認証の両方をサポートするハイブリッドミドルウェア
 */
const authenticateHybrid = () => {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: 'No authorization token provided'
      });
    }

    // Firebaseトークンかローカルトークンかを判定
    if (authHeader.includes('.') && authHeader.split('.').length === 3) {
      // JWTフォーマットの場合、Firebaseトークンの可能性が高い
      try {
        await authenticateFirebase({ required: true })(req, res, next);
      } catch (firebaseError) {
        // Firebaseで失敗した場合、ローカル認証を試みる
        const localAuth = require('./auth').authenticateToken;
        localAuth(req, res, next);
      }
    } else {
      // ローカルトークンとして処理
      const localAuth = require('./auth').authenticateToken;
      localAuth(req, res, next);
    }
  };
};

/**
 * Firebaseユーザーの権限を確認
 * @param {Array} requiredRoles - 必要な権限
 * @returns {Function} Expressミドルウェア
 */
const checkFirebaseRole = (requiredRoles = []) => {
  return async (req, res, next) => {
    try {
      if (!req.firebaseToken) {
        return res.status(403).json({
          success: false,
          error: 'Firebase authentication required'
        });
      }

      const { customClaims } = req.firebaseToken;
      const userRole = customClaims?.role || req.user.role || 'user';

      if (!requiredRoles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
          required: requiredRoles,
          current: userRole
        });
      }

      next();
    } catch (error) {
      console.error('Error checking Firebase role:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to verify permissions'
      });
    }
  };
};

/**
 * Firebaseカスタムクレームを設定
 * @param {string} uid - Firebase UID
 * @param {Object} claims - カスタムクレーム
 */
const setCustomClaims = async (uid, claims) => {
  try {
    await admin.auth().setCustomUserClaims(uid, claims);
    console.log(`Custom claims set for user ${uid}:`, claims);
  } catch (error) {
    console.error('Error setting custom claims:', error);
    throw error;
  }
};

/**
 * Firebaseユーザーを無効化
 * @param {string} uid - Firebase UID
 */
const disableFirebaseUser = async (uid) => {
  try {
    await admin.auth().updateUser(uid, {
      disabled: true
    });
    
    // ローカルDBも更新
    await FirebaseUser.update(
      { isActive: false },
      { where: { firebaseUid: uid } }
    );
    
    console.log(`Firebase user ${uid} has been disabled`);
  } catch (error) {
    console.error('Error disabling Firebase user:', error);
    throw error;
  }
};

/**
 * Firebaseユーザーを削除
 * @param {string} uid - Firebase UID
 */
const deleteFirebaseUser = async (uid) => {
  try {
    await admin.auth().deleteUser(uid);
    
    // ローカルDBからも削除
    await FirebaseUser.destroy({
      where: { firebaseUid: uid }
    });
    
    console.log(`Firebase user ${uid} has been deleted`);
  } catch (error) {
    console.error('Error deleting Firebase user:', error);
    throw error;
  }
};

/**
 * Firebaseセッションを取り消し
 * @param {string} uid - Firebase UID
 */
const revokeFirebaseTokens = async (uid) => {
  try {
    await admin.auth().revokeRefreshTokens(uid);
    
    const user = await admin.auth().getUser(uid);
    console.log(`Tokens revoked for user ${uid}. New tokens valid after: ${user.tokensValidAfterTime}`);
    
    return user.tokensValidAfterTime;
  } catch (error) {
    console.error('Error revoking Firebase tokens:', error);
    throw error;
  }
};

module.exports = {
  authenticateFirebase,
  authenticateHybrid,
  checkFirebaseRole,
  setCustomClaims,
  disableFirebaseUser,
  deleteFirebaseUser,
  revokeFirebaseTokens,
  getOrCreateUserFromFirebase
};