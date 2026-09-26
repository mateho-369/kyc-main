import axios from 'axios';
import API_URL from '../config/apiBase';
import { setAccessToken, clearAccessToken } from '../utils/authToken';

// ベース URL は src/config/apiBase.js で一元決定している（このファイルで
// 独自デフォルトを持たないこと。以前は localhost:5002 が既定で、
// SecureApiClient.js（既定 '/api'）と実態がズレていた）

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
    // Cookieベースの認証を使用するため、Authorizationヘッダーは送信しない
    // Firebaseトークンのチェックをスキップ
    
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

    // 401エラーの処理を改善（ログイン後のリダイレクトループ対策）
    if (error.response?.status === 401 && !originalRequest._retry) {
      // ログインページでの401エラーは通常のエラーとして処理
      if (originalRequest.url?.includes('/auth/login') || window.location.pathname === '/login') {
        return Promise.reject(error);
      }

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
          // 新しいトークンを保存。
          // 以前は 'token' キーに書いていたが、SecureApiClient など他のクライアントは
          // 'accessToken' を読むため、リフレッシュ成功後も 401 が続いていた。
          setAccessToken(response.data.accessToken);
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
        
        // リフレッシュも失敗し、かつログイン/Ssoページ以外の場合のみログアウト
        if (refreshError.response?.status === 401
            && !window.location.pathname.includes('/login')
            && !window.location.pathname.startsWith('/sso')) {
          // トークンをクリア
          clearAccessToken();
          
          // カスタムイベントを発火してAuthContextに通知（遅延実行で無限ループ防止）
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('auth:logout', {
              detail: { reason: 'refresh_token_expired' }
            }));
          }, 100);
        }
        
        return Promise.reject(refreshError);
      }
    }

    // その他のエラーはそのまま返す
    return Promise.reject(error);
  }
);

export default api;