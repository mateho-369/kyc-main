import React, { useState, useEffect } from 'react';
// import { trackPageView, trackError, trackEvent, trackUserLogin, console } from '../services/firebaseAnalytics';
import { FiVideo as Video } from 'react-icons/fi';
// import { trackEvent, trackUserLogin, trackPageView, trackError, console } from '../services/firebaseAnalytics';

// Firebase imports will be added when Firebase is configured
let app, auth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword;

try {
  const firebaseApp = require('firebase/app');
  const firebaseAuth = require('firebase/auth');
  
  // Firebase設定（統一設定 - 環境変数から読み込み）
  const firebaseConfig = {
    apiKey: process.env.REACT_APP_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || 'AIzaSyC9pSqeZeOjvndPX_dPEsaIU22CUWVYB_0',
    authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN || 'adroit-standard-496710-r5.firebaseapp.com',
    projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'adroit-standard-496710-r5',
    storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || 'adroit-standard-496710-r5.firebasestorage.app',
    messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || '716516303448',
    appId: process.env.REACT_APP_FIREBASE_APP_ID || '1:716516303448:web:e7ab0a08b087ffd60f602d'
  };

  // Firebase初期化
  if (firebaseConfig.apiKey) {
    app = firebaseApp.initializeApp(firebaseConfig);
    auth = firebaseAuth.getAuth(app);
    GoogleAuthProvider = firebaseAuth.GoogleAuthProvider;
    signInWithPopup = firebaseAuth.signInWithPopup;
    signInWithEmailAndPassword = firebaseAuth.signInWithEmailAndPassword;
  }
} catch (error) {
  console.warn('Firebase not configured:', error);
}

const FirebaseLoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Track page view
  useEffect(() => {
    console.log('Firebase Login Page');
  }, []);

  // Firebase認証後の処理
  const handleFirebaseAuth = async (user) => {
    try {
      const idToken = await user.getIdToken();
      
      // ローディング状態を表示
      setLoading(true);
      setError('');
      
      // KYCシステムのFirebase SSO エンドポイントへリダイレクト
      const redirectUrl = '/dashboard';
      const ssoUrl = `/api/auth/firebase-sso?id_token=${idToken}&redirect_url=${encodeURIComponent(redirectUrl)}`;
      
      // エラーハンドリングを含めたリダイレクト
      try {
        window.location.href = ssoUrl;
      } catch (redirectError) {
        console.error('リダイレクトエラー:', redirectError);
        // フォールバック: 直接ダッシュボードへリダイレクト
        window.location.href = `/sso-callback?token=${idToken}&redirect=/dashboard`;
      }
    } catch (error) {
      console.error('Firebase認証エラー:', error);
      const errorMsg = 'Authentication error occurred. Please try again.';
      setError(errorMsg);
      setLoading(false);
      
      // エラートラッキング
      trackError('firebase_auth_processing_error', errorMsg, error.stack, {
        userId: user?.uid,
        email: user?.email
      });
    }
  };

  // Googleアカウントでログイン
  const handleGoogleLogin = async () => {
    if (!auth || !GoogleAuthProvider || !signInWithPopup) {
      const errorMsg = 'Firebase認証が設定されていません。管理者にお問い合わせください。';
      setError(errorMsg);
      trackError('configuration_error', errorMsg, null, { authMethod: 'google' });
      return;
    }
    
    setLoading(true);
    setError('');
    
    // Track Google login attempt
    console.log("LOGIN_ATTEMPT", {
      method: 'google',
      provider: 'firebase'
    });
    
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: 'select_account'
      });
      
      const result = await signInWithPopup(auth, provider);
      
      // Track successful Google login
      trackUserLogin(result.user.uid, 'google', true);
      console.log('firebase_auth_success', {
        method: 'google',
        userId: result.user.uid,
        email: result.user.email
      });
      
      await handleFirebaseAuth(result.user);
    } catch (error) {
      console.error('Googleログインエラー:', error);
      
      // ユーザーがキャンセルした場合の処理
      if (error.code === 'auth/cancelled-popup-request' || error.code === 'auth/popup-closed-by-user') {
        setError('');
        setLoading(false);
        return;
      }
      
      let errorMsg = 'Googleログインに失敗しました';
      
      // エラーコードに基づいたメッセージのカスタマイズ
      if (error.code === 'auth/account-exists-with-different-credential') {
        errorMsg = 'このメールアドレスは別の方法で登録済みです。メールアドレスでログインしてください。';
      } else if (error.code === 'auth/popup-blocked') {
        errorMsg = 'ポップアップがブロックされました。ブラウザのポップアップ設定を確認してください。';
      } else if (error.code === 'auth/operation-not-allowed') {
        errorMsg = 'Googleログインが無効です。管理者にお問い合わせください。';
      }
      
      setError(errorMsg);
      setLoading(false);
      
      // Track failed Google login
      trackUserLogin(null, 'google', false);
      trackError('firebase_auth_error', errorMsg, error.stack, {
        authMethod: 'google',
        errorCode: error.code
      });
    }
  };

  // メールアドレスとパスワードでログイン
  const handleEmailLogin = async (e) => {
    e.preventDefault();
    
    if (!auth || !signInWithEmailAndPassword) {
      const errorMsg = 'Firebase認証が設定されていません。管理者にお問い合わせください。';
      setError(errorMsg);
      trackError('configuration_error', errorMsg, null, { authMethod: 'email' });
      return;
    }
    
    setLoading(true);
    setError('');
    
    // Track email login attempt
    console.log("LOGIN_ATTEMPT", {
      method: 'email_password',
      provider: 'firebase',
      email_domain: email.split('@')[1] || 'unknown'
    });
    
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      
      // Track successful email login
      trackUserLogin(result.user.uid, 'email_password', true);
      console.log('firebase_auth_success', {
        method: 'email_password',
        userId: result.user.uid,
        email: result.user.email
      });
      
      await handleFirebaseAuth(result.user);
    } catch (error) {
      console.error('メールログインエラー:', error);
      let errorMsg = 'ログインに失敗しました';
      
      // エラーコードに基づいたメッセージのカスタマイズ
      if (error.code === 'auth/user-not-found') {
        errorMsg = 'アカウントが見つかりません。メールアドレスを確認してください。';
      } else if (error.code === 'auth/wrong-password') {
        errorMsg = 'パスワードが正しくありません。';
      } else if (error.code === 'auth/invalid-email') {
        errorMsg = 'メールアドレスの形式が正しくありません。';
      } else if (error.code === 'auth/user-disabled') {
        errorMsg = 'このアカウントは無効化されています。管理者にお問い合わせください。';
      } else if (error.code === 'auth/too-many-requests') {
        errorMsg = 'ログイン試行回数が多すぎます。しばらく時間をおいてから再試行してください。';
      }
      
      setError(errorMsg);
      setLoading(false);
      
      // Track failed email login
      trackUserLogin(null, 'email_password', false);
      trackError('firebase_auth_error', errorMsg, error.stack, {
        authMethod: 'email_password',
        errorCode: error.code,
        email_domain: email.split('@')[1] || 'unknown'
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="flex justify-center">
            <div className="bg-blue-50 p-3 rounded-full">
              <div className="text-white bg-blue-600 rounded-full p-3">
                <Video size={24} />
              </div>
            </div>
          </div>
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
            SharegramVideo<span className="text-blue-600">.org</span>
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Sharegramアカウントでログイン
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Firebase認証を使用
          </p>
        </div>

        <div className="mt-8 bg-white py-8 px-6 shadow-lg rounded-lg border border-gray-100">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-600 rounded-md p-3 text-sm">
              {error}
            </div>
          )}

          {/* Googleログインボタン */}
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex justify-center items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {loading ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                認証中...
              </>
            ) : (
              <>
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Googleアカウントでログイン
              </>
            )}
          </button>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">または</span>
              </div>
            </div>
          </div>

          {/* メールアドレスログインフォーム */}
          <form onSubmit={handleEmailLogin} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                メールアドレス
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="email@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                パスワード
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-1 appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {loading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  認証中...
                </>
              ) : (
                'ログイン'
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <a href="/login" className="text-sm text-blue-600 hover:text-blue-500">
              通常のログインに戻る
            </a>
          </div>
        </div>

        <div className="text-center text-xs text-gray-500">
          © 2025 SharegramVideo All rights reserved.
        </div>
      </div>
    </div>
  );
};

export default FirebaseLoginPage;