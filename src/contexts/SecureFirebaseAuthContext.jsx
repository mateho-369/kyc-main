import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import { 
  onAuthStateChanged,
  signOut
} from 'firebase/auth';
import { auth } from '../config/firebase';

// セキュアな認証コンテキスト
const SecureFirebaseAuthContext = createContext({});

// カスタムフック
export const useSecureFirebaseAuth = () => {
  const context = useContext(SecureFirebaseAuthContext);
  if (!context) {
    throw new Error('useSecureFirebaseAuth must be used within SecureFirebaseAuthProvider');
  }
  return context;
};

// セキュリティ設定
const SECURITY_CONFIG = {
  // トークンはメモリ内のみで管理（localStorage使用禁止）
  tokenStorage: 'memory',
  // HTTPS必須
  requireHttps: true,
  // トークン更新間隔（50分）
  tokenRefreshInterval: 50 * 60 * 1000,
  // セッションタイムアウト（2時間）
  sessionTimeout: 2 * 60 * 60 * 1000,
  // 最大ログイン試行回数
  maxLoginAttempts: 5,
  // ログイン試行のクールダウン時間（15分）
  loginCooldownPeriod: 15 * 60 * 1000
};

export const SecureFirebaseAuthProvider = ({ children }) => {
  // 認証状態（メモリ内管理）
  const [authState, setAuthState] = useState({
    user: null,
    idToken: null,
    loading: true,
    error: null,
    lastActivity: null
  });

  // ログイン試行の追跡（メモリ内管理）
  const [loginAttempts, setLoginAttempts] = useState({
    count: 0,
    lastAttempt: null,
    isLocked: false
  });

  // トークン更新タイマー
  const [tokenRefreshTimer, setTokenRefreshTimer] = useState(null);
  const [sessionTimer, setSessionTimer] = useState(null);

  // HTTPS チェック
  const checkHttps = useCallback(() => {
    if (SECURITY_CONFIG.requireHttps && window.location.protocol !== 'https:') {
      // 開発環境では警告のみ
      if (process.env.NODE_ENV === 'development') {
        console.warn('⚠️ セキュリティ警告: HTTPSを使用してください');
      } else {
        // 本番環境ではHTTPSにリダイレクト
        window.location.protocol = 'https:';
      }
    }
  }, []);

  // セキュアなトークン更新
  const refreshToken = useCallback(async (user) => {
    try {
      if (!user) return null;
      
      console.log('🔄 トークンを更新中...');
      const newToken = await user.getIdToken(true);
      
      setAuthState(prev => ({
        ...prev,
        idToken: newToken,
        lastActivity: Date.now()
      }));

      return newToken;
    } catch (error) {
      console.error('❌ トークン更新エラー:', error);
      setAuthState(prev => ({ ...prev, error: 'トークンの更新に失敗しました' }));
      return null;
    }
  }, []);

  // トークン更新タイマーの設定
  const setupTokenRefreshTimer = useCallback((user) => {
    // 既存のタイマーをクリア
    if (tokenRefreshTimer) {
      clearInterval(tokenRefreshTimer);
    }

    // 新しいタイマーを設定
    const timer = setInterval(() => {
      refreshToken(user);
    }, SECURITY_CONFIG.tokenRefreshInterval);

    setTokenRefreshTimer(timer);
  }, [tokenRefreshTimer, refreshToken]);

  // セッションタイムアウトの管理
  const resetSessionTimer = useCallback(() => {
    // 既存のタイマーをクリア
    if (sessionTimer) {
      clearTimeout(sessionTimer);
    }

    // 新しいタイマーを設定
    const timer = setTimeout(() => {
      console.warn('⏱️ セッションタイムアウト');
      handleLogout();
    }, SECURITY_CONFIG.sessionTimeout);

    setSessionTimer(timer);
    setAuthState(prev => ({ ...prev, lastActivity: Date.now() }));
  }, [sessionTimer]);

  // アクティビティ監視
  useEffect(() => {
    const handleActivity = () => {
      if (authState.user) {
        resetSessionTimer();
      }
    };

    // ユーザーアクティビティを監視
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(event => {
      window.addEventListener(event, handleActivity);
    });

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [authState.user, resetSessionTimer]);

  // ログイン試行の管理
  const checkLoginAttempts = useCallback(() => {
    const now = Date.now();
    
    // クールダウン期間のチェック
    if (loginAttempts.isLocked && loginAttempts.lastAttempt) {
      const timeSinceLastAttempt = now - loginAttempts.lastAttempt;
      
      if (timeSinceLastAttempt < SECURITY_CONFIG.loginCooldownPeriod) {
        const remainingTime = Math.ceil(
          (SECURITY_CONFIG.loginCooldownPeriod - timeSinceLastAttempt) / 1000 / 60
        );
        throw new Error(`ログイン試行回数が多すぎます。${remainingTime}分後に再試行してください。`);
      } else {
        // クールダウン期間が終了したらリセット
        setLoginAttempts({ count: 0, lastAttempt: null, isLocked: false });
      }
    }

    return true;
  }, [loginAttempts]);

  // ログイン試行の記録
  const recordLoginAttempt = useCallback((success) => {
    setLoginAttempts(prev => {
      if (success) {
        // ログイン成功時はリセット
        return { count: 0, lastAttempt: null, isLocked: false };
      }

      // 失敗時はカウントアップ
      const newCount = prev.count + 1;
      const isLocked = newCount >= SECURITY_CONFIG.maxLoginAttempts;
      
      return {
        count: newCount,
        lastAttempt: Date.now(),
        isLocked
      };
    });
  }, []);

  // 認証状態の監視
  useEffect(() => {
    checkHttps();

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          console.log('✅ ユーザー認証確認:', firebaseUser.email);
          
          // IDトークンを取得
          const idToken = await firebaseUser.getIdToken();
          
          // セキュアなユーザー情報のみを保存
          const secureUserInfo = {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            emailVerified: firebaseUser.emailVerified,
            // 機密情報は含めない
          };

          setAuthState({
            user: secureUserInfo,
            idToken: idToken,
            loading: false,
            error: null,
            lastActivity: Date.now()
          });

          // トークン更新とセッションタイマーを設定
          setupTokenRefreshTimer(firebaseUser);
          resetSessionTimer();
        } else {
          console.log('❌ ユーザー未認証');
          setAuthState({
            user: null,
            idToken: null,
            loading: false,
            error: null,
            lastActivity: null
          });

          // タイマーをクリア
          if (tokenRefreshTimer) clearInterval(tokenRefreshTimer);
          if (sessionTimer) clearTimeout(sessionTimer);
        }
      } catch (error) {
        console.error('認証状態確認エラー:', error);
        setAuthState(prev => ({
          ...prev,
          loading: false,
          error: '認証状態の確認に失敗しました'
        }));
      }
    });

    return () => {
      unsubscribe();
      if (tokenRefreshTimer) clearInterval(tokenRefreshTimer);
      if (sessionTimer) clearTimeout(sessionTimer);
    };
  }, [checkHttps, setupTokenRefreshTimer, resetSessionTimer]);

  // セキュアなログアウト
  const handleLogout = useCallback(async () => {
    try {
      console.log('👋 セキュアなログアウト処理開始');
      
      // Firebaseからログアウト
      await signOut(auth);
      
      // メモリから認証情報をクリア
      setAuthState({
        user: null,
        idToken: null,
        loading: false,
        error: null,
        lastActivity: null
      });

      // タイマーをクリア
      if (tokenRefreshTimer) clearInterval(tokenRefreshTimer);
      if (sessionTimer) clearTimeout(sessionTimer);

      // ログイン試行回数をリセット
      setLoginAttempts({ count: 0, lastAttempt: null, isLocked: false });

      console.log('✅ ログアウト完了');
    } catch (error) {
      console.error('❌ ログアウトエラー:', error);
      setAuthState(prev => ({ ...prev, error: 'ログアウトに失敗しました' }));
    }
  }, [tokenRefreshTimer, sessionTimer]);

  // 現在のIDトークンを取得（メモリから）
  const getIdToken = useCallback(() => {
    if (!authState.user || !authState.idToken) {
      throw new Error('認証されていません');
    }
    return authState.idToken;
  }, [authState]);

  // セキュリティ状態の取得
  const getSecurityStatus = useCallback(() => {
    return {
      isHttps: window.location.protocol === 'https:',
      isAuthenticated: !!authState.user,
      sessionActive: !!authState.lastActivity,
      loginLocked: loginAttempts.isLocked,
      remainingAttempts: SECURITY_CONFIG.maxLoginAttempts - loginAttempts.count
    };
  }, [authState, loginAttempts]);

  // コンテキストの値
  const value = {
    // 認証状態
    user: authState.user,
    loading: authState.loading,
    error: authState.error,
    isAuthenticated: !!authState.user,
    
    // セキュアなメソッド
    getIdToken,
    refreshToken: () => refreshToken(auth.currentUser),
    logout: handleLogout,
    
    // セキュリティ管理
    checkLoginAttempts,
    recordLoginAttempt,
    getSecurityStatus,
    
    // エラーをクリア
    clearError: () => setAuthState(prev => ({ ...prev, error: null }))
  };

  return (
    <SecureFirebaseAuthContext.Provider value={value}>
      {children}
    </SecureFirebaseAuthContext.Provider>
  );
};

export default SecureFirebaseAuthContext;