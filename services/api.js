import axios from 'axios';

// API URLの設定
// Docker環境では 'http://localhost:5001/api'
// 開発環境では環境変数または 'http://localhost:5000/api'
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

console.log('API URL:', API_URL); // デバッグ用にURLをログ出力

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// リクエストインターセプター - 認証トークンの追加
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    console.error('APIリクエストエラー:', error);
    return Promise.reject(error);
  }
);

// レスポンスインターセプター - エラーハンドリング
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    console.error('APIレスポンスエラー:', 
      error.response?.status, 
      error.response?.data,
      error.message
    );
    
    // 401エラーの場合はログアウト処理
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    
    return Promise.reject(error);
  }
);

export default api;