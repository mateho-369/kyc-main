import React, { useState, useEffect, useCallback } from 'react';
import { FiAlertTriangle as AlertTriangle, FiCheckCircle as CheckCircle, FiShield as Shield, FiVideo as Video } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
// import FirebaseAuthUI from '../components/auth/FirebaseAuthUI';
import { useSecureFirebaseAuth } from '../contexts/SecureFirebaseAuthContext';
import secureApiClient from '../services/SecureApiClient';

const EnhancedSecureFirebaseLoginPage = () => {
  const navigate = useNavigate();
  const { isAuthenticated, getSecurityStatus } = useSecureFirebaseAuth();
  const [securityStatus, setSecurityStatus] = useState(null);
  const [sessionInitialized, setSessionInitialized] = useState(false);
  const [initError, setInitError] = useState(null);

  // セキュリティステータスの監視
  useEffect(() => {
    const status = getSecurityStatus();
    setSecurityStatus(status);

    // HTTPSでない場合の警告
    if (!status.isHttps && process.env.NODE_ENV === 'production') {
      console.error('🚨 セキュリティ警告: HTTPSを使用してください');
    }
  }, [getSecurityStatus]);

  // セッションの初期化
  useEffect(() => {
    const initializeSession = async () => {
      try {
        await secureApiClient.initializeSession();
        setSessionInitialized(true);
        console.log('✅ セキュアセッションが初期化されました');
      } catch (error) {
        console.error('❌ セッション初期化エラー:', error);
        setInitError('セッションの初期化に失敗しました。ページを更新してください。');
      }
    };

    if (!sessionInitialized) {
      initializeSession();
    }
  }, [sessionInitialized]);

  // 既に認証済みの場合はダッシュボードへリダイレクト
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  // 認証成功時の処理（httpOnly cookie対応）
  const handleAuthSuccess = useCallback(async (user, idToken) => {
    try {
      console.log('🎉 認証成功:', user.email);
      
      // Firebaseセッションの作成（httpOnly cookieベース）
      const sessionResponse = await secureApiClient.createFirebaseSession(idToken);
      
      if (sessionResponse.success) {
        console.log('✅ セキュアセッションが作成されました');
        
        // リダイレクト先の決定
        const urlParams = new URLSearchParams(window.location.search);
        const redirectUrl = urlParams.get('redirect') || '/dashboard';
        
        // 安全なリダイレクト（同一オリジンのみ）
        if (redirectUrl.startsWith('/')) {
          navigate(redirectUrl);
        } else {
          navigate('/dashboard');
        }
      } else {
        throw new Error('セッション作成に失敗しました');
      }
    } catch (error) {
      console.error('❌ 認証処理エラー:', error);
      setInitError('認証処理中にエラーが発生しました。もう一度お試しください。');
    }
  }, [navigate]);

  // セキュリティステータスの表示
  const renderSecurityStatus = () => {
    if (!securityStatus) return null;

    const items = [
      {
        label: 'HTTPS接続',
        status: securityStatus.isHttps,
        icon: Lock
      },
      {
        label: 'セッション保護',
        status: sessionInitialized,
        icon: Shield
      },
      {
        label: 'CSRF保護',
        status: sessionInitialized && secureApiClient.getSecurityStatus().hasCSRFToken,
        icon: Shield
      }
    ];

    return (
      <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">セキュリティ状態</h3>
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={index} className="flex items-center text-sm">
              {item.status ? (
                <>
                  <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                  <span className="text-green-700">{item.label}</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 text-yellow-500 mr-2" />
                  <span className="text-yellow-700">{item.label}（警告）</span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
      {/* セキュリティステータスバー */}
      {securityStatus && !securityStatus.isHttps && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2">
          <div className="max-w-7xl mx-auto flex items-center justify-center text-sm">
            <AlertTriangle className="w-4 h-4 mr-2 text-yellow-600" />
            <span className="text-yellow-800">
              警告: 安全でない接続です。HTTPSを使用してください。
            </span>
          </div>
        </div>
      )}

      {/* メインコンテンツ */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8 py-12">
        <div className="max-w-md w-full space-y-8">
          {/* ロゴとタイトル */}
          <div className="text-center">
            <div className="flex justify-center mb-4">
              <div className="relative">
                <div className="bg-blue-100 p-4 rounded-full">
                  <Video className="w-12 h-12 text-blue-600" />
                </div>
                <div className="absolute -bottom-1 -right-1 bg-green-500 rounded-full p-1">
                  <Shield className="w-4 h-4 text-white" />
                </div>
              </div>
            </div>
            
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">
              SafeVideo KYC
            </h1>
            <p className="mt-2 text-gray-600">
              セキュアなFirebase認証システム
            </p>
            <p className="mt-1 text-xs text-gray-500">
              httpOnly Cookie + CSRF保護実装済み
            </p>
          </div>

          {/* エラー表示 */}
          {initError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start">
                <AlertTriangle className="w-5 h-5 text-red-600 mr-2 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-red-800">{initError}</div>
              </div>
            </div>
          )}

          {/* セキュリティステータス */}
          {renderSecurityStatus()}

          {/* ログインフォーム */}
          <div className="mt-8">
            {sessionInitialized ? (
              <FirebaseAuthUI 
                onAuthSuccess={handleAuthSuccess}
                mode="login"
              />
            ) : (
              <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8">
                <div className="text-center text-gray-600">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                  <p>セキュアセッションを初期化中...</p>
                </div>
              </div>
            )}
          </div>

          {/* セキュリティ情報 */}
          <div className="mt-6 bg-gray-50 rounded-lg p-4 border border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">
              強化されたセキュリティ機能
            </h3>
            <ul className="text-xs text-gray-600 space-y-1">
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                httpOnly Cookieによるトークン管理
              </li>
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                CSRF保護（X-CSRF-Token）
              </li>
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                メモリベース認証（localStorage不使用）
              </li>
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                自動セッションタイムアウト
              </li>
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                レート制限とブルートフォース対策
              </li>
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                包括的な監査ログ記録
              </li>
            </ul>
          </div>

          {/* フッター */}
          <div className="text-center text-xs text-gray-500">
            <p>© 2025 SafeVideo KYC. All rights reserved.</p>
            <p className="mt-1">
              Powered by Firebase • Protected by Enterprise Security
            </p>
          </div>
        </div>
      </div>

      {/* レスポンシブ対応のためのメディアクエリ用スタイル */}
      <style jsx>{`
        @media (max-width: 640px) {
          .min-h-screen {
            min-height: 100vh;
            min-height: -webkit-fill-available;
          }
        }
        
        /* アニメーション */
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
};

export default EnhancedSecureFirebaseLoginPage;