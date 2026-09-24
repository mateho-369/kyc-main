// API設定
export const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5002/api';

// デバッグ用
console.log('API Base URL:', API_BASE_URL);

export default {
  API_BASE_URL
};