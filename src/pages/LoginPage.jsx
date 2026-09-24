import React, { useState, useEffect } from 'react';
import { FiShield as Shield, FiLock as Lock, FiMail as Mail, FiArrowRight as ArrowRight } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { trackUserLogin, trackError } from '../services/firebaseAnalytics';

const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { login, waitForAuthState } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    console.log('Login Page');
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    console.log("LOGIN_ATTEMPT", {
      method: 'email_password',
      email_domain: email.split('@')[1] || 'unknown'
    });

    try {
      const user = await login(email, password);
      trackUserLogin(user?.uid || email, 'email_password', true);

      const urlParams = new URLSearchParams(window.location.search);
      const redirectUrl = urlParams.get('redirect');
      let targetUrl = '/';

      if (redirectUrl && redirectUrl !== '/' && redirectUrl !== '') {
        if (redirectUrl.startsWith('/') && !redirectUrl.startsWith('//')) {
          targetUrl = redirectUrl;
        }
      }

      console.log(`ログイン成功: ${targetUrl} へリダイレクト`);

      if (waitForAuthState) {
        console.log('認証状態の確定を待機中...');
        try {
          const { isAuthenticated } = await waitForAuthState();

          if (isAuthenticated) {
            console.log('認証成功、リダイレクト先:', targetUrl);
            navigate(targetUrl, { replace: true });
          } else {
            console.log('認証状態未確定、強制リダイレクト:', targetUrl);
            await new Promise(resolve => setTimeout(resolve, 500));
            navigate(targetUrl, { replace: true });
          }
        } catch (error) {
          console.error('認証状態確認エラー:', error);
          navigate(targetUrl, { replace: true });
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, 200));
        navigate(targetUrl, { replace: true });
      }
    } catch (err) {
      const errorMessage = err.message || 'ログインに失敗しました';
      setError(errorMessage);
      trackUserLogin(null, 'email_password', false);
      trackError('login_error', errorMessage, err.stack, {
        email_domain: email.split('@')[1] || 'unknown'
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-navy-950 relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 bg-pattern-grid opacity-5"></div>

      {/* Decorative Elements */}
      <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-navy-900/50 to-transparent"></div>
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-gold-500/10 rounded-full blur-3xl"></div>
      <div className="absolute top-20 right-20 w-64 h-64 bg-navy-700/30 rounded-full blur-2xl"></div>

      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative z-10">
        <div className="animate-fade-in">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-gold-400 to-gold-500 flex items-center justify-center shadow-lg">
              <Shield className="w-6 h-6 text-navy-900" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white font-display">Id Manager</h1>
              <p className="text-navy-400 text-sm">.com</p>
            </div>
          </div>
        </div>

        <div className="space-y-8 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
          <div>
            <h2 className="text-4xl lg:text-5xl font-bold text-white font-display leading-tight">
              安全で確実な
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-gold-400 to-gold-500">
                本人確認管理
              </span>
            </h2>
            <p className="mt-6 text-lg text-navy-300 max-w-md leading-relaxed">
              業界最高水準のセキュリティで、出演者の本人確認情報を安全に管理。
              コンプライアンス対応を確実にサポートします。
            </p>
          </div>

          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 rounded-full bg-success-500"></div>
              <span className="text-navy-300 text-sm">256bit SSL暗号化</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 rounded-full bg-success-500"></div>
              <span className="text-navy-300 text-sm">GDPR準拠</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 rounded-full bg-success-500"></div>
              <span className="text-navy-300 text-sm">24時間監視</span>
            </div>
          </div>
        </div>

        <div className="text-navy-500 text-sm animate-fade-in" style={{ animationDelay: '0.4s' }}>
          &copy; 2025 Id Manager. All rights reserved.
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 relative z-10">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center justify-center mb-8 animate-fade-in">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gold-400 to-gold-500 flex items-center justify-center">
                <Shield className="w-5 h-5 text-navy-900" />
              </div>
              <span className="text-xl font-bold text-white font-display">Id Manager</span>
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur-xl rounded-3xl p-8 lg:p-10 border border-white/10 shadow-2xl animate-scale-in">
            <div className="text-center mb-8">
              <h3 className="text-2xl font-bold text-white font-display">ログイン</h3>
              <p className="text-navy-400 mt-2">アカウント情報を入力してください</p>
            </div>

            {error && (
              <div className="mb-6 p-4 rounded-xl bg-danger-500/10 border border-danger-500/20 animate-fade-in">
                <p className="text-danger-500 text-sm">{error}</p>
              </div>
            )}

            <form className="space-y-6" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label htmlFor="email" className="block text-sm font-medium text-navy-300">
                  メールアドレス
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Mail className="w-5 h-5 text-navy-500" />
                  </div>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                    className="block w-full pl-12 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-navy-500 focus:outline-none focus:ring-2 focus:ring-gold-500/50 focus:border-gold-500/50 transition-all duration-200"
                    placeholder="email@example.com"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="block text-sm font-medium text-navy-300">
                  パスワード
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock className="w-5 h-5 text-navy-500" />
                  </div>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    className="block w-full pl-12 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-navy-500 focus:outline-none focus:ring-2 focus:ring-gold-500/50 focus:border-gold-500/50 transition-all duration-200"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex items-center justify-center py-4 px-6 rounded-xl text-navy-900 font-semibold bg-gradient-to-r from-gold-400 to-gold-500 hover:from-gold-300 hover:to-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-500 focus:ring-offset-2 focus:ring-offset-navy-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-gold-500/25"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-navy-900/30 border-t-navy-900 rounded-full animate-spin"></div>
                ) : (
                  <>
                    <span>ログイン</span>
                    <ArrowRight className="ml-2 w-5 h-5" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-8">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/10"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-transparent text-navy-500">または</span>
                </div>
              </div>

              <div className="mt-6">
                <button
                  type="button"
                  onClick={() => {
                    console.log("LOGIN_ATTEMPT", { method: 'sharegram_sso' });
                    window.location.href = '/firebase-login';
                  }}
                  className="w-full flex items-center justify-center py-3.5 px-6 rounded-xl text-white font-medium bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 focus:outline-none focus:ring-2 focus:ring-navy-500 focus:ring-offset-2 focus:ring-offset-navy-900 transition-all duration-200"
                >
                  <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                    <path fill="#FFA000" d="M3.89 15.67L6.41 4.11c.06-.27.27-.47.55-.47h10.08c.28 0 .49.2.55.47l2.52 11.56c.02.11 0 .23-.06.32l-.06.08L12 22.11 4.01 16.07l-.06-.08c-.06-.09-.08-.21-.06-.32z"/>
                    <path fill="#F57F17" d="M12 2L4.5 15.07l.5.93L12 21l7-5-3-7.5L12 2z"/>
                    <path fill="#FFCA28" d="M12 2L4.5 15.07l.5.93L12 12.5V2z"/>
                    <path fill="#FFA000" d="M12 2l7.5 13.07-.5.93L12 12.5V2z"/>
                  </svg>
                  Sharegramアカウントでログイン
                </button>
              </div>
            </div>

            <div className="mt-8 text-center">
              <p className="text-navy-500 text-xs">
                ログインすることで、
                <a href="/terms" className="text-gold-500 hover:text-gold-400">利用規約</a>
                および
                <a href="/privacy" className="text-gold-500 hover:text-gold-400">プライバシーポリシー</a>
                に同意したものとみなされます。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
