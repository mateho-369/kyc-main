import React, { useState, useEffect } from 'react';
import { FiUsers as Users, FiAlertCircle as AlertCircle, FiPlus as Plus, FiRefreshCw as RefreshCw, FiArrowRight as ArrowRight, FiTrendingUp as TrendingUp, FiShield as Shield, FiClock as Clock } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { getDashboardStats } from '../services/dashboardService';
import { getUserRole } from '../services/auth';
import { trackError } from '../services/firebaseAnalytics';

const DashboardPage = () => {
  const [stats, setStats] = useState({
    totalPerformers: 0,
    pendingVerification: 0,
    recentlyUpdated: 0,
    expiringDocuments: 0,
    recentActivity: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userRole, setUserRole] = useState('user');

  const fetchStats = async () => {
    setLoading(true);
    try {
      const data = await getDashboardStats();
      setStats({
        totalPerformers: data.totalPerformers || 0,
        pendingVerification: data.pendingVerification || 0,
        recentlyUpdated: data.recentlyUpdated || 0,
        expiringDocuments: data.expiringDocuments || 0,
        recentActivity: data.recentActivity || []
      });

      console.log('dashboard_stats_viewed', {
        totalPerformers: data.totalPerformers,
        pendingVerification: data.pendingVerification,
        userRole: userRole
      });
    } catch (err) {
      const errorMsg = '統計情報の取得に失敗しました';
      setError(errorMsg);
      console.error(err);
      trackError('dashboard_stats_error', errorMsg, err.stack);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    console.log('Dashboard Page');

    const initRole = async () => {
      const role = await getUserRole();
      setUserRole(role);
    };
    initRole();

    fetchStats();
  }, []);

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

  const isAdmin = userRole === 'admin';

  return (
    <div className="animate-fade-in">
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-navy-900 font-display">ダッシュボード</h1>
            <p className="mt-1 text-navy-500">本人確認管理システムの概要</p>
          </div>
          <div className="mt-4 sm:mt-0 flex items-center space-x-3">
            <button
              onClick={fetchStats}
              className="btn-secondary"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              更新
            </button>
            <Link to="/performers/add" className="btn-gold">
              <Plus className="w-4 h-4 mr-2" />
              新規登録
            </Link>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-danger-50 border border-danger-200 animate-fade-in">
          <div className="flex items-center">
            <AlertCircle className="w-5 h-5 text-danger-500 mr-3" />
            <p className="text-danger-600 text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Total Performers */}
        <div className="stats-card stats-card-gold animate-fade-in-up stagger-1">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-navy-500">登録出演者数</p>
              <p className="mt-2 text-3xl font-bold text-navy-900 font-display">{stats.totalPerformers}</p>
              <p className="mt-1 text-xs text-navy-400">
                <span className="text-success-600 font-medium">アクティブ</span>
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-gold-100 to-gold-200 flex items-center justify-center">
              <Users className="w-6 h-6 text-gold-600" />
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-navy-100">
            <Link
              to="/performers"
              className="inline-flex items-center text-sm font-medium text-gold-600 hover:text-gold-700 transition-colors"
            >
              すべて表示
              <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </div>
        </div>

        {/* Pending Verification - Admin Only */}
        {isAdmin && (
          <div className="stats-card animate-fade-in-up stagger-2">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-navy-500">検証待ち</p>
                <p className="mt-2 text-3xl font-bold text-navy-900 font-display">{stats.pendingVerification}</p>
                <p className="mt-1 text-xs text-navy-400">
                  <span className="text-warning-600 font-medium">要確認</span>
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-warning-50 to-warning-100 flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-warning-600" />
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-navy-100">
              <Link
                to="/performers?status=pending"
                className="inline-flex items-center text-sm font-medium text-navy-600 hover:text-navy-800 transition-colors"
              >
                確認する
                <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </div>
          </div>
        )}

        {/* Recently Updated */}
        <div className="stats-card animate-fade-in-up stagger-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-navy-500">最近の更新</p>
              <p className="mt-2 text-3xl font-bold text-navy-900 font-display">{stats.recentlyUpdated}</p>
              <p className="mt-1 text-xs text-navy-400">過去7日間</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-success-50 to-success-100 flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-success-600" />
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-navy-100">
            <span className="text-sm text-navy-400">更新履歴</span>
          </div>
        </div>

        {/* Security Status - Admin Only */}
        {isAdmin && (
          <div className="stats-card animate-fade-in-up stagger-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-navy-500">セキュリティ</p>
                <p className="mt-2 text-lg font-bold text-success-600 font-display">正常稼働中</p>
                <p className="mt-1 text-xs text-navy-400">すべてのシステムが正常</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-navy-100 to-navy-200 flex items-center justify-center">
                <Shield className="w-6 h-6 text-navy-600" />
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-navy-100">
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 bg-success-500 rounded-full animate-pulse"></span>
                <span className="text-sm text-navy-500">SSL暗号化済み</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity Card */}
        <div className="lg:col-span-2 card-premium p-6 animate-fade-in-up stagger-5">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-navy-900 font-display">クイックアクション</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Link
              to="/performers/add"
              className="group p-4 rounded-xl border border-navy-100 hover:border-gold-200 hover:bg-gold-50/50 transition-all duration-200"
            >
              <div className="flex items-center space-x-4">
                <div className="w-10 h-10 rounded-lg bg-gold-100 flex items-center justify-center group-hover:bg-gold-200 transition-colors">
                  <Plus className="w-5 h-5 text-gold-600" />
                </div>
                <div>
                  <p className="font-medium text-navy-900">新規出演者登録</p>
                  <p className="text-sm text-navy-500">本人確認情報を登録</p>
                </div>
              </div>
            </Link>

            <Link
              to="/performers"
              className="group p-4 rounded-xl border border-navy-100 hover:border-navy-200 hover:bg-navy-50/50 transition-all duration-200"
            >
              <div className="flex items-center space-x-4">
                <div className="w-10 h-10 rounded-lg bg-navy-100 flex items-center justify-center group-hover:bg-navy-200 transition-colors">
                  <Users className="w-5 h-5 text-navy-600" />
                </div>
                <div>
                  <p className="font-medium text-navy-900">出演者一覧</p>
                  <p className="text-sm text-navy-500">登録済み情報を確認</p>
                </div>
              </div>
            </Link>

            {isAdmin && (
              <Link
                to="/audit-logs"
                className="group p-4 rounded-xl border border-navy-100 hover:border-navy-200 hover:bg-navy-50/50 transition-all duration-200"
              >
                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 rounded-lg bg-navy-100 flex items-center justify-center group-hover:bg-navy-200 transition-colors">
                    <Clock className="w-5 h-5 text-navy-600" />
                  </div>
                  <div>
                    <p className="font-medium text-navy-900">監査ログ</p>
                    <p className="text-sm text-navy-500">操作履歴を確認</p>
                  </div>
                </div>
              </Link>
            )}
          </div>
        </div>

        {/* System Status Card - Admin Only */}
        {isAdmin && (
          <div className="card-premium p-6 animate-fade-in-up stagger-5">
            <h2 className="text-lg font-semibold text-navy-900 font-display mb-4">システム状態</h2>

            <div className="space-y-4">
              <div className="flex items-center justify-between py-3 border-b border-navy-100">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-success-500 rounded-full"></div>
                  <span className="text-sm text-navy-700">APIサーバー</span>
                </div>
                <span className="text-xs font-medium text-success-600 bg-success-50 px-2 py-1 rounded-full">稼働中</span>
              </div>

              <div className="flex items-center justify-between py-3 border-b border-navy-100">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-success-500 rounded-full"></div>
                  <span className="text-sm text-navy-700">データベース</span>
                </div>
                <span className="text-xs font-medium text-success-600 bg-success-50 px-2 py-1 rounded-full">正常</span>
              </div>

              <div className="flex items-center justify-between py-3">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-success-500 rounded-full"></div>
                  <span className="text-sm text-navy-700">ストレージ</span>
                </div>
                <span className="text-xs font-medium text-success-600 bg-success-50 px-2 py-1 rounded-full">正常</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardPage;
