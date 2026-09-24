import secureApiClient from './SecureApiClient';

/**
 * ダッシュボードの統計情報を取得する
 * @returns {Promise<Object>} 統計情報
 */
export const getDashboardStats = async () => {
  try {
    const response = await secureApiClient.get('/dashboard/stats');
    return response.data;
  } catch (error) {
    console.error('ダッシュボード統計取得エラー:', error);
    
    // 権限エラーまたはサーバーエラーの場合はデフォルト値を返す
    if (error.response?.status === 401 || error.response?.status === 403 || error.response?.status === 500) {
      return {
        totalPerformers: 0,
        pendingReviews: 0,
        activePerformers: 0,
        expiringSoon: 0,
        totalDocuments: 0,
        pendingVerification: 0,
        recentActivity: []
      };
    }
    
    throw error;
  }
};

/**
 * ダッシュボードの最近のアクティビティを取得する
 * @param {number} limit 取得する件数
 * @returns {Promise<Array>} 最近のアクティビティの配列
 */
export const getRecentActivity = async (limit = 10) => {
  try {
    const response = await secureApiClient.get(`/dashboard/activity?limit=${limit}`);
    return response.data;
  } catch (error) {
    console.error('アクティビティ取得エラー:', error);
    throw error;
  }
};

/**
 * ダッシュボードの統計グラフデータを取得する
 * @param {string} type グラフの種類（monthly, weekly, daily）
 * @returns {Promise<Object>} グラフデータ
 */
export const getDashboardChartData = async (type = 'monthly') => {
  try {
    const response = await secureApiClient.get(`/dashboard/chart?type=${type}`);
    return response.data;
  } catch (error) {
    console.error('グラフデータ取得エラー:', error);
    throw error;
  }
};