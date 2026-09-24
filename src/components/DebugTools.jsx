import React, { useState, useEffect } from 'react';
import mockApiInterceptor from '../services/mockApiService';

/**
 * デバッグツールコンポーネント
 * 開発環境でのみ表示され、Mock APIの切り替えなどが可能
 */
const DebugTools = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [mockStatus, setMockStatus] = useState(mockApiInterceptor.getMockStatus());

  useEffect(() => {
    // デバッグツールの表示は開発環境のみ
    if (process.env.NODE_ENV === 'production' && !localStorage.getItem('SHOW_DEBUG_TOOLS')) {
      return;
    }

    // Ctrl+Shift+D でデバッグツールの表示/非表示を切り替え
    const handleKeyPress = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        setIsOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  const toggleMockApi = () => {
    if (mockStatus.isActive) {
      mockApiInterceptor.disableMock();
    } else {
      mockApiInterceptor.enableMock();
    }
  };

  const refreshStatus = () => {
    setMockStatus(mockApiInterceptor.getMockStatus());
  };

  // 本番環境では表示しない（特別なフラグがない限り）
  if (process.env.NODE_ENV === 'production' && !localStorage.getItem('SHOW_DEBUG_TOOLS')) {
    return null;
  }

  if (!isOpen) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <button
          onClick={() => setIsOpen(true)}
          className="bg-gray-800 text-white px-3 py-1 rounded-md text-xs shadow-lg hover:bg-gray-700"
          title="Ctrl+Shift+D でも開けます"
        >
          🔧 Debug
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-gray-800 text-white p-4 rounded-lg shadow-xl max-w-sm">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-bold">デバッグツール</h3>
        <button
          onClick={() => setIsOpen(false)}
          className="text-gray-400 hover:text-white"
        >
          ✕
        </button>
      </div>

      <div className="space-y-3">
        {/* Mock API Status */}
        <div className="border-t border-gray-700 pt-3">
          <h4 className="text-xs font-semibold mb-2">Mock API 状態</h4>
          <div className="text-xs space-y-1">
            <div className="flex justify-between">
              <span>環境変数:</span>
              <span className={mockStatus.envVar ? 'text-green-400' : 'text-gray-400'}>
                {mockStatus.envVar ? '有効' : '無効'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>LocalStorage:</span>
              <span className={mockStatus.localStorage ? 'text-green-400' : 'text-gray-400'}>
                {mockStatus.localStorage ? '有効' : '無効'}
              </span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>現在の状態:</span>
              <span className={mockStatus.isActive ? 'text-yellow-400' : 'text-green-400'}>
                {mockStatus.isActive ? 'Mock API 使用中' : 'Real API 使用中'}
              </span>
            </div>
          </div>

          <button
            onClick={toggleMockApi}
            className={`mt-3 w-full px-3 py-1 rounded text-xs font-medium ${
              mockStatus.isActive
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {mockStatus.isActive ? 'Real API に切り替え' : 'Mock API に切り替え'}
          </button>
          
          <button
            onClick={refreshStatus}
            className="mt-2 w-full px-3 py-1 rounded text-xs font-medium bg-gray-600 hover:bg-gray-700"
          >
            状態を更新
          </button>
        </div>

        {/* API情報 */}
        <div className="border-t border-gray-700 pt-3">
          <h4 className="text-xs font-semibold mb-2">API 情報</h4>
          <div className="text-xs space-y-1">
            <div className="break-all">
              <span className="text-gray-400">Base URL:</span>
              <div className="text-blue-400">
                {process.env.REACT_APP_API_URL || '/api'}
              </div>
            </div>
          </div>
        </div>

        {/* その他の情報 */}
        <div className="border-t border-gray-700 pt-3">
          <h4 className="text-xs font-semibold mb-2">環境情報</h4>
          <div className="text-xs space-y-1">
            <div className="flex justify-between">
              <span>環境:</span>
              <span>{process.env.NODE_ENV}</span>
            </div>
            <div className="flex justify-between">
              <span>ホスト:</span>
              <span className="truncate ml-2">{window.location.hostname}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 text-xs text-gray-400">
        <p>Ctrl+Shift+D で開閉</p>
      </div>
    </div>
  );
};

export default DebugTools;