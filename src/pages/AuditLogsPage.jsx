import React, { useState, useEffect, useCallback } from 'react';
// import { getAuditLogs, exportAuditReport } from '../services/api';
import { FiClock as Clock, FiDownload as Download, FiFileText as FileText, FiFilter as Filter, FiRefreshCw as RefreshCw } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';  // useNavigateをインポート
import { getAuditLogs, exportAuditReport } from '../services/auditService';
import { debounce } from 'lodash'; // この行を追加

const AuditLogsPage = () => {
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    action: '',
    resourceType: ''
  });
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState(0); // 追加：最後のフェッチ時間を追跡

  // useCallbackでfetchLogs関数をメモ化
  const fetchLogs = useCallback(
    debounce(async () => {
      // 30秒以内の再取得を防止（キャッシュ機能）
      const now = Date.now();
      if (now - lastFetchTime < 30000 && logs.length > 0) {
        console.log('キャッシュされたデータを使用します');
        return;
      }

      setLoading(true);
      try {
        const data = await getAuditLogs(filters);
        setLogs(data);
        setLastFetchTime(now); // 最後のフェッチ時間を更新
      } catch (err) {
        setError('監査ログの取得に失敗しました');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }, 300), // 300ミリ秒のデバウンス
    [filters, lastFetchTime, logs.length] // filtersが変わった時だけ関数を再作成
  );

  // useEffectの依存配列を空にして、初回のみ実行されるようにする
  useEffect(() => {
    fetchLogs();
    
    // クリーンアップ関数
    return () => {
      fetchLogs.cancel(); // デバウンス関数のキャンセル
    };
  }, []); // 空の依存配列

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleFilterSubmit = (e) => {
    e.preventDefault();
    fetchLogs(); // フィルター適用時にfetchLogsを呼び出す
    setIsFilterOpen(false);
  };

  const handleExport = async () => {
    try {
      await exportAuditReport(filters);
    } catch (err) {
      setError('レポートのエクスポートに失敗しました');
      console.error(err);
    }
  };

  // アクション名の日本語化
  const getActionLabel = (action) => {
    const actionMap = {
      'create': '作成',
      'read': '閲覧',
      'update': '更新',
      'delete': '削除',
      'verify': '検証',
      'download': 'ダウンロード'
    };
    return actionMap[action] || action;
  };

  // リソースタイプの日本語化
  const getResourceTypeLabel = (type) => {
    const typeMap = {
      'performer': '出演者',
      'document': '書類'
    };
    return typeMap[type] || type;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-green-500"></div>
      </div>
    );
  }

  return (
    <div className="py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">監査ログ</h1>
        <div className="flex space-x-2">
          <button
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
          >
            <Filter className="mr-2 h-4 w-4" />
            フィルター
          </button>
          <button
            onClick={handleExport}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
          >
            <Download className="mr-2 h-4 w-4" />
            エクスポート
          </button>
          <button
            onClick={fetchLogs}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            更新
          </button>
        </div>
      </div>
      
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-600 rounded-md p-3 text-sm">
          {error}
        </div>
      )}
      
      {isFilterOpen && (
        <div className="bg-white shadow rounded-lg p-4 mb-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">フィルター</h3>
          <form onSubmit={handleFilterSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="startDate" className="block text-sm font-medium text-gray-700">
                開始日
              </label>
              <input
                type="date"
                id="startDate"
                name="startDate"
                value={filters.startDate}
                onChange={handleFilterChange}
                className="mt-1 focus:ring-green-500 focus:border-green-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="endDate" className="block text-sm font-medium text-gray-700">
                終了日
              </label>
              <input
                type="date"
                id="endDate"
                name="endDate"
                value={filters.endDate}
                onChange={handleFilterChange}
                className="mt-1 focus:ring-green-500 focus:border-green-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="action" className="block text-sm font-medium text-gray-700">
                アクション
              </label>
              <select
                id="action"
                name="action"
                value={filters.action}
                onChange={handleFilterChange}
                className="mt-1 focus:ring-green-500 focus:border-green-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
              >
                <option value="">すべて</option>
                <option value="create">作成</option>
                <option value="read">閲覧</option>
                <option value="update">更新</option>
                <option value="delete">削除</option>
                <option value="verify">検証</option>
                <option value="download">ダウンロード</option>
              </select>
            </div>
            <div>
              <label htmlFor="resourceType" className="block text-sm font-medium text-gray-700">
                リソースタイプ
              </label>
              <select
                id="resourceType"
                name="resourceType"
                value={filters.resourceType}
                onChange={handleFilterChange}
                className="mt-1 focus:ring-green-500 focus:border-green-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
              >
                <option value="">すべて</option>
                <option value="performer">出演者</option>
                <option value="document">書類</option>
              </select>
            </div>
            <div className="md:col-span-2 flex justify-end">
              <button
                type="button"
                onClick={() => setIsFilterOpen(false)}
                className="mr-3 inline-flex justify-center py-2 px-4 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                キャンセル
              </button>
              <button
                type="submit"
                className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-green-500 hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                適用
              </button>
            </div>
          </form>
        </div>
      )}
      
      <div className="bg-white shadow overflow-hidden rounded-lg">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  タイムスタンプ
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  ユーザー
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  アクション
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  リソース
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  IPアドレス
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  詳細
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-6 py-4 text-center text-sm text-gray-500">
                    ログが見つかりません
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div className="flex items-center">
                        <Clock className="mr-2 h-4 w-4" />
                        {new Date(log.createdAt).toLocaleString()}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {log.user ? log.user.name : log.userId}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full
                        ${log.action === 'create' ? 'bg-green-100 text-green-800' : ''}
                        ${log.action === 'read' ? 'bg-blue-100 text-blue-800' : ''}
                        ${log.action === 'update' ? 'bg-yellow-100 text-yellow-800' : ''}
                        ${log.action === 'delete' ? 'bg-red-100 text-red-800' : ''}
                        ${log.action === 'verify' ? 'bg-purple-100 text-purple-800' : ''}
                        ${log.action === 'download' ? 'bg-gray-100 text-gray-800' : ''}
                      `}>
                        {getActionLabel(log.action)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div className="flex items-center">
                        <FileText className="mr-2 h-4 w-4" />
                        {getResourceTypeLabel(log.resourceType)} #{log.resourceId}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {log.ipAddress}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <button
                        onClick={() => alert(JSON.stringify(log.details, null, 2))}
                        className="text-green-600 hover:text-green-900"
                      >
                        詳細を表示
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AuditLogsPage;