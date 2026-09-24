import axios from 'axios';

// 環境変数からAPIのURLを取得（デフォルトはローカル環境）
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5002/api';

// セキュアクッキーの設定
const SECURE_COOKIES = process.env.REACT_APP_SECURE_COOKIES === 'true';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  },
  withCredentials: true, // CSRF対応のためクッキーを含める
  timeout: 30000 // 30秒のタイムアウト
});

// リフレッシュトークンを使用してアクセストークンを更新
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  
  failedQueue = [];
};

// リクエストインターセプター - 認証トークンの追加
api.interceptors.request.use(
  async (config) => {
    // Firebaseトークンを優先的に使用
    try {
      const { auth } = await import('../config/firebase');
      if (auth && auth.currentUser) {
        const idToken = await auth.currentUser.getIdToken();
        config.headers['Authorization'] = `Bearer ${idToken}`;
        config.headers['X-Firebase-Token'] = idToken;
      } else {
        // Firebaseトークンがない場合は通常のトークンを使用
        const token = localStorage.getItem('token');
        if (token) {
          config.headers['Authorization'] = `Bearer ${token}`;
        }
      }
    } catch (error) {
      console.warn('Firebaseトークン取得エラー:', error);
      // フォールバック: 通常のトークンを使用
      const token = localStorage.getItem('token');
      if (token) {
        config.headers['Authorization'] = `Bearer ${token}`;
      }
    }
    
    // CSRFトークンの追加
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    if (csrfToken) {
      config.headers['X-CSRF-Token'] = csrfToken;
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// レスポンスインターセプター - 改善されたエラーハンドリング
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // 401エラーの処理を改善
    if (error.response?.status === 401 && !originalRequest._retry) {
      // リフレッシュ中の場合は、キューに追加
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          originalRequest.headers['Authorization'] = `Bearer ${token}`;
          return api(originalRequest);
        }).catch(err => {
          return Promise.reject(err);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // リフレッシュトークンでアクセストークンを更新
        const response = await api.post('/auth/refresh', {}, {
          _retry: true // リフレッシュリクエスト自体が401を返す場合の無限ループを防ぐ
        });

        if (response.data.accessToken) {
          // 新しいトークンを保存
          localStorage.setItem('token', response.data.accessToken);
          api.defaults.headers.common['Authorization'] = `Bearer ${response.data.accessToken}`;
          
          processQueue(null, response.data.accessToken);
          isRefreshing = false;
          
          // 元のリクエストをリトライ
          originalRequest.headers['Authorization'] = `Bearer ${response.data.accessToken}`;
          return api(originalRequest);
        }
      } catch (refreshError) {
        processQueue(refreshError, null);
        isRefreshing = false;
        
        // リフレッシュも失敗した場合のみログアウト
        if (refreshError.response?.status === 401) {
          // トークンをクリア
          localStorage.removeItem('token');
          
          // カスタムイベントを発火してAuthContextに通知
          window.dispatchEvent(new CustomEvent('auth:logout', {
            detail: { reason: 'refresh_token_expired' }
          }));
        }
        
        return Promise.reject(refreshError);
      }
    }

    // その他のエラーはそのまま返す
    return Promise.reject(error);
  }
);

export default api;