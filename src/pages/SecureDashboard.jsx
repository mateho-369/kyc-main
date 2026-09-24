import React, { useEffect, useState } from 'react';
import { FiActivity as Activity, FiAlertCircle as AlertCircle, FiCheckCircle as CheckCircle, FiLock as Lock, FiShield as Shield, FiUser as User } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { useSecureFirebaseAuth } from '../contexts/SecureFirebaseAuthContext';
import { useSecureApi } from '../hooks/useSecureApi';
// const SecureDashboard = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout, getSecurityStatus } = useSecureFirebaseAuth();
  const [securityStatus, setSecurityStatus] = useState(null);
  
  // ユーザープロフィールAPI
  const { data: profile, loading: profileLoading, error: profileError } = useSecureApi(
    '/user/profile',
    { autoFetch: true }
  );
  
  // KYCステータスAPI
  const { data: kycStatus, loading: kycLoading } = useSecureApi(
    '/user/kyc-status',
    { autoFetch: true }
  );

  // セキュリティステータスの更新
  useEffect(() => {
    const interval = setInterval(() => {
      const status = getSecurityStatus();
      setSecurityStatus(status);
    }, 5000); // 5秒ごとに更新

    return () => clearInterval(interval);
  }, [getSecurityStatus]);

  // 認証チェック
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  // ログアウト処理
  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('ログアウトエラー:', error);
    }
  };

  // セキュリティステータスカード
  const renderSecurityCard = () => {
    if (!securityStatus) return null;

    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center mb-4">
          <Shield className="w-6 h-6 text-blue-600 mr-2" />
          <h2 className="text-lg font-semibold">セキュリティステータス</h2>
        </div>
        
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">HTTPS接続</span>
            {securityStatus.isHttps ? (
              <CheckCircle className="w-5 h-5 text-green-500" />
            ) : (
              <AlertCircle className="w-5 h-5 text-yellow-500" />
            )}
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">認証状態</span>
            {securityStatus.isAuthenticated ? (
              <CheckCircle className="w-5 h-5 text-green-500" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-500" />
            )}
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">セッション保護</span>
            {securityStatus.sessionActive ? (
              <CheckCircle className="w-5 h-5 text-green-500" />
            ) : (
              <AlertCircle className="w-5 h-5 text-yellow-500" />
            )}
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">ログイン制限</span>
            <span className="text-sm text-gray-700">
              残り {securityStatus.remainingAttempts || 5} 回
            </span>
          </div>
        </div>
      </div>
    );
  };

  // ユーザー情報カード
  const renderUserCard = () => {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center mb-4">
          <User className="w-6 h-6 text-blue-600 mr-2" />
          <h2 className="text-lg font-semibold">ユーザー情報</h2>
        </div>
        
        {profileLoading ? (
          <div className="animate-pulse space-y-2">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        ) : profileError ? (
          <div className="text-red-600 text-sm">{profileError}</div>
        ) : profile ? (
          <div className="space-y-2">
            <div className="text-sm">
              <span className="text-gray-600">名前:</span>
              <span className="ml-2 font-medium">{profile.name || user?.displayName || '未設定'}</span>
            </div>
            <div className="text-sm">
              <span className="text-gray-600">メール:</span>
              <span className="ml-2 font-medium">{user?.email}</span>
            </div>
            <div className="text-sm">
              <span className="text-gray-600">役割:</span>
              <span className="ml-2 font-medium">{profile.role || '一般ユーザー'}</span>
            </div>
            <div className="text-sm">
              <span className="text-gray-600">登録日:</span>
              <span className="ml-2 font-medium">
                {profile.createdAt ? new Date(profile.createdAt).toLocaleDateString('ja-JP') : '不明'}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  // KYCステータスカード
  const renderKycCard = () => {
    const getStatusColor = (status) => {
      switch (status) {
        case 'verified': return 'text-green-600 bg-green-50';
        case 'pending': return 'text-yellow-600 bg-yellow-50';
        case 'rejected': return 'text-red-600 bg-red-50';
        default: return 'text-gray-600 bg-gray-50';
      }
    };

    const getStatusText = (status) => {
      switch (status) {
        case 'verified': return '認証済み';
        case 'pending': return '審査中';
        case 'rejected': return '却下';
        default: return '未申請';
      }
    };

    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center mb-4">
          <Activity className="w-6 h-6 text-blue-600 mr-2" />
          <h2 className="text-lg font-semibold">KYCステータス</h2>
        </div>
        
        {kycLoading ? (
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-24"></div>
          </div>
        ) : kycStatus ? (
          <div className="space-y-3">
            <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(kycStatus.status)}`}>
              {getStatusText(kycStatus.status)}
            </div>
            
            {kycStatus.status === 'verified' && kycStatus.expiresAt && (
              <div className="text-sm text-gray-600">
                有効期限: {new Date(kycStatus.expiresAt).toLocaleDateString('ja-JP')}
              </div>
            )}
            
            {kycStatus.status === 'pending' && (
              <div className="text-sm text-gray-600">
                申請日: {new Date(kycStatus.submittedAt).toLocaleDateString('ja-JP')}
              </div>
            )}
            
            {kycStatus.status === 'rejected' && kycStatus.reason && (
              <div className="text-sm text-red-600">
                理由: {kycStatus.reason}
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-gray-600">
            KYC申請が必要です
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <Lock className="w-8 h-8 text-blue-600 mr-3" />
              <h1 className="text-2xl font-bold text-gray-900">
                セキュアダッシュボード
              </h1>
            </div>
            
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {renderSecurityCard()}
          {renderUserCard()}
          {renderKycCard()}
        </div>

        {/* アクティビティセクション */}
        <div className="mt-8 bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">最近のアクティビティ</h2>
          <div className="space-y-3">
            <div className="flex items-center text-sm">
              <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
              <span className="text-gray-600">ログイン成功</span>
              <span className="ml-auto text-gray-500">今</span>
            </div>
            <div className="flex items-center text-sm">
              <div className="w-2 h-2 bg-blue-500 rounded-full mr-3"></div>
              <span className="text-gray-600">プロフィール更新</span>
              <span className="ml-auto text-gray-500">2時間前</span>
            </div>
            <div className="flex items-center text-sm">
              <div className="w-2 h-2 bg-yellow-500 rounded-full mr-3"></div>
              <span className="text-gray-600">KYC申請</span>
              <span className="ml-auto text-gray-500">昨日</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default SecureDashboard;