import React, { useEffect, useState } from 'react';
import { FiUser as User, FiChevronRight as ChevronRight, FiArrowLeft as ArrowLeft, FiAlertCircle as AlertCircle, FiMail as Mail, FiShield as Shield, FiClock as Clock, FiCalendar as Calendar } from 'react-icons/fi';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getAdminUserDetail } from '../services/adminUserService';

const UserDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const fetchUserDetail = async () => {
      setLoading(true);
      try {
        const data = await getAdminUserDetail(id);
        setUserData(data);
        setError('');
      } catch (err) {
        console.error('ユーザー詳細取得エラー:', err);
        if (err.response?.status === 404) {
          setError('ユーザーが見つかりません。');
        } else if (err.response?.status === 403) {
          setError('管理者権限が必要です。');
        } else {
          setError('ユーザー情報の取得に失敗しました。');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchUserDetail();
  }, [id, retryCount]);

  const getRoleBadge = (role) => {
    if (role === 'admin') {
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">管理者</span>;
    }
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">一般</span>;
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'active':
        return <span className="badge badge-success">有効</span>;
      case 'pending':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">保留</span>;
      case 'rejected':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">却下</span>;
      case 'inactive':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">無効</span>;
      default:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">{status || '-'}</span>;
    }
  };

  const getKycStatusBadge = (kycStatus) => {
    switch (kycStatus) {
      case 'verified':
        return <span className="badge badge-success">確認済</span>;
      case 'in_progress':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">確認中</span>;
      case 'rejected':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">却下</span>;
      case 'expired':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">期限切れ</span>;
      case 'not_started':
      default:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">未開始</span>;
    }
  };

  const getAuthProviderLabel = (provider) => {
    switch (provider) {
      case 'firebase': return 'Firebase';
      case 'hybrid': return 'ハイブリッド';
      case 'jwt':
      default: return 'JWT';
    }
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <div className="loading-spinner mx-auto mb-4"></div>
          <p className="text-navy-500 text-sm">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto py-12">
        <div className="card-premium p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-danger-50 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-danger-500" />
          </div>
          <h3 className="text-lg font-semibold text-navy-900 mb-2">エラーが発生しました</h3>
          <p className="text-navy-500 mb-6">{error}</p>
          <div className="flex items-center justify-center space-x-4">
            <button
              onClick={() => {
                setError('');
                setRetryCount(retryCount + 1);
              }}
              className="btn-primary"
            >
              再試行
            </button>
            <button
              onClick={() => navigate('/admin/users')}
              className="btn-secondary"
            >
              ユーザー一覧に戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!userData) return null;

  const performers = userData.Performers || [];

  return (
    <div className="animate-fade-in">
      {/* Back Button */}
      <div className="mb-6">
        <button
          onClick={() => navigate('/admin/users')}
          className="flex items-center text-navy-500 hover:text-navy-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          <span className="text-sm">ユーザー一覧に戻る</span>
        </button>
      </div>

      {/* User Info Card */}
      <div className="card-premium p-6 mb-6">
        <div className="flex items-start space-x-4">
          <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-navy-100 to-navy-200 flex items-center justify-center flex-shrink-0">
            <User className="w-8 h-8 text-navy-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-navy-900 font-display">{userData.name}</h1>
            <div className="flex items-center space-x-3 mt-2">
              {getRoleBadge(userData.role)}
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${userData.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                {userData.isActive ? 'アクティブ' : '非アクティブ'}
              </span>
            </div>
          </div>
        </div>

        {/* User Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6 pt-6 border-t border-navy-100">
          <div className="flex items-center space-x-3">
            <Mail className="w-5 h-5 text-navy-400" />
            <div>
              <p className="text-xs text-navy-500">メールアドレス</p>
              <p className="text-sm text-navy-900">{userData.email}</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <Shield className="w-5 h-5 text-navy-400" />
            <div>
              <p className="text-xs text-navy-500">認証方式</p>
              <p className="text-sm text-navy-900">{getAuthProviderLabel(userData.authProvider)}</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <Calendar className="w-5 h-5 text-navy-400" />
            <div>
              <p className="text-xs text-navy-500">登録日</p>
              <p className="text-sm text-navy-900">{formatDateTime(userData.createdAt)}</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <Clock className="w-5 h-5 text-navy-400" />
            <div>
              <p className="text-xs text-navy-500">最終ログイン</p>
              <p className="text-sm text-navy-900">{formatDateTime(userData.lastLoginAt)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Performers Section */}
      <div className="mb-4">
        <h2 className="text-lg font-bold text-navy-900 font-display">
          出演者一覧
          <span className="ml-2 text-sm font-normal text-navy-500">({performers.length}件)</span>
        </h2>
      </div>

      <div className="card-premium overflow-hidden">
        {performers.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-full bg-navy-50 flex items-center justify-center mx-auto mb-4">
              <User className="w-8 h-8 text-navy-300" />
            </div>
            <h3 className="text-base font-medium text-navy-900 mb-2">出演者が登録されていません</h3>
            <p className="text-sm text-navy-500">このユーザーにはまだ出演者が登録されていません</p>
          </div>
        ) : (
          <>
            {/* Table Header */}
            <div className="hidden lg:grid lg:grid-cols-12 gap-4 px-5 py-3 bg-navy-50 text-xs font-medium text-navy-500 uppercase tracking-wider">
              <div className="col-span-4">出演者名</div>
              <div className="col-span-2">ステータス</div>
              <div className="col-span-2">KYCステータス</div>
              <div className="col-span-3">登録日</div>
              <div className="col-span-1"></div>
            </div>

            {/* Table Body */}
            <div className="divide-y divide-navy-100">
              {performers.map((performer, index) => (
                <Link
                  key={performer.id}
                  to={`/performers/${performer.id}`}
                  className="block px-5 py-4 hover:bg-navy-50/50 transition-colors duration-200 animate-fade-in-up lg:grid lg:grid-cols-12 lg:gap-4 lg:items-center"
                  style={{ animationDelay: `${index * 0.03}s` }}
                >
                  {/* 出演者名 */}
                  <div className="col-span-4 flex items-center space-x-3 mb-2 lg:mb-0">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-navy-100 to-navy-200 flex items-center justify-center flex-shrink-0">
                      <User className="w-5 h-5 text-navy-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-navy-900 truncate">
                        {performer.lastName} {performer.firstName}
                      </p>
                      <p className="text-xs text-navy-500 truncate">
                        {performer.lastNameRoman} {performer.firstNameRoman}
                      </p>
                    </div>
                  </div>

                  {/* ステータス */}
                  <div className="col-span-2 mb-2 lg:mb-0">
                    {getStatusBadge(performer.status)}
                  </div>

                  {/* KYCステータス */}
                  <div className="col-span-2 mb-2 lg:mb-0">
                    {getKycStatusBadge(performer.kycStatus)}
                  </div>

                  {/* 登録日 */}
                  <div className="col-span-3 mb-2 lg:mb-0">
                    <span className="text-sm text-navy-500">{formatDateTime(performer.createdAt)}</span>
                  </div>

                  {/* 矢印 */}
                  <div className="col-span-1 flex justify-end">
                    <ChevronRight className="w-5 h-5 text-navy-400" />
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default UserDetailPage;
