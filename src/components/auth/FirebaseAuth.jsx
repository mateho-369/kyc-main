import React, { useState } from 'react';
import { FiAlertCircle as AlertCircle, FiCheckCircle as CheckCircle, FiInfo as Info, FiLock as Lock, FiMail as Mail } from 'react-icons/fi';
import { 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail
} from 'firebase/auth';
import { auth } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContext';
// // エラーメッセージの日本語化
const getErrorMessage = (errorCode) => {
  const errorMessages = {
    'auth/user-not-found': 'アカウントが見つかりません。',
    'auth/wrong-password': 'パスワードが正しくありません。',
    'auth/email-already-in-use': 'このメールアドレスは既に使用されています。',
    'auth/weak-password': 'パスワードは6文字以上で設定してください。',
    'auth/invalid-email': 'メールアドレスの形式が正しくありません。',
    'auth/too-many-requests': 'ログイン試行回数が多すぎます。しばらく待ってから再試行してください。',
    'auth/network-request-failed': 'ネットワークエラーが発生しました。',
    'auth/popup-blocked': 'ポップアップがブロックされました。'
  };
  return errorMessages[errorCode] || '認証エラーが発生しました。';
};

const FirebaseAuth = () => {
  const [mode, setMode] = useState('login'); // login, register, reset
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  
  const { login: authContextLogin } = useAuth();

  // バリデーション
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

  // メール/パスワード認証
  const handleEmailAuth = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    setLoading(true);
    setNotification(null);

    try {
      let result;
      
      if (mode === 'login') {
        result = await signInWithEmailAndPassword(auth, email, password);
        // IDトークンを取得して既存の認証コンテキストと統合
        const idToken = await result.user.getIdToken();
        await authContextLogin(email, null, idToken);
        
        setNotification({
          type: 'success',
          message: 'ログインに成功しました！'
        });
      } else if (mode === 'register') {
        result = await createUserWithEmailAndPassword(auth, email, password);
        // 新規登録後、自動ログイン
        const idToken = await result.user.getIdToken();
        await authContextLogin(email, null, idToken);
        
        setNotification({
          type: 'success',
          message: 'アカウントを作成しました！'
        });
      } else if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email);
        setNotification({
          type: 'success',
          message: 'パスワードリセットメールを送信しました。'
        });
        setEmail('');
        setLoading(false);
        return;
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

  // Googleログイン
  const handleGoogleLogin = async () => {
    setLoading(true);
    setNotification(null);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: 'select_account'
      });
      
      const result = await signInWithPopup(auth, provider);
      const idToken = await result.user.getIdToken();
      await authContextLogin(result.user.email, null, idToken);
      
      setNotification({
        type: 'success',
        message: 'Googleアカウントでログインしました！'
      });
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

  // 通知コンポーネント
  const Notification = ({ type, message }) => {
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

    return (
      <div className={`${styles[type]} border rounded-lg p-4 mb-4 flex items-start`}>
        <div className="mr-3">{icons[type]}</div>
        <p className="text-sm">{message}</p>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        {/* ヘッダー */}
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            {mode === 'login' && 'アカウントにログイン'}
            {mode === 'register' && '新規アカウント作成'}
            {mode === 'reset' && 'パスワードをリセット'}
          </h2>
        </div>

        {/* 通知 */}
        {notification && (
          <Notification type={notification.type} message={notification.message} />
        )}

        {/* フォーム */}
        <form className="mt-8 space-y-6" onSubmit={handleEmailAuth}>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="email-address" className="sr-only">
                メールアドレス
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="email-address"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="appearance-none rounded-none relative block w-full px-3 py-2 pl-10 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                  placeholder="メールアドレス"
                  disabled={loading}
                />
              </div>
            </div>
            
            {mode !== 'reset' && (
              <div>
                <label htmlFor="password" className="sr-only">
                  パスワード
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`appearance-none rounded-none relative block w-full px-3 py-2 pl-10 border border-gray-300 placeholder-gray-500 text-gray-900 ${mode === 'register' ? '' : 'rounded-b-md'} focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm`}
                    placeholder="パスワード"
                    disabled={loading}
                  />
                </div>
              </div>
            )}

            {mode === 'register' && (
              <div>
                <label htmlFor="confirm-password" className="sr-only">
                  パスワード（確認）
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="confirm-password"
                    name="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="appearance-none rounded-none relative block w-full px-3 py-2 pl-10 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                    placeholder="パスワード（確認）"
                    disabled={loading}
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {loading ? '処理中...' : (
                <>
                  {mode === 'login' && 'ログイン'}
                  {mode === 'register' && 'アカウント作成'}
                  {mode === 'reset' && 'リセットメール送信'}
                </>
              )}
            </button>
          </div>
        </form>

        {/* Googleログイン */}
        {mode !== 'reset' && (
          <>
            <div className="mt-6">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-gray-50 text-gray-500">または</span>
                </div>
              </div>

              <div className="mt-6">
                <button
                  onClick={handleGoogleLogin}
                  disabled={loading}
                  className="w-full flex justify-center items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                >
                  <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Googleでログイン
                </button>
              </div>
            </div>
          </>
        )}

        {/* モード切替リンク */}
        <div className="text-center space-y-2 text-sm">
          {mode === 'login' && (
            <>
              <button
                onClick={() => setMode('register')}
                className="font-medium text-indigo-600 hover:text-indigo-500"
              >
                新規アカウントを作成
              </button>
              <br />
              <button
                onClick={() => setMode('reset')}
                className="font-medium text-gray-600 hover:text-gray-500"
              >
                パスワードをお忘れですか？
              </button>
            </>
          )}
          {mode === 'register' && (
            <button
              onClick={() => setMode('login')}
              className="font-medium text-indigo-600 hover:text-indigo-500"
            >
              既存のアカウントでログイン
            </button>
          )}
          {mode === 'reset' && (
            <button
              onClick={() => setMode('login')}
              className="font-medium text-indigo-600 hover:text-indigo-500"
            >
              ログイン画面に戻る
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default FirebaseAuth;