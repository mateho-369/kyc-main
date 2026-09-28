import React, { useState, useCallback } from 'react';
import NotificationInfoDialog from './NotificationInfoDialog';
import { FiLogOut as LogOut, FiShield as Shield, FiUser as User, FiBell as Bell, FiMenu as Menu } from 'react-icons/fi';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/**
 * @param {(e: React.MouseEvent) => void} [onToggleNav] - 狭い画面でのサイドバー開閉。
 *   App.jsx の MainLayout が状態を持つ（Header と Navigation は兄弟なのでここで受ける）。
 */
const Header = ({ onToggleNav, navOpen = false, roleLabel }) => {
  const navigate = useNavigate();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const closeNotifications = useCallback(() => setNotificationsOpen(false), []);
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="bg-white border-b border-navy-100 sticky top-0 z-30">
      <div className="px-3 sm:px-6 py-3 sm:py-4">
        <div className="flex items-center justify-between">
          {/* Logo & Brand */}
          <div className="flex items-center space-x-4">
            {/* 従来はこのボタンに onClick が無く、モバイルではナビへ到達できなかった */}
            <button
              type="button"
              onClick={onToggleNav}
              aria-label={navOpen ? 'メニューを閉じる' : 'メニューを開く'}
              aria-expanded={navOpen}
              aria-controls={navOpen ? 'mobile-navigation' : undefined}
              className="lg:hidden p-2 rounded-lg hover:bg-navy-50 text-navy-600"
            >
              <Menu className="w-5 h-5" />
            </button>

            <Link to="/" className="flex items-center space-x-3 group">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gold-400 to-gold-500 flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow duration-200">
                <Shield className="w-5 h-5 text-navy-900" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-lg font-bold text-navy-900 font-display leading-none">
                  Id Manager
                </h1>
                <p className="text-xs text-navy-400">.com</p>
              </div>
            </Link>
          </div>

          {/* Right Side Actions */}
          <div className="flex items-center space-x-4">
            {/* No unread badge without an inbox API. Explain available status information instead. */}
            <button
              type="button"
              onClick={() => setNotificationsOpen(true)}
              title="通知について"
              aria-label="通知について"
              aria-haspopup="dialog"
              className="relative p-3 rounded-xl text-navy-500 hover:bg-navy-50"
            >
              <Bell className="w-5 h-5" />
            </button>

            {/* User Info */}
            {user && (
              <div className="hidden md:flex items-center space-x-3 pl-4 border-l border-navy-100">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-navy-100 to-navy-200 flex items-center justify-center">
                  <User className="w-4 h-4 text-navy-600" />
                </div>
                <div className="text-sm min-w-0 max-w-48">
                  <p className="font-medium text-navy-900 leading-none truncate">
                    {user.name || user.email?.split('@')[0]}
                  </p>
                  <p className="text-xs text-navy-500 mt-0.5 flex items-center">
                    {roleLabel || (isAdmin ? (
                      <>
                        <span className="w-1.5 h-1.5 bg-gold-500 rounded-full mr-1.5"></span>
                        管理者
                      </>
                    ) : (
                      <>
                        <span className="w-1.5 h-1.5 bg-success-500 rounded-full mr-1.5"></span>
                        ユーザー
                      </>
                    ))}
                  </p>
                </div>
              </div>
            )}

            {/* Logout Button */}
            <button
              onClick={handleLogout}
              aria-label="ログアウト"
              className="flex items-center space-x-2 px-4 py-2 rounded-xl text-navy-600 hover:text-navy-900 hover:bg-navy-50 transition-all duration-200"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline text-sm font-medium">ログアウト</span>
            </button>
          </div>
        </div>
      </div>
      <NotificationInfoDialog open={notificationsOpen} onClose={closeNotifications} />
    </header>
  );
};

export default Header;
