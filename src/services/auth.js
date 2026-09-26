import secureApiClient from './SecureApiClient';
import { auth } from '../config/firebase';
import { setAccessToken, clearAccessToken } from '../utils/authToken';

export const login = async (email, password) => {
  try {
    // Firebase認証を優先し、レガシーメソッドとして保持
    const response = await secureApiClient.post('/auth/login', { email, password });
    const { user, accessToken } = response.data;

    // accessTokenをlocalStorageに保存（Cookie送信問題の回避策）
    if (accessToken) {
      setAccessToken(accessToken);
      console.log('✅ アクセストークンをlocalStorageに保存');
    }

    console.log('✅ 通常ログイン成功');

    return user;
  } catch (error) {
    throw error.response?.data || { message: 'ログインに失敗しました' };
  }
};

export const logout = async () => {
  try {
    // SecureApiClientのログアウトメソッドを使用
    await secureApiClient.logout();

    // localStorageのトークンをクリア
    clearAccessToken();

    // Firebaseログアウトも実行
    if (auth.currentUser) {
      await auth.signOut();
    }

    console.log('✅ セキュアログアウト完了');
    return true;
  } catch (error) {
    console.error('ログアウトエラー:', error);
    // エラーがあってもクリーンアップを実行
    clearAccessToken();
    return true;
  }
};

export const checkAuth = async () => {
  try {
    // Firebase認証状態を優先チェック
    if (auth.currentUser) {
      return {
        uid: auth.currentUser.uid,
        email: auth.currentUser.email,
        displayName: auth.currentUser.displayName,
        authProvider: 'firebase'
      };
    }
    
    // レガシー認証チェック（SecureApiClientのセッション管理を使用）
    const response = await secureApiClient.get('/auth/me');
    return {
      ...response.data,
      authProvider: 'legacy'
    };
  } catch (error) {
    // 401エラーは未認証状態として正常
    if (error.response?.status === 401) {
      console.log('認証チェック: 未認証状態');
      return null;
    }
    // その他のエラーの場合のみthrow
    console.error('認証チェックエラー:', error);
    throw error;
  }
};

// ユーザーのロールを取得する関数（セキュア版）
export const getUserRole = async () => {
  try {
    // Firebase認証ユーザーの場合
    if (auth.currentUser) {
      // Firebase Custom Claimsからロールを取得
      const tokenResult = await auth.currentUser.getIdTokenResult();
      return tokenResult.claims.role || 'user';
    }
    
    // レガシー認証の場合はAPI経由でロールを取得
    const authData = await checkAuth();
    return authData?.role || 'user';
  } catch (error) {
    console.error('ロール取得エラー:', error);
    return 'user';
  }
};

/**
 * Firebase認証セッションの作成
 */
export const createFirebaseSession = async (idToken) => {
  try {
    const response = await secureApiClient.createFirebaseSession(idToken);
    console.log('✅ Firebaseセッション作成成功');
    return response;
  } catch (error) {
    console.error('❌ Firebaseセッション作成エラー:', error);
    throw error;
  }
};

/**
 * セキュリティ状態の取得
 */
export const getSecurityStatus = () => {
  return secureApiClient.getSecurityStatus();
};