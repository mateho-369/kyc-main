import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import { login, logout, checkAuth, createFirebaseSession } from '../services/auth';
import { auth, isMock } from '../config/firebase';
import { onAuthStateChanged as firebaseOnAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const initialized = useRef(false);
  const tokenRefreshTimer = useRef(null);
  const authStateChangeCallbacks = useRef([]);
  const forceEndLoadingTimer = useRef(null);
  const unsubscribe = useRef(null);

  const onAuthStateChange = (callback) => {
    authStateChangeCallbacks.current.push(callback);
    return () => {
      authStateChangeCallbacks.current = authStateChangeCallbacks.current.filter(cb => cb !== callback);
    };
  };

  const notifyAuthStateChange = (authenticated, userData) => {
    authStateChangeCallbacks.current.forEach(callback => {
      callback(authenticated, userData);
    });
  };

  const forceEndLoading = () => {
    if (forceEndLoadingTimer.current) {
      clearTimeout(forceEndLoadingTimer.current);
      forceEndLoadingTimer.current = null;
    }
    setLoading(prev => {
      if (prev) {
        console.warn('⏱️ Loading was force-ended to avoid spinner hang');
      }
      return false;
    });
  };

  const setAuthOk = (userData) => {
    setUser(userData);
    setIsAuthenticated(true);
    notifyAuthStateChange(true, userData);
    setupTokenRefreshTimer();
  };

  const setAuthNone = () => {
    setUser(null);
    setIsAuthenticated(false);
    notifyAuthStateChange(false, null);
  };

  const setupTokenRefreshTimer = () => {
    if (tokenRefreshTimer.current) {
      clearTimeout(tokenRefreshTimer.current);
    }
    tokenRefreshTimer.current = setTimeout(async () => {
      try {
        console.log('🔄 トークンの自動リフレッシュを実行');
        const userData = await checkAuth();
        if (userData) {
          setUser(userData);
          setIsAuthenticated(true);
          setupTokenRefreshTimer();
        }
      } catch (error) {
        console.error('❌ トークンリフレッシュエラー:', error);
        if (error.response?.status === 401) {
          setAuthNone();
        }
      }
    }, 10 * 60 * 1000);
  };

  const doLegacyCheck = async () => {
    // /sso では SSOPage 自身がSharegramのFirebaseトークンを交換してログインする。
    // ここで並行して /auth/me を確認すると、SSO成功 *後* に401応答が返ってきて
    // せっかく認証したユーザーを null に戻してしまう（ログイン直後にログアウト
    // される症状）。SSOページではバックエンド確認をスキップする。
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/sso')) {
      console.log('⏭️ /sso ではレガシー認証チェックをスキップ（SSOログイン処理中）');
      setLoading(false);
      return;
    }

    try {
      const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => resolve(null), 4000);
      });
      const userData = await Promise.race([checkAuth(), timeoutPromise]);
      if (userData) {
        console.log('✅ 認証済みユーザー:', userData.email || userData.uid);
        setAuthOk(userData);
      } else {
        console.log('❌ 未認証 (legacy check)');
        setAuthNone();
      }
    } catch (e) {
      console.log('🔍 legacy auth check failed (treated as unauthenticated):', e.message);
      setAuthNone();
    }
  };

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // ===== 絶対に発火する最終安全タイマー =====
    // どんな状況でも 3 秒後に loading=false に強制する
    forceEndLoadingTimer.current = setTimeout(forceEndLoading, 3000);

    const clearForceEndTimer = () => {
      if (forceEndLoadingTimer.current) {
        clearTimeout(forceEndLoadingTimer.current);
        forceEndLoadingTimer.current = null;
      }
    };

    const safeFinishLoading = () => {
      clearForceEndTimer();
      setLoading(false);
    };

    const handleAuthLogout = (event) => {
      console.log('🚪 認証エラーイベント受信:', event.detail);
      if (window.location.pathname.includes('/login')) return;
      if (event.detail?.reason === 'session_expired' && (isAuthenticated || user)) {
        setAuthNone();
        setTimeout(() => {
          if (!window.location.pathname.includes('/login')) {
            window.location.href = '/login?reason=session_expired';
          }
        }, 300);
      }
      if (event.detail?.reason === 'refresh_token_expired' && isAuthenticated) {
        setAuthNone();
        setTimeout(() => {
          if (!window.location.pathname.includes('/login')) {
            window.location.href = '/login?reason=token_expired';
          }
        }, 300);
      }
    };
    window.addEventListener('auth:logout', handleAuthLogout);

    // ===== メイン初期化ロジック =====
    try {
      const canUseFirebaseAuth = (
        auth &&
        !isMock &&
        typeof firebaseOnAuthStateChanged === 'function' &&
        typeof auth.currentUser !== 'undefined'
      );

      if (canUseFirebaseAuth) {
        console.log('🔧 Using real Firebase auth listener');
        let callbackFired = false;

        unsubscribe.current = firebaseOnAuthStateChanged(auth, async (firebaseUser) => {
          callbackFired = true;
          try {
            if (firebaseUser) {
              console.log('🔥 Firebase認証ユーザー検出:', firebaseUser.email);
              try {
                const idToken = await firebaseUser.getIdToken();
                await createFirebaseSession(idToken);
                const userData = {
                  uid: firebaseUser.uid,
                  email: firebaseUser.email,
                  displayName: firebaseUser.displayName,
                  photoURL: firebaseUser.photoURL
                };
                setAuthOk(userData);
              } catch (innerErr) {
                console.error('Firebase session create error:', innerErr);
                setAuthNone();
              }
            } else {
              console.log('🔍 Firebase user not signed in - checking backend session...');
              await doLegacyCheck();
            }
          } catch (outerErr) {
            console.error('Firebase onAuthStateChanged callback error:', outerErr);
            setAuthNone();
          } finally {
            safeFinishLoading();
          }
        });

        // Firebase SDK のバグでコールバックが一度も呼ばれない場合の保険
        setTimeout(() => {
          if (!callbackFired) {
            console.warn('⏱️ Firebase onAuthStateChanged not fired in 2500ms - using legacy check');
            doLegacyCheck().finally(() => safeFinishLoading());
          }
        }, 2500);
      } else {
        console.log('� Firebase not available (mock or missing SDK) - using backend auth only');
        // 先に loading を確実に解除してからチェック
        safeFinishLoading();
        doLegacyCheck();
      }
    } catch (topLevelError) {
      console.error('❌ Auth init top-level error:', topLevelError);
      setAuthNone();
      safeFinishLoading();
    }

    return () => {
      clearForceEndTimer();
      if (unsubscribe.current) {
        try { unsubscribe.current(); } catch (e) { /* noop */ }
        unsubscribe.current = null;
      }
      window.removeEventListener('auth:logout', handleAuthLogout);
      if (tokenRefreshTimer.current) {
        clearTimeout(tokenRefreshTimer.current);
        tokenRefreshTimer.current = null;
      }
    };
  }, []);

  const loginUser = async (email, password, idToken = null) => {
    try {
      let userData;
      if (idToken) {
        console.log('🔐 Firebase SSOログイン開始');
        await createFirebaseSession(idToken);
        userData = await checkAuth();
        console.log('✅ Firebase SSOログイン成功');
      } else {
        console.log('🔐 通常ログイン開始');
        userData = await login(email, password);
        console.log('✅ 通常ログイン成功');
      }
      setAuthOk(userData);
      await new Promise(resolve => setTimeout(resolve, 100));
      return userData;
    } catch (error) {
      console.error('❌ ログインエラー:', error);
      throw error;
    }
  };

  const logoutUser = async () => {
    try {
      if (tokenRefreshTimer.current) {
        clearTimeout(tokenRefreshTimer.current);
        tokenRefreshTimer.current = null;
      }
      if (auth && auth.currentUser && typeof firebaseSignOut === 'function') {
        await firebaseSignOut(auth);
        console.log('🔥 Firebaseログアウト完了');
      }
      await logout();
      setAuthNone();
    } catch (error) {
      console.error('Logout error:', error);
      setAuthNone();
    }
  };

  const waitForAuthState = async () => {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ isAuthenticated, user });
      }, 3000);
      if (!loading) {
        clearTimeout(timeout);
        resolve({ isAuthenticated, user });
      } else {
        const unsub = onAuthStateChange((authenticated, userData) => {
          clearTimeout(timeout);
          unsub();
          resolve({ isAuthenticated: authenticated, user: userData });
        });
      }
    });
  };

  const value = {
    user,
    isAuthenticated,
    loading,
    login: loginUser,
    logout: logoutUser,
    waitForAuthState,
    onAuthStateChange,
    setUser,
    setIsAuthenticated
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};