// セキュアなトークン管理クラス
class SecureTokenManager {
  constructor() {
    this.tokenStore = new Map();
    this.refreshTimer = null;
    this.csrfToken = null;
  }

  // トークンの保存（メモリ内のみ）
  setAccessToken(accessToken) {
    const tokenId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
    
    // メモリに保存
    this.tokenStore.set('accessToken', {
      token: accessToken,
      id: tokenId,
      timestamp: Date.now()
    });

    // セッションストレージに認証状態のみ保存
    sessionStorage.setItem('authState', JSON.stringify({
      authenticated: true,
      tokenId: tokenId,
      expiresAt: this.getTokenExpiration(accessToken)
    }));

    // 自動リフレッシュの設定
    this.scheduleTokenRefresh(accessToken);
    
    // ページ離脱時のクリーンアップ
    window.addEventListener('beforeunload', () => this.cleanup());
  }

  // CSRFトークンの設定
  setCSRFToken(csrfToken) {
    this.csrfToken = csrfToken;
  }

  // アクセストークンの取得
  getAccessToken() {
    const tokenData = this.tokenStore.get('accessToken');
    
    if (!tokenData) return null;
    
    // トークンの有効期限チェック
    const expirationTime = this.getTokenExpiration(tokenData.token);
    if (Date.now() >= expirationTime) {
      this.cleanup();
      return null;
    }
    
    return tokenData.token;
  }

  // CSRFトークンの取得
  getCSRFToken() {
    // Cookieから読み取る
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'csrfToken') {
        return value;
      }
    }
    return this.csrfToken;
  }

  // トークンの自動リフレッシュスケジューリング
  scheduleTokenRefresh(token) {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    const expiresIn = this.getTokenExpiration(token) - Date.now();
    const refreshTime = Math.max(expiresIn - (2 * 60 * 1000), 0); // 2分前にリフレッシュ

    this.refreshTimer = setTimeout(async () => {
      try {
        await this.refreshToken();
      } catch (error) {
        console.error('Token refresh failed:', error);
        this.handleAuthError();
      }
    }, refreshTime);
  }

  // トークンのリフレッシュ
  async refreshToken() {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include', // Cookieを含める
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': this.getCSRFToken()
      }
    });

    if (!response.ok) {
      throw new Error('Token refresh failed');
    }

    const { accessToken } = await response.json();
    this.setAccessToken(accessToken);
    
    return accessToken;
  }

  // APIリクエストヘッダーの取得
  getAuthHeaders() {
    const token = this.getAccessToken();
    const csrfToken = this.getCSRFToken();
    
    if (!token) {
      throw new Error('No authentication token available');
    }

    return {
      'Authorization': `Bearer ${token}`,
      'X-CSRF-Token': csrfToken
    };
  }

  // ログアウト
  async logout() {
    try {
      const headers = this.getAuthHeaders();
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers
      });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      this.cleanup();
    }
  }

  // クリーンアップ
  cleanup() {
    this.tokenStore.clear();
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    sessionStorage.removeItem('authState');
    this.csrfToken = null;
  }

  // トークンの有効期限を取得
  getTokenExpiration(token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000;
    } catch {
      return Date.now() + (15 * 60 * 1000); // デフォルト15分
    }
  }

  // 認証エラーハンドリング
  handleAuthError() {
    this.cleanup();
    // ログインページへリダイレクト
    window.location.href = '/login';
  }

  // 認証状態の確認
  isAuthenticated() {
    const authState = sessionStorage.getItem('authState');
    if (!authState) return false;

    try {
      const state = JSON.parse(authState);
      return state.authenticated && Date.now() < state.expiresAt;
    } catch {
      return false;
    }
  }
}

// シングルトンインスタンスとしてエクスポート
export default new SecureTokenManager();