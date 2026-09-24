import React, { useEffect, useState } from 'react';
import { FiUser as User, FiSearch as Search, FiChevronRight as ChevronRight, FiAlertCircle as AlertCircle, FiChevronLeft as ChevronLeft } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { getAdminUsers } from '../services/adminUserService';

const AdminUsersPage = () => {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 20, totalPages: 0 });
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const fetchUsers = async () => {
      setLoading(true);
      try {
        const result = await getAdminUsers({
          search: searchQuery,
          page: pagination.page,
          limit: pagination.limit
        });

        if (result.success) {
          setUsers(result.data);
          setPagination(prev => ({ ...prev, ...result.pagination }));
          setError('');
        } else {
          setError('ユーザー情報の取得に失敗しました');
        }
      } catch (err) {
        console.error('ユーザー一覧取得エラー:', err);
        if (err.response?.status === 401) {
          setError('認証が必要です。ログインしてください。');
        } else if (err.response?.status === 403) {
          setError('管理者権限が必要です。');
        } else {
          setError('ユーザー情報の取得に失敗しました。');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, [searchQuery, pagination.page, retryCount]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPagination(prev => ({ ...prev, page: 1 }));
    setSearchQuery(searchInput);
  };

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      setPagination(prev => ({ ...prev, page: newPage }));
    }
  };

  const getRoleBadge = (role) => {
    if (role === 'admin') {
      return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">管理者</span>;
    }
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">一般</span>;
  };

  const getAuthProviderLabel = (provider) => {
    switch (provider) {
      case 'firebase': return 'Firebase';
      case 'hybrid': return 'ハイブリッド';
      case 'jwt':
      default: return 'JWT';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
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
              onClick={() => navigate('/')}
              className="btn-secondary"
            >
              ダッシュボードに戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy-900 font-display">ユーザー一覧</h1>
        <p className="mt-1 text-navy-500">システムに登録されている全ユーザー</p>
      </div>

      {/* Search Bar */}
      <div className="card-premium p-4 mb-6">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-navy-400" />
            <input
              type="text"
              placeholder="名前・メールアドレスで検索..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="input-premium pl-12"
            />
          </div>
          <div className="flex items-center space-x-3">
            <button type="submit" className="btn-primary">
              <Search className="w-4 h-4 mr-2" />
              検索
            </button>
            <div className="hidden sm:flex items-center px-4 py-2 bg-navy-50 rounded-xl">
              <span className="text-sm font-medium text-navy-700">{pagination.total}</span>
              <span className="text-sm text-navy-500 ml-1">件</span>
            </div>
          </div>
        </form>
      </div>

      {/* Users Table */}
      <div className="card-premium overflow-hidden">
        {users.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-full bg-navy-50 flex items-center justify-center mx-auto mb-4">
              <User className="w-10 h-10 text-navy-300" />
            </div>
            <h3 className="text-lg font-medium text-navy-900 mb-2">ユーザーが見つかりません</h3>
            <p className="text-navy-500">検索条件を変更してください</p>
          </div>
        ) : (
          <>
            {/* Table Header */}
            <div className="hidden lg:grid lg:grid-cols-12 gap-4 px-5 py-3 bg-navy-50 text-xs font-medium text-navy-500 uppercase tracking-wider">
              <div className="col-span-3">ユーザー</div>
              <div className="col-span-2">ロール</div>
              <div className="col-span-2">認証方式</div>
              <div className="col-span-1 text-center">出演者数</div>
              <div className="col-span-2">最終ログイン</div>
              <div className="col-span-1">登録日</div>
              <div className="col-span-1"></div>
            </div>

            {/* Table Body */}
            <div className="divide-y divide-navy-100">
              {users.map((userItem, index) => (
                <div
                  key={userItem.id}
                  onClick={() => navigate(`/admin/users/${userItem.id}`)}
                  className="px-5 py-4 hover:bg-navy-50/50 transition-colors duration-200 cursor-pointer animate-fade-in-up lg:grid lg:grid-cols-12 lg:gap-4 lg:items-center"
                  style={{ animationDelay: `${index * 0.03}s` }}
                >
                  {/* ユーザー情報 */}
                  <div className="col-span-3 flex items-center space-x-3 mb-2 lg:mb-0">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-navy-100 to-navy-200 flex items-center justify-center flex-shrink-0">
                      <User className="w-5 h-5 text-navy-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-navy-900 truncate">{userItem.name}</p>
                      <p className="text-xs text-navy-500 truncate">{userItem.email}</p>
                    </div>
                  </div>

                  {/* ロール */}
                  <div className="col-span-2 mb-2 lg:mb-0">
                    {getRoleBadge(userItem.role)}
                  </div>

                  {/* 認証方式 */}
                  <div className="col-span-2 mb-2 lg:mb-0">
                    <span className="text-sm text-navy-600">{getAuthProviderLabel(userItem.authProvider)}</span>
                  </div>

                  {/* 出演者数 */}
                  <div className="col-span-1 text-center mb-2 lg:mb-0">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-navy-50 text-sm font-medium text-navy-700">
                      {userItem.performerCount ?? 0}
                    </span>
                  </div>

                  {/* 最終ログイン */}
                  <div className="col-span-2 mb-2 lg:mb-0">
                    <span className="text-sm text-navy-500">{formatDateTime(userItem.lastLoginAt)}</span>
                  </div>

                  {/* 登録日 */}
                  <div className="col-span-1 mb-2 lg:mb-0">
                    <span className="text-sm text-navy-500">{formatDate(userItem.createdAt)}</span>
                  </div>

                  {/* 矢印 */}
                  <div className="col-span-1 flex justify-end">
                    <ChevronRight className="w-5 h-5 text-navy-400" />
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="px-5 py-4 border-t border-navy-100 flex items-center justify-between">
                <p className="text-sm text-navy-500">
                  全 {pagination.total} 件中 {(pagination.page - 1) * pagination.limit + 1} - {Math.min(pagination.page * pagination.limit, pagination.total)} 件
                </p>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handlePageChange(pagination.page - 1)}
                    disabled={pagination.page <= 1}
                    className="p-2 rounded-lg text-navy-400 hover:text-navy-600 hover:bg-navy-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <span className="text-sm text-navy-700 px-3">
                    {pagination.page} / {pagination.totalPages}
                  </span>
                  <button
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={pagination.page >= pagination.totalPages}
                    className="p-2 rounded-lg text-navy-400 hover:text-navy-600 hover:bg-navy-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default AdminUsersPage;
