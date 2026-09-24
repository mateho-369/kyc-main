import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './contexts/AuthContext';
import Navigation from './components/Navigation';
import Header from './components/Header';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import PerformersPage from './pages/PerformersPage';
import PerformerDetailPage from './pages/PerformerDetailPage';
import AddPerformerPage from './pages/AddPerformerPage';
import AuditLogsPage from './pages/AuditLogsPage';
import AdminUsersPage from './pages/AdminUsersPage';
import UserDetailPage from './pages/UserDetailPage';
import SSOPage from './pages/SSOPage';
import KYCSharegramGateway from './components/sharegram/SharegramGateway';
import DebugTools from './components/DebugTools';
import OfflineNotification from './components/OfflineNotification';
import FirebaseAutoAuth from './components/auth/FirebaseAutoAuth';
// 共通（認証不要）ページ。LoginPage から /terms・/privacy へリンクがあるため
// ルートが必須（以前はリンク先が / へリダイレクトしていた）。
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';
import FAQsPage from './pages/FAQsPage';
import ContactPage from './pages/ContactPage';
import CancellationPage from './pages/CancellationPage';

// Protected Route コンポーネント（リダイレクトループ対策）
const ProtectedRoute = ({ children }) => {
  const { user, isAuthenticated, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }
  
  if (!isAuthenticated) {
    // 現在のパスを保存して、ログイン後に戻れるようにする
    // ただし、ルートパス（/）の場合はredirectパラメータを付けない（ループ防止）
    const currentPath = window.location.pathname;
    const shouldRedirect = currentPath && currentPath !== '/' && currentPath !== '/login';
    
    const redirectUrl = shouldRedirect ? `/login?redirect=${encodeURIComponent(currentPath)}` : '/login';
    
    console.log('認証が必要 - リダイレクト:', redirectUrl);
    return <Navigate to={redirectUrl} replace />;
  }
  
  return children;
};

// Main Layout コンポーネント
// ヘッダーのメニューボタンとナビは兄弟なので、開閉状態はここで持つ。
const MainLayout = ({ children }) => {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex flex-col min-h-screen">
      <Header onToggleNav={() => setNavOpen((open) => !open)} />
      <div className="flex flex-1">
        <Navigation mobileOpen={navOpen} onClose={() => setNavOpen(false)} />
        <main className="flex-1 bg-gray-100">
          <div className="container mx-auto px-4 py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/sso" element={<SSOPage />} />
          <Route path="/firebase-login" element={<KYCSharegramGateway />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/faq" element={<FAQsPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/cancellation" element={<CancellationPage />} />
          
          {/* Protected Routes */}
          <Route path="/" element={
            <ProtectedRoute>
              <MainLayout>
                <DashboardPage />
              </MainLayout>
            </ProtectedRoute>
          } />
          
          <Route path="/performers" element={
            <ProtectedRoute>
              <MainLayout>
                <PerformersPage />
              </MainLayout>
            </ProtectedRoute>
          } />

          <Route path="/performers/add" element={
            <ProtectedRoute>
              <MainLayout>
                <AddPerformerPage />
              </MainLayout>
            </ProtectedRoute>
          } />

          <Route path="/performers/:id" element={
            <ProtectedRoute>
              <MainLayout>
                <PerformerDetailPage />
              </MainLayout>
            </ProtectedRoute>
          } />

          <Route path="/performers/:id/edit" element={
            <ProtectedRoute>
              <MainLayout>
                <AddPerformerPage />
              </MainLayout>
            </ProtectedRoute>
          } />
          

          <Route path="/admin/users" element={
            <ProtectedRoute>
              <MainLayout>
                <AdminUsersPage />
              </MainLayout>
            </ProtectedRoute>
          } />

          <Route path="/admin/users/:id" element={
            <ProtectedRoute>
              <MainLayout>
                <UserDetailPage />
              </MainLayout>
            </ProtectedRoute>
          } />

          <Route path="/audit-logs" element={
            <ProtectedRoute>
              <MainLayout>
                <AuditLogsPage />
              </MainLayout>
            </ProtectedRoute>
          } />
          
          {/* 404 Route */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        
        {/* Debug Tools - 開発環境でのみ表示 */}
        <DebugTools />
        
        {/* オフライン通知 */}
        <OfflineNotification />
      </Router>
    </AuthProvider>
  );
}

export default App;
