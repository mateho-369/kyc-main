import axios from 'axios';
import { auth } from '../config/firebase';
import securityEnhancer from './SecurityEnhancer';
import mockApiInterceptor from './mockApiService';

/**
 * セキュアなAPIクライアント（改善版）
 * - httpOnly cookieを活用したトークン管理
 * - CSRF保護
 * - 自動リトライ機能
 * - 改善された401エラーハンドリング
 */
class SecureApiClient {
  constructor() {
    this.client = null;
    this.csrfToken = null;
    this.isInitialized = false;
    this.retryCount = 3;
    this.retryDelay = 1000;
    this.sessionInitializing = false; // セッション初期化中フラグ
    this.firstRequestMade = false; // 初回リクエストフラグ
    
    this.setupClient();
  }

  setupClient() {
    // Axiosインスタンスの作成
    this.client = axios.create({
      baseURL: process.env.REACT_APP_API_URL || '/api',
      timeout: 30000,
      withCredentials: true, // Cookie送信を有効化
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest' // CSRF対策
      }
    });

    // リクエストインターセプター
    this.client.interceptors.request.use(
      async (config) => {
        // セキュリティ強化: リクエスト前チェック
        config = securityEnhancer.preRequestSecurityCheck(config);
        
        // CSRFトークンの付与（GETリクエスト以外）
        if (this.csrfToken && config.method !== 'get') {
          config.headers['X-CSRF-Token'] = this.csrfToken;
        }

        // Firebase IDトークンの取得（必要な場合）
        const currentUser = auth.currentUser;
        if (currentUser && config.useFirebaseAuth !== false) {
          try {
            const idToken = await currentUser.getIdToken();
            config.headers['X-Firebase-Token'] = idToken;
          } catch (error) {
            console.warn('Firebase token取得エラー:', error);
          }
        }

        // セキュリティヘッダーの追加
        config.headers['X-Client-Version'] = process.env.REACT_APP_VERSION || '1.0.0';
        
        // 3層認証システム対応ヘッダー
        config.headers['X-Auth-Layer'] = 'frontend';
        
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // レスポンスインターセプター
    this.client.interceptors.response.use(
      (response) => {
        // セキュリティ強化: レスポンス後検証
        response = securityEnhancer.postResponseSecurityVerification(response);
        
        // CSRFトークンの更新
        const newCsrfToken = response.headers['x-csrf-token'];
        if (newCsrfToken) {
          this.csrfToken = newCsrfToken;
        }

        // 初回リクエスト成功を記録
        if (!this.firstRequestMade) {
          this.firstRequestMade = true;
        }

        return response;
      },
      async (error) => {
        const originalRequest = error.config;

        // 401エラー（認証エラー）の改善されたハンドリング
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          // 初回リクエストでの401エラーはセッション初期化を試みる
          if (!this.firstRequestMade || !this.isInitialized) {
            console.log('🔄 初回401エラー検出、セッション初期化を試みます');
            try {
              await this.initializeSession();
              this.firstRequestMade = true;
              return this.client(originalRequest);
            } catch (initError) {
              console.error('セッション初期化失敗:', initError);
            }
          }

          // 既存セッションのリフレッシュを試みる
          try {
            await this.refreshSession();
            return this.client(originalRequest);
          } catch (refreshError) {
            // リフレッシュも失敗した場合のみログアウト処理
            console.warn('セッションリフレッシュ失敗、認証エラー処理を実行');
            this.handleAuthError();
            return Promise.reject(refreshError);
          }
        }

        // 403エラー（CSRF等）の処理
        if (error.response?.status === 403) {
          // CSRFトークンの再取得を試みる
          if (!originalRequest._csrfRetry) {
            originalRequest._csrfRetry = true;
            console.log('🔄 403エラー検出、CSRFトークン再取得を試みます');
            
            try {
              await this.refreshCSRFToken();
              return this.client(originalRequest);
            } catch (csrfError) {
              console.error('CSRFトークン再取得失敗:', csrfError);
            }
          }
        }

        // 429エラー（レート制限）の処理
        if (error.response?.status === 429) {
          const retryAfter = error.response.headers['retry-after'];
          const delay = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
          
          console.warn(`レート制限に達しました。${delay / 1000}秒後に再試行してください。`);
          
          return Promise.reject({
            ...error,
            isRateLimited: true,
            retryAfter: delay
          });
        }

        // ネットワークエラーの自動リトライ
        if (!error.response && originalRequest._retryCount < this.retryCount) {
          originalRequest._retryCount = (originalRequest._retryCount || 0) + 1;
          
          await this.delay(this.retryDelay * originalRequest._retryCount);
          return this.client(originalRequest);
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * セッションの初期化（改善版）
   */
  async initializeSession() {
    // 既に初期化中の場合は待機
    if (this.sessionInitializing) {
      console.log('セッション初期化中、完了を待機します');
      await this.waitForSessionInit();
      return;
    }

    this.sessionInitializing = true;

    // Skip initialization if using mock API
    if (mockApiInterceptor.shouldUseMock()) {
      this.csrfToken = 'mock-csrf-token';
      this.isInitialized = true;
      this.sessionInitializing = false;
      console.log('✅ Mock session initialized');
      return { csrfToken: this.csrfToken };
    }
    
    try {
      const response = await this.client.post('/auth/session/init', {
        clientInfo: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        }
      });

      this.csrfToken = response.data.csrfToken;
      this.isInitialized = true;
      console.log('✅ セッション初期化成功');

      return response.data;
    } catch (error) {
      console.error('❌ セッション初期化エラー:', error);
      throw error;
    } finally {
      this.sessionInitializing = false;
    }
  }

  /**
   * セッション初期化の待機
   */
  async waitForSessionInit() {
    let waitCount = 0;
    while (this.sessionInitializing && waitCount < 50) {
      await this.delay(100);
      waitCount++;
    }
    if (waitCount >= 50) {
      throw new Error('セッション初期化タイムアウト');
    }
  }

  /**
   * セッションのリフレッシュ
   */
  async refreshSession() {
    try {
      // Firebase認証を使用している場合はトークンをリフレッシュ
      if (auth.currentUser) {
        const idToken = await auth.currentUser.getIdToken(true);
        const response = await this.client.post('/auth/session/refresh', {
          firebaseToken: idToken
        });
        
        this.csrfToken = response.data.csrfToken;
        console.log('✅ セッションリフレッシュ成功');
        return response.data;
      } else {
        // 通常のセッションリフレッシュ
        const response = await this.client.post('/auth/session/refresh');
        this.csrfToken = response.data.csrfToken;
        return response.data;
      }
    } catch (error) {
      console.error('❌ セッションリフレッシュエラー:', error);
      throw error;
    }
  }

  /**
   * CSRFトークンの再取得
   */
  async refreshCSRFToken() {
    try {
      const response = await this.client.get('/auth/csrf-token');
      this.csrfToken = response.data.csrfToken;
      console.log('✅ CSRFトークン再取得成功');
      return response.data;
    } catch (error) {
      console.error('❌ CSRFトークン再取得エラー:', error);
      throw error;
    }
  }

  /**
   * Firebase認証セッションの作成
   */
  async createFirebaseSession(idToken) {
    try {
      // セッションが初期化されていない場合は初期化
      if (!this.isInitialized) {
        await this.initializeSession();
      }

      const response = await this.client.post('/auth/firebase/session', {
        idToken
      });
      
      this.csrfToken = response.data.csrfToken;
      console.log('✅ Firebaseセッション作成成功');
      return response.data;
    } catch (error) {
      console.error('❌ Firebaseセッション作成エラー:', error);
      throw error;
    }
  }

  /**
   * ログアウト
   */
  async logout() {
    try {
      await this.client.post('/auth/logout');
      
      // クライアント側のクリーンアップ
      this.csrfToken = null;
      this.isInitialized = false;
      this.firstRequestMade = false;
      
      console.log('✅ ログアウトしました');
    } catch (error) {
      console.error('❌ ログアウトエラー:', error);
      // エラーが発生してもクリーンアップは実行
      this.csrfToken = null;
      this.isInitialized = false;
      this.firstRequestMade = false;
    }
  }

  /**
   * 認証エラーのハンドリング（改善版）
   */
  handleAuthError() {
    // クリーンアップ
    this.csrfToken = null;
    this.isInitialized = false;
    this.firstRequestMade = false;

    // カスタムイベントを発火
    window.dispatchEvent(new CustomEvent('auth:error', {
      detail: { message: '認証が必要です' }
    }));
    
    // auth:logoutイベントも発火してAuthContextに通知
    window.dispatchEvent(new CustomEvent('auth:logout', {
      detail: { reason: 'session_expired', isAuthenticated: true }
    }));

    // リダイレクトはProtectedRouteコンポーネントに任せる
  }

  /**
   * 遅延関数
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * セキュアなGETリクエスト
   */
  async get(url, config = {}) {
    // Use mock API if backend is unavailable
    if (mockApiInterceptor.shouldUseMock()) {
      try {
        return await mockApiInterceptor.mockGet(url);
      } catch (error) {
        console.error('Mock API error:', error);
        throw error;
      }
    }
    
    // 初回リクエストの場合、セッション初期化をスキップしてリトライに任せる
    if (!this.isInitialized && !this.firstRequestMade) {
      console.log('初回GETリクエスト、セッション初期化をスキップ');
    }
    
    return this.client.get(url, config);
  }

  /**
   * セキュアなPOSTリクエスト
   */
  async post(url, data, config = {}) {
    // Use mock API if backend is unavailable
    if (mockApiInterceptor.shouldUseMock()) {
      try {
        return await mockApiInterceptor.mockPost(url, data);
      } catch (error) {
        console.error('Mock API error:', error);
        throw error;
      }
    }
    
    // POSTリクエストの場合はセッション初期化を確実に行う
    if (!this.isInitialized) {
      await this.initializeSession();
    }
    
    return this.client.post(url, data, config);
  }

  /**
   * セキュアなPUTリクエスト
   */
  async put(url, data, config = {}) {
    // Use mock API if backend is unavailable
    if (mockApiInterceptor.shouldUseMock()) {
      try {
        return await mockApiInterceptor.mockPut(url, data);
      } catch (error) {
        console.error('Mock API error:', error);
        throw error;
      }
    }
    
    if (!this.isInitialized) {
      await this.initializeSession();
    }
    return this.client.put(url, data, config);
  }

  /**
   * セキュアなDELETEリクエスト
   */
  async delete(url, config = {}) {
    // Use mock API if backend is unavailable
    if (mockApiInterceptor.shouldUseMock()) {
      try {
        return await mockApiInterceptor.mockDelete(url);
      } catch (error) {
        console.error('Mock API error:', error);
        throw error;
      }
    }
    
    if (!this.isInitialized) {
      await this.initializeSession();
    }
    return this.client.delete(url, config);
  }

  /**
   * セキュリティ状態の取得
   */
  getSecurityStatus() {
    return {
      isInitialized: this.isInitialized,
      hasCSRFToken: !!this.csrfToken,
      firstRequestMade: this.firstRequestMade,
      sessionInitializing: this.sessionInitializing
    };
  }
}

// シングルトンインスタンスをエクスポート
const secureApiClient = new SecureApiClient();
export default secureApiClient;