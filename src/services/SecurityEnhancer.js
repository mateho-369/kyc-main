/**
 * セキュリティ強化モジュール
 * CSRF対策に加えた追加セキュリティレイヤー
 */

class SecurityEnhancer {
  constructor() {
    this.sessionFingerprint = null;
    this.securityConfig = {
      maxFailedAttempts: 5,
      lockoutDuration: 15 * 60 * 1000, // 15分
      tokenRotationInterval: 30 * 60 * 1000, // 30分
      sessionTimeout: 2 * 60 * 60 * 1000, // 2時間
      requiredHTTPS: process.env.NODE_ENV === 'production'
    };
    
    this.initializeSecurityEnhancer();
  }

  /**
   * セキュリティ強化機能初期化
   */
  initializeSecurityEnhancer() {
    this.generateSessionFingerprint();
    this.setupSecurityEventListeners();
    this.startSecurityMonitoring();
    
    console.log('🛡️ セキュリティ強化機能初期化完了');
  }

  /**
   * セッションフィンガープリント生成
   */
  generateSessionFingerprint() {
    const fingerprint = {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      screenResolution: `${window.screen.width}x${window.screen.height}`,
      colorDepth: window.screen.colorDepth,
      timestamp: Date.now()
    };

    this.sessionFingerprint = btoa(JSON.stringify(fingerprint));
    console.log('🔐 セッションフィンガープリント生成完了');
    
    return this.sessionFingerprint;
  }

  /**
   * セキュリティヘッダー生成
   */
  generateSecurityHeaders() {
    const headers = {
      'X-Session-Fingerprint': this.sessionFingerprint,
      'X-Client-Timestamp': Date.now().toString(),
      'X-Security-Version': '2025.01.24',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block'
    };

    // HTTPS必須環境での追加ヘッダー
    if (this.securityConfig.requiredHTTPS) {
      headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
    }

    return headers;
  }

  /**
   * リクエスト前セキュリティチェック
   */
  preRequestSecurityCheck(config) {
    // HTTPS強制チェック
    if (this.securityConfig.requiredHTTPS && !window.location.protocol.startsWith('https')) {
      throw new Error('HTTPS required for secure operations');
    }

    // セキュリティヘッダー追加
    const securityHeaders = this.generateSecurityHeaders();
    config.headers = { ...config.headers, ...securityHeaders };

    // タイムスタンプベース replay attack 防止
    config.headers['X-Request-Timestamp'] = Date.now().toString();

    console.log('🛡️ セキュリティチェック完了');
    return config;
  }

  /**
   * レスポンス後セキュリティ検証
   */
  postResponseSecurityVerification(response) {
    // セキュリティヘッダー検証
    const requiredHeaders = [
      'X-Content-Type-Options',
      'X-Frame-Options',
      'X-XSS-Protection'
    ];

    const missingHeaders = requiredHeaders.filter(
      header => !response.headers[header.toLowerCase()]
    );

    if (missingHeaders.length > 0) {
      console.warn('⚠️ セキュリティヘッダー不足:', missingHeaders);
    }

    // Content-Type検証
    if (response.headers['content-type'] && 
        !response.headers['content-type'].includes('application/json') &&
        !response.headers['content-type'].includes('text/html')) {
      console.warn('⚠️ 予期しないContent-Type:', response.headers['content-type']);
    }

    return response;
  }

  /**
   * セキュリティイベントリスナー設定
   */
  setupSecurityEventListeners() {
    // ページ離脱時のセキュリティクリーンアップ
    window.addEventListener('beforeunload', () => {
      this.securityCleanup();
    });

    // Visibility API による セッション管理
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pauseSecurityMonitoring();
      } else {
        this.resumeSecurityMonitoring();
      }
    });

    // オンライン状態監視
    window.addEventListener('online', () => {
      this.handleOnlineStateChange(true);
    });

    window.addEventListener('offline', () => {
      this.handleOnlineStateChange(false);
    });

    console.log('🔍 セキュリティイベントリスナー設定完了');
  }

  /**
   * セキュリティ監視開始
   */
  startSecurityMonitoring() {
    // セッションタイムアウト監視
    this.sessionTimeoutTimer = setTimeout(() => {
      this.handleSessionTimeout();
    }, this.securityConfig.sessionTimeout);

    // トークンローテーション監視
    this.tokenRotationTimer = setInterval(() => {
      this.handleTokenRotation();
    }, this.securityConfig.tokenRotationInterval);

    console.log('👁️ セキュリティ監視開始');
  }

  /**
   * セッションタイムアウト処理
   */
  handleSessionTimeout() {
    console.warn('⏰ セッションタイムアウト発生');
    
    // カスタムイベント発火
    window.dispatchEvent(new CustomEvent('security:session-timeout', {
      detail: { 
        reason: 'Session timeout',
        timestamp: Date.now()
      }
    }));

    this.securityCleanup();
  }

  /**
   * トークンローテーション処理
   */
  handleTokenRotation() {
    console.log('🔄 トークンローテーション実行');
    
    // カスタムイベント発火
    window.dispatchEvent(new CustomEvent('security:token-rotation', {
      detail: { 
        timestamp: Date.now(),
        fingerprint: this.sessionFingerprint
      }
    }));
  }

  /**
   * オンライン状態変更処理
   */
  handleOnlineStateChange(isOnline) {
    if (isOnline) {
      console.log('🌐 オンライン状態復旧 - セキュリティ状態確認');
      this.verifySecurityState();
    } else {
      console.log('📴 オフライン状態 - セキュリティ機能一時停止');
      this.pauseSecurityMonitoring();
    }
  }

  /**
   * セキュリティ状態確認
   */
  verifySecurityState() {
    // セッション有効性確認
    const currentTime = Date.now();
    const sessionStartTime = parseInt(localStorage.getItem('session_start_time') || '0');
    
    if (currentTime - sessionStartTime > this.securityConfig.sessionTimeout) {
      this.handleSessionTimeout();
      return false;
    }

    console.log('✅ セキュリティ状態確認完了');
    return true;
  }

  /**
   * セキュリティ監視一時停止
   */
  pauseSecurityMonitoring() {
    if (this.sessionTimeoutTimer) {
      clearTimeout(this.sessionTimeoutTimer);
    }
    if (this.tokenRotationTimer) {
      clearInterval(this.tokenRotationTimer);
    }
    console.log('⏸️ セキュリティ監視一時停止');
  }

  /**
   * セキュリティ監視再開
   */
  resumeSecurityMonitoring() {
    this.startSecurityMonitoring();
    console.log('▶️ セキュリティ監視再開');
  }

  /**
   * セキュリティクリーンアップ
   */
  securityCleanup() {
    this.pauseSecurityMonitoring();
    
    // セキュリティ関連データクリア
    this.sessionFingerprint = null;
    
    // セッション情報クリア（localStorageは使用しないが、念のため）
    try {
      sessionStorage.clear();
    } catch (error) {
      console.warn('セッションストレージクリア失敗:', error);
    }

    console.log('🧹 セキュリティクリーンアップ完了');
  }

  /**
   * セキュリティ状態レポート生成
   */
  generateSecurityReport() {
    const report = {
      timestamp: Date.now(),
      fingerprint: this.sessionFingerprint,
      httpsEnabled: window.location.protocol === 'https:',
      sessionActive: !!this.sessionTimeoutTimer,
      tokenRotationActive: !!this.tokenRotationTimer,
      securityConfig: this.securityConfig,
      browserSecurity: {
        cookiesEnabled: navigator.cookieEnabled,
        doNotTrack: navigator.doNotTrack,
        onLine: navigator.onLine
      }
    };

    console.log('📊 セキュリティレポート:', report);
    return report;
  }
}

// セキュリティ強化機能のシングルトンインスタンス
const securityEnhancer = new SecurityEnhancer();

// セキュリティイベントのグローバルリスナー
window.addEventListener('security:session-timeout', (event) => {
  console.error('🚨 セキュリティアラート - セッションタイムアウト:', event.detail);
  // 必要に応じてログイン画面にリダイレクト
});

window.addEventListener('security:token-rotation', (event) => {
  console.log('🔄 セキュリティイベント - トークンローテーション:', event.detail);
});

export default securityEnhancer;