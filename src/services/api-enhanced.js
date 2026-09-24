import axios from 'axios';

// 環境変数からAPIのURLを取得
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5002/api';
const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:5002/ws';

// Axiosインスタンスの作成
const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  timeout: 30000, // 30秒のタイムアウト
  withCredentials: true // CORS対応：クッキーを含める
});

// リクエストインターセプター
api.interceptors.request.use(
  (config) => {
    // 認証トークンの追加
    const token = localStorage.getItem('token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }

    // CSRFトークンの追加（必要な場合）
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
    if (csrfToken) {
      config.headers['X-CSRF-Token'] = csrfToken;
    }

    // リクエストログ（デバッグ用）
    if (process.env.REACT_APP_ENABLE_DEBUG === 'true') {
      console.log(`[API Request] ${config.method?.toUpperCase()} ${config.url}`, config.data);
    }

    return config;
  },
  (error) => {
    console.error('[API Request Error]', error);
    return Promise.reject(error);
  }
);

// レスポンスインターセプター
api.interceptors.response.use(
  (response) => {
    // レスポンスログ（デバッグ用）
    if (process.env.REACT_APP_ENABLE_DEBUG === 'true') {
      console.log(`[API Response] ${response.config.method?.toUpperCase()} ${response.config.url}`, response.data);
    }
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // エラーログ
    console.error('[API Response Error]', {
      url: originalRequest?.url,
      method: originalRequest?.method,
      status: error.response?.status,
      message: error.message,
      data: error.response?.data
    });

    // 401エラー（認証エラー）の処理
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // リフレッシュトークンで新しいアクセストークンを取得
        const refreshToken = localStorage.getItem('refreshToken');
        if (refreshToken) {
          const refreshResponse = await axios.post(`${API_URL}/auth/refresh`, {
            refreshToken
          });

          const { token } = refreshResponse.data;
          localStorage.setItem('token', token);

          // 元のリクエストを再試行
          originalRequest.headers['Authorization'] = `Bearer ${token}`;
          return api(originalRequest);
        }
      } catch (refreshError) {
        // リフレッシュも失敗した場合はログイン画面へ
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    // 403エラー（権限エラー）
    if (error.response?.status === 403) {
      // 権限エラーの通知
      window.dispatchEvent(new CustomEvent('api:forbidden', {
        detail: { message: error.response.data?.message || 'Access denied' }
      }));
    }

    // 5xxエラー（サーバーエラー）
    if (error.response?.status >= 500) {
      window.dispatchEvent(new CustomEvent('api:server-error', {
        detail: { 
          message: 'Server error occurred. Please try again later.',
          status: error.response.status
        }
      }));
    }

    // ネットワークエラー
    if (!error.response) {
      window.dispatchEvent(new CustomEvent('api:network-error', {
        detail: { message: 'Network error. Please check your connection.' }
      }));
    }

    return Promise.reject(error);
  }
);

// WebSocket接続の設定
export const createWebSocketConnection = (path = '') => {
  const wsUrl = `${WS_URL}${path}`;
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WebSocket] Connected to', wsUrl);
    
    // 認証トークンを送信
    const token = localStorage.getItem('token');
    if (token) {
      ws.send(JSON.stringify({ type: 'auth', token }));
    }
  };

  ws.onerror = (error) => {
    console.error('[WebSocket] Error:', error);
    window.dispatchEvent(new CustomEvent('ws:error', { detail: error }));
  };

  ws.onclose = (event) => {
    console.log('[WebSocket] Closed:', event.code, event.reason);
    
    // 自動再接続（1000は正常終了コード）
    if (event.code !== 1000) {
      setTimeout(() => {
        console.log('[WebSocket] Attempting to reconnect...');
        createWebSocketConnection(path);
      }, 5000);
    }
  };

  return ws;
};

// APIヘルパー関数
export const apiHelpers = {
  // ファイルアップロード用の設定
  uploadFile: (file, onProgress) => {
    const formData = new FormData();
    formData.append('file', file);

    return api.post('/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(percentCompleted);
        }
      }
    });
  },

  // バッチリクエスト
  batchRequest: async (requests) => {
    try {
      const responses = await Promise.all(requests.map(req => api(req)));
      return responses.map(res => res.data);
    } catch (error) {
      console.error('[Batch Request Error]', error);
      throw error;
    }
  },

  // リトライ機能付きリクエスト
  retryRequest: async (config, maxRetries = 3) => {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await api(config);
        return response;
      } catch (error) {
        lastError = error;
        
        // リトライ可能なエラーかチェック
        if (error.response && error.response.status < 500) {
          throw error; // 4xxエラーはリトライしない
        }
        
        // 指数バックオフ
        const delay = Math.min(1000 * Math.pow(2, i), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }
};

export default api;