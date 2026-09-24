import React, { useState, useEffect } from 'react';
import { FiAlertCircle as AlertCircle, FiArrowRight as ArrowRight, FiCheckCircle as CheckCircle, FiShield as Shield, FiUser as User } from 'react-icons/fi';
import { useNavigate, useLocation } from 'react-router-dom';
import SharegramFirebaseAuth from './SharegramFirebaseAuth';

// 通知コンポーネント
const Notification = ({ type, message, onClose }) => {
  const styles = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800'
  };

  const icons = {
    success: <CheckCircle className="w-5 h-5" />,
    error: <AlertCircle className="w-5 h-5" />,
    warning: <AlertCircle className="w-5 h-5" />,
    info: <AlertCircle className="w-5 h-5" />
  };

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
        ×
      </button>
    </div>
  );
};

// 進捗ステップコンポーネント
const ProgressSteps = ({ currentStep }) => {
  const steps = [
    { id: 1, title: '情報確認', description: 'Sharegram連携情報の確認' },
    { id: 2, title: '認証', description: 'Firebase認証の実行' },
    { id: 3, title: '完了', description: 'KYC登録完了' }
  ];

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => (
          <React.Fragment key={step.id}>
            <div className="flex flex-col items-center">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${
                step.id <= currentStep
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-600'
              }`}>
                {step.id <= currentStep ? (
                  <CheckCircle className="w-5 h-5" />
                ) : (
                  step.id
                )}
              </div>
              <div className="mt-2 text-center">
                <div className="text-sm font-medium text-gray-900">{step.title}</div>
                <div className="text-xs text-gray-500">{step.description}</div>
              </div>
            </div>
            {index < steps.length - 1 && (
              <div className="flex-1 mx-4">
                <div className={`h-1 rounded-full ${
                  step.id < currentStep ? 'bg-blue-600' : 'bg-gray-200'
                }`} />
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

// URLパラメータ検証関数
const validateSharegramParams = (params) => {
  const errors = [];
  
  // 必須パラメータのチェック
  if (!params.user_id) {
    errors.push('ユーザーIDが指定されていません');
  }
  
  if (!params.callback_url) {
    errors.push('コールバックURLが指定されていません');
  }
  
  if (!params.api_key) {
    errors.push('APIキーが指定されていません');
  }
  
  // URLの妥当性チェック
  if (params.callback_url) {
    try {
      new URL(params.callback_url);
    } catch (e) {
      errors.push('コールバックURLの形式が正しくありません');
    }
  }
  
  // ユーザーIDの形式チェック（英数字のみ）
  if (params.user_id && !/^[a-zA-Z0-9_-]+$/.test(params.user_id)) {
    errors.push('ユーザーIDの形式が正しくありません');
  }
  
  // APIキーの形式チェック（最低文字数）
  if (params.api_key && params.api_key.length < 10) {
    errors.push('APIキーの形式が正しくありません');
  }
  
  return errors;
};

// セキュリティチェック関数
const performSecurityChecks = (params) => {
  const warnings = [];
  
  // HTTPSチェック
  if (params.callback_url && !params.callback_url.startsWith('https://')) {
    warnings.push('コールバックURLはHTTPSが推奨されます');
  }
  
  // リファラーチェック
  const referer = document.referrer;
  if (referer && !referer.includes('sharegram.com')) {
    warnings.push('不正なリファラーからのアクセスです');
  }
  
  return warnings;
};

const SharegramGateway = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [notification, setNotification] = useState(null);
  const [sharegramParams, setSharegramParams] = useState({});
  const [validationErrors, setValidationErrors] = useState([]);
  const [securityWarnings, setSecurityWarnings] = useState([]);
  const [isValidated, setIsValidated] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [loading, setLoading] = useState(true);
  
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // URLパラメータの解析
    const urlParams = new URLSearchParams(location.search);
    const params = {
      user_id: urlParams.get('user_id'),
      callback_url: urlParams.get('callback_url'),
      api_key: urlParams.get('api_key'),
      redirect_url: urlParams.get('redirect_url'),
      company_id: urlParams.get('company_id'),
      session_id: urlParams.get('session_id'),
      locale: urlParams.get('locale') || 'ja'
    };
    
    setSharegramParams(params);
    
    // パラメータ検証
    const errors = validateSharegramParams(params);
    setValidationErrors(errors);
    
    // セキュリティチェック
    const warnings = performSecurityChecks(params);
    setSecurityWarnings(warnings);
    
    // 検証結果の判定
    if (errors.length === 0) {
      setIsValidated(true);
      setNotification({
        type: 'success',
        message: 'Sharegram連携情報が正常に確認されました'
      });
    } else {
      setNotification({
        type: 'error',
        message: 'パラメータに問題があります。Sharegramからのアクセスを確認してください。'
      });
    }
    
    setLoading(false);
  }, [location.search]);

  // 認証成功時の処理
  const handleAuthSuccess = async (user, idToken) => {
    setCurrentStep(3);
    setNotification({
      type: 'success',
      message: '認証が完了しました。Sharegramに結果を送信中...'
    });

    try {
      // Sharegramへの認証結果送信
      await sendAuthResultToSharegram(user, idToken, sharegramParams);
      
      setTimeout(() => {
        setNotification({
          type: 'success',
          message: 'KYC登録が完了しました。元のページに戻ります...'
        });
        
        // 3秒後にSharegramにリダイレクト
        setTimeout(() => {
          redirectToSharegram(sharegramParams, user, idToken);
        }, 3000);
      }, 1000);
      
    } catch (error) {
      console.error('Sharegram結果送信エラー:', error);
      setNotification({
        type: 'error',
        message: 'KYC登録は成功しましたが、Sharegramへの結果送信に失敗しました。'
      });
    }
  };

  // Sharegramへの認証結果送信
  const sendAuthResultToSharegram = async (user, idToken, params) => {
    const resultData = {
      user_id: params.user_id,
      firebase_uid: user.uid,
      email: user.email,
      display_name: user.displayName,
      photo_url: user.photoURL,
      id_token: idToken,
      session_id: params.session_id,
      timestamp: new Date().toISOString(),
      status: 'success'
    };

    // SafeVideoバックエンドAPI経由でSharegramに結果を送信
    const response = await fetch('/api/sharegram/auth-result', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        callback_url: params.callback_url,
        api_key: params.api_key,
        result: resultData
      })
    });

    if (!response.ok) {
      throw new Error('Sharegram結果送信に失敗しました');
    }

    return response.json();
  };

  // Sharegramへのリダイレクト
  const redirectToSharegram = (params, user, idToken) => {
    const redirectUrl = params.redirect_url || params.callback_url;
    const redirectParams = new URLSearchParams({
      user_id: params.user_id,
      firebase_uid: user.uid,
      status: 'success',
      session_id: params.session_id || '',
      timestamp: new Date().toISOString()
    });

    window.location.href = `${redirectUrl}?${redirectParams.toString()}`;
  };

  // 認証開始
  const startAuth = () => {
    setCurrentStep(2);
    setShowAuth(true);
  };

  // ローディング中の表示
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">接続情報を確認中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <Shield className="w-8 h-8 text-blue-600" />
              <div>
                <h1 className="text-xl font-semibold text-gray-900">SafeVideo KYC</h1>
                <p className="text-sm text-gray-500">Sharegram連携認証</p>
              </div>
            </div>
            <div className="flex items-center space-x-2 text-sm text-gray-500">
              <User className="w-4 h-4" />
              <span>ユーザー: {sharegramParams.user_id}</span>
            </div>
          </div>
        </div>
      </div>

      {/* メインコンテンツ */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <ProgressSteps currentStep={currentStep} />

        {/* 通知表示 */}
        {notification && (
          <Notification
            type={notification.type}
            message={notification.message}
            onClose={() => setNotification(null)}
          />
        )}

        {/* 検証エラー表示 */}
        {validationErrors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-start">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 mr-3" />
              <div>
                <h3 className="text-sm font-medium text-red-800 mb-2">
                  パラメータエラー
                </h3>
                <ul className="text-sm text-red-700 space-y-1">
                  {validationErrors.map((error, index) => (
                    <li key={index}>• {error}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* セキュリティ警告表示 */}
        {securityWarnings.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <div className="flex items-start">
              <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 mr-3" />
              <div>
                <h3 className="text-sm font-medium text-yellow-800 mb-2">
                  セキュリティ警告
                </h3>
                <ul className="text-sm text-yellow-700 space-y-1">
                  {securityWarnings.map((warning, index) => (
                    <li key={index}>• {warning}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* メインコンテンツ */}
        {!showAuth ? (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Sharegram KYC認証
              </h2>
              <p className="text-gray-600">
                SafeVideoでの本人確認を開始します。以下の情報をご確認ください。
              </p>
            </div>

            {/* 連携情報表示 */}
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-3">連携情報</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">ユーザーID</label>
                  <p className="mt-1 text-sm text-gray-900">{sharegramParams.user_id}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">セッションID</label>
                  <p className="mt-1 text-sm text-gray-900">{sharegramParams.session_id || 'N/A'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">企業ID</label>
                  <p className="mt-1 text-sm text-gray-900">{sharegramParams.company_id || 'N/A'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">言語</label>
                  <p className="mt-1 text-sm text-gray-900">{sharegramParams.locale}</p>
                </div>
              </div>
            </div>

            {/* 認証開始ボタン */}
            {isValidated ? (
              <div className="text-center">
                <button
                  onClick={startAuth}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg transition-colors inline-flex items-center space-x-2"
                >
                  <span>認証を開始</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="text-center">
                <button
                  disabled
                  className="bg-gray-400 text-white font-medium py-3 px-6 rounded-lg cursor-not-allowed"
                >
                  認証を開始できません
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Firebase認証
              </h2>
              <p className="text-gray-600">
                Googleアカウントまたはメールアドレスでログインしてください。
              </p>
            </div>

            <SharegramFirebaseAuth
              onAuthSuccess={handleAuthSuccess}
              sharegramParams={sharegramParams}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default SharegramGateway;