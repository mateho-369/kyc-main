import { expect, describe, test, beforeAll, afterAll, beforeEach } from 'vitest';
import puppeteer from 'puppeteer';

// 統合テスト: Firebase認証UI × バックエンド結合テスト
describe('Firebase認証UI・バックエンド統合テスト', () => {
  let browser;
  let page;

  beforeAll(async () => {
    // ブラウザの起動
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  beforeEach(async () => {
    page = await browser.newPage();
    
    // Firebase Emulatorとの接続設定
    await page.evaluateOnNewDocument(() => {
      window.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
    });
  });

  afterEach(async () => {
    if (page) {
      await page.close();
    }
  });

  // テスト用ヘルパー関数
  const setupTestEnvironment = async () => {
    // Firebase Emulatorの初期化待機
    await page.waitForTimeout(1000);
    
    // API サーバーの準備確認
    try {
      const response = await page.evaluate(() => 
        fetch('http://localhost:3001/api/health')
      );
      expect(response).toBeTruthy();
    } catch (error) {
      throw new Error('API サーバーとの接続に失敗しました');
    }
  };

  const performLogin = async (page, email, password) => {
    await page.fill('[data-testid="email-input"]', email);
    await page.fill('[data-testid="password-input"]', password);
    await page.click('[data-testid="login-button"]');
  };

  const getAdminToken = async () => {
    // テスト用の管理者トークンを取得
    return 'test-admin-token';
  };

  describe('基本認証フロー統合テスト', () => {
    test('新規ユーザー登録からログインまでの完全フロー', async () => {
      await setupTestEnvironment();
      
      // 1. 登録画面への遷移
      await page.goto('http://localhost:3000/login');
      await page.click('[data-testid="switch-to-register"]');
      
      // 2. 新規ユーザー情報入力
      const testUser = {
        email: 'integration-test@example.com',
        password: 'SecurePassword123!',
        name: 'Integration Test User'
      };
      
      await page.fill('[data-testid="email-input"]', testUser.email);
      await page.fill('[data-testid="password-input"]', testUser.password);
      await page.fill('[data-testid="confirm-password-input"]', testUser.password);
      
      // 3. 登録実行
      await page.click('[data-testid="register-button"]');
      
      // 4. 登録成功の確認
      await page.waitForSelector('[data-testid="success-notification"]', {
        timeout: 10000
      });
      
      // 5. バックエンドでのユーザー作成確認
      const userCreated = await page.evaluate(async () => {
        try {
          const response = await fetch('http://localhost:3001/api/admin/users', {
            headers: { 'Authorization': 'Bearer test-admin-token' }
          });
          if (!response.ok) return false;
          
          const users = await response.json();
          return users.some(u => u.email === 'integration-test@example.com');
        } catch (error) {
          return false;
        }
      });
      
      expect(userCreated).toBe(true);
      
      // 6. ダッシュボードへのリダイレクト確認
      await page.waitForURL('http://localhost:3000/dashboard', { timeout: 10000 });
      
      // 7. セッションクッキーの確認
      const cookies = await page.context().cookies();
      const sessionCookie = cookies.find(c => c.name === '__session');
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie.httpOnly).toBe(true);
    });

    test('既存ユーザーのログインフロー', async () => {
      await setupTestEnvironment();
      
      // 1. ログイン画面にアクセス
      await page.goto('http://localhost:3000/login');
      
      // 2. 既存ユーザーでログイン
      await performLogin(page, 'existing-user@example.com', 'password123');
      
      // 3. ログイン成功の確認
      await page.waitForURL('http://localhost:3000/dashboard', { timeout: 10000 });
      
      // 4. ユーザー情報の表示確認
      const userEmail = await page.textContent('[data-testid="user-email"]');
      expect(userEmail).toContain('existing-user@example.com');
    });
  });

  describe('セキュリティ機能統合テスト', () => {
    test('CSRF保護の動作確認', async () => {
      await setupTestEnvironment();
      
      // 1. ログイン画面にアクセス
      await page.goto('http://localhost:3000/login');
      
      // 2. セッション初期化時のCSRFトークン取得確認
      const sessionInitResponse = await page.waitForResponse(
        res => res.url().includes('/api/auth/session/init')
      );
      
      expect(sessionInitResponse.status()).toBe(200);
      
      // 3. CSRFトークンがCookieに設定されることを確認
      const cookies = await page.context().cookies();
      const csrfCookie = cookies.find(c => c.name === 'csrf');
      expect(csrfCookie).toBeDefined();
      
      // 4. APIリクエストでCSRFトークンが送信されることを確認
      await page.fill('[data-testid="email-input"]', 'test@example.com');
      await page.fill('[data-testid="password-input"]', 'password123');
      
      // リクエストヘッダーを監視
      const loginRequest = page.waitForRequest(req => 
        req.url().includes('/api/auth/firebase/session') && 
        req.method() === 'POST'
      );
      
      await page.click('[data-testid="login-button"]');
      
      const request = await loginRequest;
      expect(request.headers()['x-csrf-token']).toBeDefined();
    });

    test('レート制限の動作確認', async () => {
      await setupTestEnvironment();
      await page.goto('http://localhost:3000/login');
      
      // 5回連続でログイン失敗を実行
      for (let i = 0; i < 5; i++) {
        await page.fill('[data-testid="email-input"]', 'nonexistent@example.com');
        await page.fill('[data-testid="password-input"]', 'wrongpassword');
        await page.click('[data-testid="login-button"]');
        
        await page.waitForSelector('[data-testid="error-notification"]');
        
        // エラー通知を閉じる（存在する場合）
        const closeButton = await page.$('[data-testid="error-close-button"]');
        if (closeButton) {
          await closeButton.click();
        }
        
        // 次の試行前に少し待機
        await page.waitForTimeout(500);
      }
      
      // 6回目はレート制限にかかることを確認
      await page.fill('[data-testid="email-input"]', 'nonexistent@example.com');
      await page.fill('[data-testid="password-input"]', 'wrongpassword');
      await page.click('[data-testid="login-button"]');
      
      const errorMessage = await page.textContent('[data-testid="error-message"]');
      expect(errorMessage).toContain('多すぎます');
    });
  });

  describe('セッション管理統合テスト', () => {
    test('セッションタイムアウトの動作確認', async () => {
      await setupTestEnvironment();
      
      // 1. ログイン
      await page.goto('http://localhost:3000/login');
      await performLogin(page, 'test@example.com', 'password123');
      
      // 2. ダッシュボードにアクセス成功
      await page.waitForURL('http://localhost:3000/dashboard');
      
      // 3. セッションタイムアウト時間を短縮（テスト用）
      await page.evaluate(async () => {
        try {
          await fetch('http://localhost:3001/api/test/set-session-timeout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timeout: 5000 }) // 5秒
          });
        } catch (error) {
          console.warn('Session timeout API not available in test environment');
        }
      });
      
      // 4. 5秒待機
      await page.waitForTimeout(6000);
      
      // 5. APIリクエストがセッションタイムアウトエラーになることを確認
      const response = await page.evaluate(async () => {
        try {
          const response = await fetch('/api/user/profile');
          return response.status;
        } catch (error) {
          return 0;
        }
      });
      
      // セッションタイムアウトまたはログイン画面へのリダイレクトを確認
      const currentUrl = page.url();
      const isTimedOut = response === 401 || currentUrl.includes('/login');
      expect(isTimedOut).toBe(true);
    });

    test('自動セッション更新の動作確認', async () => {
      await setupTestEnvironment();
      
      // 1. ログイン
      await page.goto('http://localhost:3000/login');
      await performLogin(page, 'test@example.com', 'password123');
      await page.waitForURL('http://localhost:3000/dashboard');
      
      // 2. 定期的にAPIリクエストを送信
      let requestCount = 0;
      const maxRequests = 10;
      
      for (let i = 0; i < maxRequests; i++) {
        const response = await page.evaluate(async () => {
          try {
            const response = await fetch('/api/user/profile');
            return response.status;
          } catch (error) {
            return 0;
          }
        });
        
        if (response === 200) {
          requestCount++;
        }
        
        await page.waitForTimeout(2000); // 2秒間隔
      }
      
      // 4. セッションが維持されていることを確認
      expect(requestCount).toBeGreaterThan(8); // 80%以上成功
    });
  });

  describe('エラーハンドリング統合テスト', () => {
    test('ネットワークエラー時の復旧処理', async () => {
      await setupTestEnvironment();
      
      // 1. 正常ログイン
      await page.goto('http://localhost:3000/login');
      await performLogin(page, 'test@example.com', 'password123');
      await page.waitForURL('http://localhost:3000/dashboard');
      
      // 2. ネットワークを無効化
      await page.setOfflineMode(true);
      
      // 3. APIリクエスト試行
      const refreshButton = await page.$('[data-testid="refresh-profile-button"]');
      if (refreshButton) {
        await refreshButton.click();
        
        // 4. ネットワークエラー表示を確認
        await page.waitForSelector('[data-testid="network-error-notification"]', {
          timeout: 5000
        });
      }
      
      // 5. ネットワークを復旧
      await page.setOfflineMode(false);
      
      // 6. リトライボタンをクリック
      const retryButton = await page.$('[data-testid="retry-button"]');
      if (retryButton) {
        await retryButton.click();
        
        // 7. 正常に復旧することを確認
        await page.waitForSelector('[data-testid="profile-data"]', {
          timeout: 10000
        });
      }
    });

    test('Firebase Auth API エラーのハンドリング', async () => {
      await setupTestEnvironment();
      
      await page.goto('http://localhost:3000/login');
      
      // 無効なメールフォーマットでログイン試行
      await page.fill('[data-testid="email-input"]', 'invalid-email');
      await page.fill('[data-testid="password-input"]', 'password123');
      await page.click('[data-testid="login-button"]');
      
      // エラーメッセージの表示確認
      await page.waitForSelector('[data-testid="error-notification"]');
      const errorText = await page.textContent('[data-testid="error-message"]');
      expect(errorText).toContain('有効なメールアドレス');
    });
  });
});