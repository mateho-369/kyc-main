import React, { useState, useEffect } from 'react';
import { FiActivity as Activity, FiAlertCircle as AlertCircle, FiCheckCircle as CheckCircle, FiRefreshCw as RefreshCw } from 'react-icons/fi';
// import secureApiClient from '../../services/secureApiClient';

/**
 * 統合ヘルスステータス表示ウィジェット
 * GET /integration/health エンドポイント対応
 */
const HealthStatusWidget = () => {
  const [healthData, setHealthData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);

  // ヘルスチェック実行
  const checkHealth = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await secureApiClient.get('/integration/health');
      
      if (response.data.success) {
        setHealthData(response.data.data);
        setLastChecked(new Date());
      } else {
        setError('ヘルスチェックに失敗しました');
      }
    } catch (err) {
      console.error('ヘルスチェックエラー:', err);
      setError('システムに接続できません');
    } finally {
      setLoading(false);
    }
  };

  // 初回読み込み時と定期的な更新
  useEffect(() => {
    checkHealth();
    
    // 30秒ごとに自動更新
    const interval = setInterval(checkHealth, 30000);
    
    return () => clearInterval(interval);
  }, []);

  // サービスステータスの色を決定
  const getStatusColor = (status) => {
    switch (status) {
      case 'healthy':
        return 'text-green-500';
      case 'warning':
        return 'text-yellow-500';
      case 'error':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  // サービスアイコンを取得
  const getStatusIcon = (status) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'warning':
        return <AlertCircle className="w-5 h-5 text-yellow-500" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      default:
        return <Activity className="w-5 h-5 text-gray-500" />;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center">
          <Activity className="w-5 h-5 mr-2" />
          システムヘルスステータス
        </h3>
        <button
          onClick={checkHealth}
          disabled={loading}
          className="p-2 rounded hover:bg-gray-100 disabled:opacity-50"
          title="更新"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded mb-4">
          {error}
        </div>
      )}

      {healthData && !loading && (
        <>
          {/* 全体ステータス */}
          <div className="mb-4 pb-4 border-b">
            <div className="flex items-center justify-between">
              <span className="font-medium">全体ステータス</span>
              <div className="flex items-center">
                {getStatusIcon(healthData.status)}
                <span className={`ml-2 font-medium ${getStatusColor(healthData.status)}`}>
                  {healthData.status.toUpperCase()}
                </span>
              </div>
            </div>
            {healthData.response_time && (
              <div className="text-sm text-gray-600 mt-1">
                レスポンス時間: {healthData.response_time}ms
              </div>
            )}
          </div>

          {/* サービスチェック */}
          {healthData.service_checks && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-gray-700">サービス状態</h4>
              {Object.entries(healthData.service_checks).map(([service, status]) => (
                <div key={service} className="flex items-center justify-between text-sm">
                  <span className="capitalize">{service.replace('_', ' ')}</span>
                  <div className="flex items-center">
                    {getStatusIcon(status)}
                    <span className={`ml-1 ${getStatusColor(status)}`}>
                      {status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 最終チェック時刻 */}
          {lastChecked && (
            <div className="mt-4 pt-4 border-t text-xs text-gray-500">
              最終チェック: {lastChecked.toLocaleTimeString('ja-JP')}
            </div>
          )}
        </>
      )}

      {loading && !healthData && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      )}
    </div>
  );
};

export default HealthStatusWidget;