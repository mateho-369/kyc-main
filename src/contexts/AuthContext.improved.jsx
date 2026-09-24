import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import { login, logout, checkAuth, createFirebaseSession } from '../services/auth';
import { auth } from '../config/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const authCheckPerformed = useRef(false);
  const tokenRefreshTimer = useRef(null);
  const authStateChangeCallbacks = useRef([]); // 認証状態変更時のコールバック管理

  // 認証状態変更の通知を登録する関数
  const onAuthStateChange = (callback) => {
    authStateChangeCallbacks.current.push(callback);
    return () => {
      authStateChangeCallbacks.current = authStateChangeCallbacks.current.filter(cb => cb !== callback);
    };
  };

  // 認証状態が変更されたときに全コールバックを実行
  const notifyAuthStateChange = (authenticated, userData) => {
    authStateChangeCallbacks.current.forEach(callback => {
      callback(authenticated, userData);
    });
  };

  useEffect(() => {
    if (authCheckPerformed.current) return;

    // 認証エラーイベントのリスナー設定
    const handleAuthLogout = (event) => {
      console.log('🚪 認証エラーによるログアウト:', event.detail);
      
      // セッション有効期限切れの場合のみログアウト処理
      // 初回401エラーは無視（セッション初期化中の可能性）
      if (event.detail?.reason === 'session_expired' && isAuthenticated) {
        setUser(null);
        setIsAuthenticated(false);
        notifyAuthStateChange(false, null);
      }
    };
    
    window.addEventListener('auth:logout', handleAuthLogout);

    // Firebase認証状態の監視
    let unsubscribe = null;
    
    const initializeAuth = async () => {
      try {
        // Firebaseの認証状態リスナーを設定
        if (auth) {
          unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
              console.log('🔥 Firebase認証ユーザー検出:', firebaseUser.email);
              // Firebaseトークンを取得
              const idToken = await firebaseUser.getIdToken();
              // バックエンドセッションを作成
              try {
                await createFirebaseSession(idToken);
                const userData = {
                  uid: firebaseUser.uid,
                  email: firebaseUser.email,
                  displayName: firebaseUser.displayName,
                  photoURL: firebaseUser.photoURL
                };
                setUser(userData);
                setIsAuthenticated(true);
                notifyAuthStateChange(true, userData);
                setupTokenRefreshTimer();
              } catch (error) {
                console.error('セッション作成エラー:', error);
                setUser(null);
                setIsAuthenticated(false);
                notifyAuthStateChange(false, null);
              }
            } else {
              console.log('🔍 Firebase認証なし、通常認証チェック');
              // 通常の認証チェック
              const userData = await checkAuth();
              if (userData) {
                console.log('✅ 認証済みユーザー:', userData.email || userData.uid);
                setUser(userData);
                setIsAuthenticated(true);
                notifyAuthStateChange(true, userData);
                setupTokenRefreshTimer();
              } else {
                console.log('❌ 未認証');
                setUser(null);
                setIsAuthenticated(false);
                notifyAuthStateChange(false, null);
              }
            }
            setLoading(false);
          });
        } else {
          // Firebaseが利用不可の場合は通常認証のみ
          const userData = await checkAuth();
          if (userData) {
            setUser(userData);
            setIsAuthenticated(true);
            notifyAuthStateChange(true, userData);
            setupTokenRefreshTimer();
          }
          setLoading(false);
        }
        
        authCheckPerformed.current = true;
      } catch (error) {
        console.log('❌ 認証初期化エラー:', error.message);
        setUser(null);
        setIsAuthenticated(false);
        notifyAuthStateChange(false, null);
        setLoading(false);
      }
    };

    initializeAuth();

    // クリーンアップ
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
      window.removeEventListener('auth:logout', handleAuthLogout);
      if (tokenRefreshTimer.current) {
        clearTimeout(tokenRefreshTimer.current);
      }
    };
  }, []);

  // トークンリフレッシュタイマーの設定
  const setupTokenRefreshTimer = () => {
    if (tokenRefreshTimer.current) {
      clearTimeout(tokenRefreshTimer.current);
    }
    
    // 10分後にトークンをリフレッシュ（15分の有効期限より前に）
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
      }
    }, 10 * 60 * 1000); // 10分
  };

  const loginUser = async (email, password, idToken = null) => {
    try {
      let userData;
      
      if (idToken) {
        // Firebase SSO経由のログイン（セキュア版）
        console.log('🔐 Firebase SSOログイン開始');
        await createFirebaseSession(idToken);
        userData = await checkAuth();
        console.log('✅ Firebase SSOログイン成功');
      } else {
        // 通常のメール/パスワードログイン（SecureApiClient経由）
        console.log('🔐 通常ログイン開始');
        userData = await login(email, password);
        console.log('✅ 通常ログイン成功');
      }
      
      setUser(userData);
      setIsAuthenticated(true);
      notifyAuthStateChange(true, userData);
      
      // ログイン成功後にトークンリフレッシュタイマーを設定
      setupTokenRefreshTimer();
      
      // 認証状態が完全に反映されるまで待機
      await new Promise(resolve => setTimeout(resolve, 100));
      
      return userData;
    } catch (error) {
      console.error('❌ ログインエラー:', error);
      throw error;
    }
  };

  const logoutUser = async () => {
    try {
      // トークンリフレッシュタイマーをクリア
      if (tokenRefreshTimer.current) {
        clearTimeout(tokenRefreshTimer.current);
        tokenRefreshTimer.current = null;
      }
      
      // Firebase認証からログアウト
      if (auth && auth.currentUser) {
        await signOut(auth);
        console.log('🔥 Firebaseログアウト完了');
      }
      
      // バックエンドセッションも終了
      await logout();
      
      setUser(null);
      setIsAuthenticated(false);
      notifyAuthStateChange(false, null);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // 認証状態が確定するまで待つヘルパー関数
  const waitForAuthState = async () => {
    return new Promise((resolve) => {
      if (!loading) {
        resolve({ isAuthenticated, user });
      } else {
        const unsubscribe = onAuthStateChange((authenticated, userData) => {
          unsubscribe();
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
    onAuthStateChange
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};