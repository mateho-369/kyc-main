import api from './api';

/**
 * 監査ログを取得する
 * @param {Object} filters フィルター条件
 * @returns {Promise<Array>} 監査ログの配列
 */
export const getAuditLogs = async (filters = {}) => {
  try {
    const queryParams = new URLSearchParams();
    
    if (filters.startDate) {
      queryParams.append('startDate', filters.startDate);
    }
    
    if (filters.endDate) {
      queryParams.append('endDate', filters.endDate);
    }
    
    if (filters.action) {
      queryParams.append('action', filters.action);
    }
    
    if (filters.resourceType) {
      queryParams.append('resourceType', filters.resourceType);
    }
    
    if (filters.resourceId) {
      queryParams.append('resourceId', filters.resourceId);
    }
    
    if (filters.userId) {
      queryParams.append('userId', filters.userId);
    }
    
    const url = `/audit-logs${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    const response = await api.get(url);
    return response.data;
  } catch (error) {
    console.error('監査ログ取得エラー:', error);
    throw error;
  }
};

/**
 * 特定のリソースの監査ログを取得する
 * @param {string} resourceType リソースタイプ
 * @param {number} resourceId リソースID
 * @returns {Promise<Array>} 監査ログの配列
 */
export const getResourceAuditLogs = async (resourceType, resourceId) => {
  try {
    const response = await api.get(`/audit-logs/${resourceType}/${resourceId}`);
    return response.data;
  } catch (error) {
    console.error('リソース監査ログ取得エラー:', error);
    throw error;
  }
};

/**
 * 監査ログレポートをエクスポートする
 * @param {Object} filters フィルター条件
 * @returns {Promise<Blob>} レポートのBlobデータ
 */
export const exportAuditReport = async (filters = {}) => {
  try {
    const queryParams = new URLSearchParams();
    
    if (filters.startDate) {
      queryParams.append('startDate', filters.startDate);
    }
    
    if (filters.endDate) {
      queryParams.append('endDate', filters.endDate);
    }
    
    if (filters.action) {
      queryParams.append('action', filters.action);
    }
    
    if (filters.resourceType) {
      queryParams.append('resourceType', filters.resourceType);
    }
    
    const url = `/audit-logs/export${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    const response = await api.get(url, {
      responseType: 'blob'
    });
    
    // レポートのダウンロード
    const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const downloadUrl = window.URL.createObjectURL(blob);
    const fileName = `audit_log_report_${new Date().toISOString().slice(0, 10)}.xlsx`;
    
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(downloadUrl);
    document.body.removeChild(a);
    
    return blob;
  } catch (error) {
    console.error('監査ログエクスポートエラー:', error);
    throw error;
  }
};