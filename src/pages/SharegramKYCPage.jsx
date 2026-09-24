import React, { useState, useEffect } from 'react';
import { FiArrowLeft as ArrowLeft, FiShield as Shield } from 'react-icons/fi';
import { useLocation, useNavigate } from 'react-router-dom';
import SharegramGateway from '../components/sharegram/SharegramGateway';
// const SharegramKYCPage = () => {
  const [isMobile, setIsMobile] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // モバイルデバイスの検出
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => {
      window.removeEventListener('resize', checkMobile);
    };
  }, []);

  // 戻るボタンの処理
  const handleBack = () => {
    const urlParams = new URLSearchParams(location.search);
    const redirectUrl = urlParams.get('redirect_url') || urlParams.get('callback_url');
    
    if (redirectUrl) {
      window.location.href = redirectUrl;
    } else {
      navigate('/');
    }
  };

  return (
    <div className={`min-h-screen bg-gray-50 ${isMobile ? 'px-4' : 'px-8'}`}>
      {/* モバイル用ヘッダー */}
      {isMobile && (
        <div className="bg-white shadow-sm border-b sticky top-0 z-50">
          <div className="flex items-center justify-between h-14 px-4">
            <button
              onClick={handleBack}
              className="flex items-center space-x-2 text-gray-600 hover:text-gray-800 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="text-sm">戻る</span>
            </button>
            <div className="flex items-center space-x-2">
              <Shield className="w-6 h-6 text-blue-600" />
              <span className="text-lg font-semibold text-gray-900">SafeVideo KYC</span>
            </div>
          </div>
        </div>
      )}

      {/* セキュリティ警告（モバイル） */}
      {isMobile && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 m-4 mb-6">
          <div className="flex items-start">
            <Shield className="w-4 h-4 text-blue-600 mt-0.5 mr-2" />
            <div>
              <p className="text-xs text-blue-800 font-medium">
                セキュアな認証
              </p>
              <p className="text-xs text-blue-700 mt-1">
                すべての通信は暗号化され、安全に保護されています。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* メインコンテンツ */}
      <div className="pb-8">
        <SharegramGateway />
      </div>

      {/* モバイル用フッター */}
      {isMobile && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 text-center">
          <p className="text-xs text-gray-500">
            Powered by SafeVideo KYC System
          </p>
        </div>
      )}
    </div>
  );
};

export default SharegramKYCPage;