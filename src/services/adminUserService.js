import secureApiClient from './SecureApiClient';

/**
 * 管理者用ユーザー一覧を取得
 * @param {Object} filters - { search, page, limit }
 */
export const getAdminUsers = async (filters = {}) => {
  try {
    const queryParams = new URLSearchParams();

    if (filters.search) {
      queryParams.append('search', filters.search);
    }
    if (filters.page) {
      queryParams.append('page', filters.page);
    }
    if (filters.limit) {
      queryParams.append('limit', filters.limit);
    }

    const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
    const response = await secureApiClient.get(`/admin/users${query}`);
    return response.data;
  } catch (error) {
    console.error('ユーザー一覧取得エラー:', error);
    throw error;
  }
};

/**
 * 管理者用ユーザー詳細 + 出演者一覧を取得
 * @param {number} userId
 */
export const getAdminUserDetail = async (userId) => {
  try {
    const response = await secureApiClient.get(`/admin/users/${userId}`);
    return response.data.data;
  } catch (error) {
    console.error('ユーザー詳細取得エラー:', error);
    throw error;
  }
};

export default {
  getAdminUsers,
  getAdminUserDetail
};
