import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import MainLayout from '../layouts/MainLayout';
import AnalyticsProvider from '../components/AnalyticsProvider';
import LoginPage from '../pages/LoginPage';
import FirebaseLoginPage from '../pages/FirebaseLoginPage';
import SSOCallbackPage from '../pages/SSOCallbackPage';
import SSOPage from '../pages/SSOPage';
import DashboardPage from '../pages/DashboardPage';
import PerformersPage from '../pages/PerformersPage';
import PerformerDetailPage from '../pages/PerformerDetailPage';
import AddPerformerPage from '../pages/AddPerformerPage';
import AuditLogsPage from '../pages/AuditLogsPage';
import CancellationPage from '../pages/CancellationPage';
import FAQsPage from '../pages/FAQsPage';
import ContactPage from '../pages/ContactPage';
import TermsPage from '../pages/TermsPage';
import PrivacyPage from '../pages/PrivacyPage';
import CustomVideoDetailPage from '../pages/CustomVideoDetailPage';
import SharegramGateway from '../components/sharegram/SharegramGateway';

// 認証済みユーザーのみがアクセスできるルート
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  
  // 認証状態を確認中の場合はローディング表示
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return children;
};

const AppRoutes = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AnalyticsProvider>
          <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/firebase-login" element={<FirebaseLoginPage />} />
          <Route path="/sso-callback" element={<SSOCallbackPage />} />
          <Route path="/sso" element={<SSOPage />} />
          
          {/* Sharegram KYC登録ルート（認証不要） */}
          <Route path="/kyc/register" element={<SharegramGateway />} />
          
          <Route element={<MainLayout />}>
            {/* 認証が必要なルート */}
            <Route path="/" element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            } />
            <Route path="/performers" element={
              <ProtectedRoute>
                <PerformersPage />
              </ProtectedRoute>
            } />
            <Route path="/performers/:id" element={
              <ProtectedRoute>
                <PerformerDetailPage />
              </ProtectedRoute>
            } />
            <Route path="/performers/add" element={
              <ProtectedRoute>
                <AddPerformerPage />
              </ProtectedRoute>
            } />
            <Route path="/add-performer" element={
              <ProtectedRoute>
                <AddPerformerPage />
              </ProtectedRoute>
            } />
            <Route path="/audit-logs" element={
              <ProtectedRoute>
                <AuditLogsPage />
              </ProtectedRoute>
            } />

            <Route path="/videos/:id" element={
              <ProtectedRoute>
                <CustomVideoDetailPage />
              </ProtectedRoute>
            } />
            
            {/* 認証不要のフッターページ */}
            <Route path="/cancellation" element={<CancellationPage />} />
            <Route path="/faqs" element={<FAQsPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
          </Route>
          
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </AnalyticsProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default AppRoutes;