import React, { useState, useEffect } from 'react';
import { FiAlertCircle as AlertCircle, FiCheckCircle as CheckCircle, FiInfo as Info, FiX as X } from 'react-icons/fi';
import { 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signOut
} from 'firebase/auth';
import { auth } from '../../config/firebase';
// // 通知コンポーネント
const Notification = ({ type, message, onClose }) => {
  const styles = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800'
  };

  const icons = {
    success: <CheckCircle className="w-5 h-5" />,
    error: <AlertCircle className="w-5 h-5" />,
    info: <Info className="w-5 h-5" />
  };

  useEffect(() => {
    if (type === 'success') {
      const timer = setTimeout(onClose, 3000);
      return () => clearTimeout(timer);
    }
  }, [type, onClose]);

  return (
    <div className={`${styles[type]} border rounded-lg p-4 mb-4 flex items-start animate-fade-in`}>
      <div className="flex-shrink-0 mr-3">
        {icons[type]}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium">{message}</p>
      </div>
      <button
        onClick={onClose}
        className="ml-3 flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

// エラーメッセージの日本語化
const getErrorMessage = (errorCode) => {
  const errorMessages = {
    'auth/user-not-found': 'アカウントが見つかりません。新規登録をお試しください。',
    'auth/wrong-password': 'パスワードが間違っています。',
    'auth/email-already-in-use': 'このメールアドレスは既に使用されています。',
    'auth/weak-password': 'パスワードは6文字以上で設定してください。',
    'auth/invalid-email': 'メールアドレスの形式が正しくありません。',
    'auth/operation-not-allowed': 'この認証方法は現在利用できません。',
    'auth/too-many-requests': 'ログイン試行回数が多すぎます。しばらく待ってから再試行してください。',
    'auth/network-request-failed': 'ネットワークエラーが発生しました。接続を確認してください。',
    'auth/popup-closed-by-user': 'ログイン画面が閉じられました。',
    'auth/cancelled-popup-request': 'ポップアップがキャンセルされました。',
    'auth/popup-blocked': 'ポップアップがブロックされました。ブラウザの設定を確認してください。'
  };

  return errorMessages[errorCode] || '認証エラーが発生しました。もう一度お試しください。';
};

const FirebaseAuthUI = ({ onAuthSuccess, mode: initialMode = 'login' }) => {
  const [mode, setMode] = useState(initialMode); // login, register, reset
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null);

  // フォームバリデーション
  const validateForm = () => {
    if (!email || !email.includes('@')) {
      setNotification({
        type: 'error',
        message: '有効なメールアドレスを入力してください。'
      });
      return false;
    }

    if (mode !== 'reset' && (!password || password.length < 6)) {
      setNotification({
        type: 'error',
        message: 'パスワードは6文字以上で入力してください。'
      });
      return false;
    }

    if (mode === 'register' && password !== confirmPassword) {
      setNotification({
        type: 'error',
        message: 'パスワードが一致しません。'
      });
      return false;
    }

    return true;
  };

  // メール/パスワード認証処理
  const handleEmailAuth = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    setLoading(true);
    setNotification(null);

    try {
      let result;
      
      if (mode === 'login') {
        result = await signInWithEmailAndPassword(auth, email, password);
        setNotification({
          type: 'success',
          message: 'ログインに成功しました！'
        });
      } else if (mode === 'register') {
        result = await createUserWithEmailAndPassword(auth, email, password);
        setNotification({
          type: 'success',
          message: 'アカウントを作成しました！'
        });
      } else if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email);
        setNotification({
          type: 'success',
          message: 'パスワードリセットメールを送信しました。メールを確認してください。'
        });
        setEmail('');
        setLoading(false);
        return;
      }

      if (result && onAuthSuccess) {
        const idToken = await result.user.getIdToken();
        onAuthSuccess(result.user, idToken);
      }
    } catch (error) {
      console.error('認証エラー:', error);
      setNotification({
        type: 'error',
        message: getErrorMessage(error.code)
      });
    } finally {
      setLoading(false);
    }
  };

  // Googleログイン処理
  const handleGoogleLogin = async () => {
    setLoading(true);
    setNotification(null);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: 'select_account'
      });
      
      const result = await signInWithPopup(auth, provider);
      
      setNotification({
        type: 'success',
        message: 'Googleアカウントでログインしました！'
      });

      if (onAuthSuccess) {
        const idToken = await result.user.getIdToken();
        onAuthSuccess(result.user, idToken);
      }
    } catch (error) {
      console.error('Googleログインエラー:', error);
      setNotification({
        type: 'error',
        message: getErrorMessage(error.code)
      });
    } finally {
      setLoading(false);
    }
  };

  // モード切替時の初期化
  const switchMode = (newMode) => {
    setMode(newMode);
    setNotification(null);
    setPassword('');
    setConfirmPassword('');
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {/* 通知表示 */}
      {notification && (
        <Notification
          type={notification.type}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}

      {/* メインフォーム */}
      <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8">
        <h2 className="text-2xl font-bold text-center mb-6">
          {mode === 'login' && 'ログイン'}
          {mode === 'register' && '新規登録'}
          {mode === 'reset' && 'パスワードリセット'}
        </h2>

        <form onSubmit={handleEmailAuth} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              メールアドレス
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              placeholder="email@example.com"
              disabled={loading}
            />
          </div>

          {mode !== 'reset' && (
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                パスワード
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="••••••••"
                disabled={loading}
              />
            </div>
          )}

          {mode === 'register' && (
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
                パスワード（確認）
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="••••••••"
                disabled={loading}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            {loading ? '処理中...' : (
              <>
                {mode === 'login' && 'ログイン'}
                {mode === 'register' && '登録'}
                {mode === 'reset' && 'リセットメールを送信'}
              </>
            )}
          </button>
        </form>

        {/* Googleログイン（パスワードリセット時は非表示） */}
        {mode !== 'reset' && (
          <>
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">または</span>
              </div>
            </div>

            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full flex items-center justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm bg-white hover:bg-gray-50 transition-colors disabled:bg-gray-100 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              {loading ? '処理中...' : 'Googleでログイン'}
            </button>
          </>
        )}

        {/* モード切替リンク */}
        <div className="mt-6 text-center space-y-2">
          {mode === 'login' && (
            <>
              <button
                onClick={() => switchMode('register')}
                className="text-sm text-blue-600 hover:text-blue-500 transition-colors"
              >
                アカウントをお持ちでない方はこちら
              </button>
              <br />
              <button
                onClick={() => switchMode('reset')}
                className="text-sm text-gray-600 hover:text-gray-500 transition-colors"
              >
                パスワードをお忘れの方
              </button>
            </>
          )}
          {mode === 'register' && (
            <button
              onClick={() => switchMode('login')}
              className="text-sm text-blue-600 hover:text-blue-500 transition-colors"
            >
              既にアカウントをお持ちの方はこちら
            </button>
          )}
          {mode === 'reset' && (
            <button
              onClick={() => switchMode('login')}
              className="text-sm text-blue-600 hover:text-blue-500 transition-colors"
            >
              ログイン画面に戻る
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default FirebaseAuthUI;