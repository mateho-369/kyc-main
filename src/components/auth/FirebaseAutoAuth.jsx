import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { auth } from '../../config/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { useAuth } from '../../contexts/AuthContext';
import LoadingSpinner from '../LoadingSpinner';

const FirebaseAutoAuth = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [isChecking, setIsChecking] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const returnUrl = new URLSearchParams(location.search).get('return_url') || '/dashboard';
    
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        console.log('🔥 Firebase認証済みユーザーを検出:', firebaseUser.email);
        
        try {
          const idToken = await firebaseUser.getIdToken();
          
          const response = await fetch('/api/auth/firebase-session', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`
            },
            credentials: 'include'
          });

          if (response.ok) {
            const data = await response.json();
            await login({
              user: data.user,
              token: data.token
            });
            
            console.log('✅ KYCセッション作成成功');
            navigate(returnUrl);
          } else {
            throw new Error('セッション作成に失敗しました');
          }
        } catch (error) {
          console.error('❌ 認証エラー:', error);
          setError('認証処理中にエラーが発生しました');
          setIsChecking(false);
        }
      } else {
        console.log('⚠️ Firebase未認証状態');
        const sharegramLoginUrl = `${process.env.REACT_APP_SHAREGRAM_URL || 'https://sharegram.com'}/login?return_to=kyc&redirect_url=${encodeURIComponent(window.location.href)}`;
        window.location.href = sharegramLoginUrl;
      }
    });

    const timeout = setTimeout(() => {
      setIsChecking(false);
      setError('認証確認がタイムアウトしました');
    }, 5000);

    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate, location, login]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white p-8 rounded-lg shadow-md">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">認証エラー</h2>
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={() => navigate('/login')}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              ログインページへ
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">認証情報を確認中...</p>
        </div>
      </div>
    );
  }

  return null;
};

export default FirebaseAutoAuth;
