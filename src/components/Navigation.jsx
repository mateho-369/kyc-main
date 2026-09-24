import React from 'react';
import { FiHome as Home, FiShield as Shield, FiUser as User, FiFileText as FileText, FiX as Close } from 'react-icons/fi';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/**
 * サイドバー。広い画面（lg〜）は常時表示、狭い画面は Header のメニューボタンで
 * 開くドロワーとして表示する。中身（sidebar）は同じ要素を使い回す。
 */
const Navigation = ({ mobileOpen = false, onClose = () => {} }) => {
  const location = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const isActive = (path) => {
    if (path === '/') {
      return location.pathname === '/';
    }
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  const navItems = [
    {
      path: '/',
      icon: Home,
      label: 'ダッシュボード',
      description: '概要を確認',
    },
    {
      path: '/performers',
      icon: User,
      label: isAdmin ? '全出演者' : 'マイ出演者',
      description: '登録情報を管理',
    },
  ];

  // Admin-only items can be added here
  if (isAdmin) {
    navItems.push({
      path: '/admin/users',
      icon: User,
      label: 'ユーザー一覧',
      description: '全ユーザー管理',
    });
    navItems.push({
      path: '/audit-logs',
      icon: FileText,
      label: '監査ログ',
      description: '操作履歴',
    });
  }

  const sidebar = (
    <>
      {/* Logo Section */}
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gold-400 to-gold-500 flex items-center justify-center">
            <Shield className="w-5 h-5 text-navy-900" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white font-display">Id Manager</h1>
            <p className="text-xs text-navy-400">身元確認管理システム</p>
          </div>
        </div>
      </div>

      {/* Navigation Items */}
      <nav className="mt-6 px-3">
        <div className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`sidebar-nav-item group rounded-xl ${active ? 'active' : ''}`}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors duration-200 ${
                  active
                    ? 'bg-gold-500/20 text-gold-400'
                    : 'bg-white/5 text-navy-400 group-hover:bg-white/10 group-hover:text-white'
                }`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="ml-3">
                  <p className={`text-sm font-medium ${active ? 'text-white' : 'text-navy-300 group-hover:text-white'}`}>
                    {item.label}
                  </p>
                  <p className="text-xs text-navy-500 group-hover:text-navy-400">
                    {item.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Bottom Section */}
      <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-white/10">
        <div className="px-4 py-3 rounded-xl bg-white/5">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-navy-600 to-navy-700 flex items-center justify-center overflow-hidden">
              {user?.profilePicture ? (
                <img
                  src={user.profilePicture}
                  alt=""
                  className="w-8 h-8 object-cover"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              ) : (
                <User className="w-4 h-4 text-navy-300" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {user?.name || user?.email?.split('@')[0] || 'ユーザー'}
              </p>
              <p className="text-xs text-navy-500">
                {isAdmin ? '管理者' : 'スタンダード'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      <aside className="sidebar-nav relative w-64 min-h-screen hidden lg:block">{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="メニュー">
          <button
            type="button"
            aria-label="メニューを閉じる"
            onClick={onClose}
            className="absolute inset-0 bg-navy-900/60 backdrop-blur-sm"
          />
          <aside className="sidebar-nav relative w-64 min-h-screen shadow-2xl" onClick={onClose}>
            <button
              type="button"
              onClick={onClose}
              aria-label="メニューを閉じる"
              className="absolute top-5 right-3 p-2 rounded-lg text-navy-300 hover:text-white hover:bg-white/10"
            >
              <Close className="w-5 h-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
    </>
  );
};

export default Navigation;
