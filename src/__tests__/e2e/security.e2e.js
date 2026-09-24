import { test, expect } from '@playwright/test';

// E2E セキュリティテスト
test.describe('セキュリティ機能 E2E テスト', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test.describe('HTTPS接続の確認', () => {
    test('HTTPS接続の強制確認', async ({ page }) => {
      // プロダクション環境でのHTTPS確認
      if (process.env.NODE_ENV === 'production') {
        expect(page.url()).toMatch(/^https:/);
      }

      // セキュリティヘッダーの確認
      const response = await page.goto('/');
      const headers = response.headers();
      
      // セキュリティヘッダーの存在確認
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('DENY');
      expect(headers['x-xss-protection']).toBe('1; mode=block');
    });

    test('セキュリティステータス表示の確認', async ({ page }) => {
      // ログイン後のセキュリティステータス確認
      await page.fill('[data-testid="email-input"]', 'existing-user@example.com');
      await page.fill('[data-testid="password-input"]', 'password123');
      await page.click('[data-testid="login-button"]');

      await expect(page).toHaveURL(/\/dashboard/);
      
      // セキュリティステータスカードの確認
      await expect(page.locator('[data-testid="security-status"]')).toBeVisible();
      await expect(page.locator('[data-testid="https-status"]')).toBeVisible();
      await expect(page.locator('[data-testid="auth-status"]')).toBeVisible();
      await expect(page.locator('[data-testid="session-status"]')).toBeVisible();
    });
  });

  test.describe('CSRF保護の確認', () => {
    test('CSRFトークンの自動付与確認', async ({ page }) => {
      // ネットワークリクエストの監視
      const requests = [];
      page.on('request', request => {
        if (request.url().includes('/api/')) {
          requests.push({
            url: request.url(),
            method: request.method(),
            headers: request.headers()
          });
        }
      });

      // ログイン実行
      await page.fill('[data-testid="email-input"]', 'test@example.com');
      await page.fill('[data-testid="password-input"]', 'password123');
      await page.click('[data-testid="login-button"]');

      // CSRFトークンがリクエストに含まれることを確認
      await page.waitForTimeout(2000);
      
      const apiRequests = requests.filter(req => req.method === 'POST');
      expect(apiRequests.length).toBeGreaterThan(0);
      
      const hasCSRFToken = apiRequests.some(req => 
        req.headers['x-csrf-token'] !== undefined
      );
      expect(hasCSRFToken).toBe(true);
    });

    test('CSRF攻撃シミュレーション防御確認', async ({ page, context }) => {
      // 正常なログイン
      await page.fill('[data-testid="email-input"]', 'existing-user@example.com');
      await page.fill('[data-testid="password-input"]', 'password123');
      await page.click('[data-testid="login-button"]');

      await expect(page).toHaveURL(/\/dashboard/);

      // 外部サイトからのCSRF攻撃をシミュレート
      const maliciousPage = await context.newPage();
      await maliciousPage.setContent(`
        <html>
          <body>
            <form id="csrf-attack" action="http://localhost:3001/api/user/profile" method="POST">
              <input type="hidden" name="malicious" value="attack">
            </form>
            <script>
              document.getElementById('csrf-attack').submit();
            </script>
          </body>
        </html>
      `);

      // 攻撃が失敗することを確認（実際の実装では403エラーが期待される）
      const response = await maliciousPage.waitForResponse(/api\/user\/profile/);
      expect(response.status()).toBe(403);

      await maliciousPage.close();
    });
  });

  test.describe('XSS攻撃対策', () => {
    test('スクリプトインジェクション防御', async ({ page }) => {
      const maliciousScript = '<script>window.xssAttack = true;</script>';
      
      // メールフィールドにスクリプトを入力
      await page.fill('[data-testid="email-input"]', maliciousScript);
      
      // スクリプトが実行されないことを確認
      const isAttackSuccessful = await page.evaluate(() => window.xssAttack);
      expect(isAttackSuccessful).toBeUndefined();

      // 入力値がエスケープされていることを確認
      const emailValue = await page.inputValue('[data-testid="email-input"]');
      expect(emailValue).not.toContain('<script>');
    });

    test('HTMLインジェクション防御', async ({ page }) => {
      const maliciousHTML = '<img src="x" onerror="window.htmlAttack=true">';
      
      await page.fill('[data-testid="email-input"]', maliciousHTML);
      
      // HTMLが実行されないことを確認
      const isAttackSuccessful = await page.evaluate(() => window.htmlAttack);
      expect(isAttackSuccessful).toBeUndefined();

      // 悪意のある画像要素が作成されていないことを確認
      const maliciousImages = await page.locator('img[src="x"]').count();
      expect(maliciousImages).toBe(0);
    });

    test('DOMベースXSS防御', async ({ page }) => {
      // URLハッシュに悪意のあるスクリプトを設定
      await page.goto('/#<script>window.domXssAttack=true;</script>');
      
      // スクリプトが実行されないことを確認
      const isAttackSuccessful = await page.evaluate(() => window.domXssAttack);
      expect(isAttackSuccessful).toBeUndefined();
    });
  });

  test.describe('セッションセキュリティ', () => {
    test('セッション固定攻撃対策', async ({ page, context }) => {
      // ログイン前のセッションID取得
      const preLoginCookies = await context.cookies();
      
      // ログイン実行
      await page.fill('[data-testid="email-input"]', 'existing-user@example.com');
      await page.fill('[data-testid="password-input"]', 'password123');
      await page.click('[data-testid="login-button"]');

      await expect(page).toHaveURL(/\/dashboard/);

      // ログイン後のセッションID取得
      const postLoginCookies = await context.cookies();
      
      // セッションIDが変更されていることを確認
      const preSessionCookie = preLoginCookies.find(c => c.name === '__session');
      const postSessionCookie = postLoginCookies.find(c => c.name === '__session');
      
      if (preSessionCookie && postSessionCookie) {
        expect(preSessionCookie.value).not.toBe(postSessionCookie.value);
      }
    });

    test('セッションハイジャック対策', async ({ page, context }) => {
      // ログイン
      await page.fill('[data-testid="email-input"]', 'existing-user@example.com');
      await page.fill('[data-testid="password-input"]', 'password123');
      await page.click('[data-testid="login-button"]');

      await expect(page).toHaveURL(/\/dashboard/);

      // セッションクッキーの取得
      const cookies = await context.cookies();
      const sessionCookie = cookies.find(c => c.name === '__session');
      
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie.httpOnly).toBe(true);
      expect(sessionCookie.secure).toBe(true);
      expect(sessionCookie.sameSite).toBe('Strict');
    });

    test('セッションタイムアウト機能', async ({ page }) => {
      // ログイン
      await page.fill('[data-testid="email-input"]', 'existing-user@example.com');
      await page.fill('[data-testid="password-input"]', 'password123');
      await page.click('[data-testid="login-button"]');

      await expect(page).toHaveURL(/\/dashboard/);

      // セッションタイムアウトの動作確認（短時間でテスト）
      // 実際の実装では2時間だが、テスト用に短縮
      await page.evaluate(() => {
        // セッションタイムアウト時間を5秒に短縮
        localStorage.setItem('test-session-timeout', '5000');
      });

      // 5秒待機
      await page.waitForTimeout(6000);

      // ページを更新してセッション状態を確認
      await page.reload();

      // セッションタイムアウトによりログイン画面にリダイレクトされることを確認
      await expect(page).toHaveURL(/\/login/);
    });
  });

  test.describe('ブルートフォース攻撃対策', () => {
    test('連続ログイン失敗によるアカウントロック', async ({ page }) => {
      const attackEmail = 'brute-force-test@example.com';

      // 5回連続でログイン失敗
      for (let i = 0; i < 5; i++) {
        await page.fill('[data-testid="email-input"]', attackEmail);
        await page.fill('[data-testid="password-input"]', `wrongpassword${i}`);
        await page.click('[data-testid="login-button"]');

        // エラーメッセージの表示確認
        await expect(page.locator('[data-testid="error-notification"]')).toBeVisible();

        // エラーを閉じて次の試行へ
        const closeButton = page.locator('[data-testid="error-close-button"]');
        if (await closeButton.isVisible()) {
          await closeButton.click();
        }

        await page.waitForTimeout(1000);
      }

      // 6回目でアカウントロックメッセージを確認
      await page.fill('[data-testid="email-input"]', attackEmail);
      await page.fill('[data-testid="password-input"]', 'wrongpassword6');
      await page.click('[data-testid="login-button"]');

      await expect(page.locator('[data-testid="error-notification"]')).toBeVisible();
      await expect(page.locator('[data-testid="error-message"]')).toContainText(/ロック|制限|時間をおいて/);
    });

    test('レート制限による攻撃防御', async ({ page }) => {
      // 短時間での大量リクエスト送信
      const startTime = Date.now();
      
      for (let i = 0; i < 10; i++) {
        await page.fill('[data-testid="email-input"]', `rate-limit-test${i}@example.com`);
        await page.fill('[data-testid="password-input"]', 'password');
        await page.click('[data-testid="login-button"]');

        // レート制限に引っかかるまで続行
        const errorText = await page.locator('[data-testid="error-message"]').textContent();
        if (errorText && errorText.includes('制限')) {
          break;
        }

        await page.waitForTimeout(100);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // レート制限が適切に機能していることを確認
      expect(duration).toBeLessThan(10000); // 10秒以内でレート制限が発動
      await expect(page.locator('[data-testid="error-message"]')).toContainText(/制限|時間をおいて/);
    });
  });

  test.describe('Content Security Policy (CSP)', () => {
    test('インラインスクリプトの実行防止', async ({ page }) => {
      // CSPエラーの監視
      const cspViolations = [];
      page.on('console', msg => {
        if (msg.type() === 'error' && msg.text().includes('Content Security Policy')) {
          cspViolations.push(msg.text());
        }
      });

      // インラインスクリプトの動的追加を試行
      await page.evaluate(() => {
        const script = document.createElement('script');
        script.innerHTML = 'window.cspViolation = true;';
        document.head.appendChild(script);
      });

      // CSP違反が検出されることを確認
      await page.waitForTimeout(1000);
      expect(cspViolations.length).toBeGreaterThan(0);

      // 悪意のあるスクリプトが実行されていないことを確認
      const isViolationSuccessful = await page.evaluate(() => window.cspViolation);
      expect(isViolationSuccessful).toBeUndefined();
    });

    test('外部リソース読み込み制限', async ({ page }) => {
      // 外部リソースの読み込み試行
      const resourceErrors = [];
      page.on('response', response => {
        if (!response.ok() && response.url().includes('malicious-site.com')) {
          resourceErrors.push(response.url());
        }
      });

      await page.evaluate(() => {
        const img = new Image();
        img.src = 'https://malicious-site.com/tracker.gif';
        document.body.appendChild(img);
      });

      await page.waitForTimeout(2000);

      // 外部リソースの読み込みがブロックされることを確認
      expect(resourceErrors.length).toBeGreaterThan(0);
    });
  });

  test.describe('データ保護', () => {
    test('localStorage使用禁止の確認', async ({ page }) => {
      // localStorageへのアクセス試行
      const localStorageError = await page.evaluate(() => {
        try {
          localStorage.setItem('test', 'value');
          return null;
        } catch (error) {
          return error.message;
        }
      });

      // localStorage使用でエラーが発生することを確認
      expect(localStorageError).toContain('forbidden');
    });

    test('機密情報のコンソールログ出力防止', async ({ page }) => {
      const consoleLogs = [];
      page.on('console', msg => {
        consoleLogs.push(msg.text());
      });

      // パスワードを含む操作を実行
      await page.fill('[data-testid="password-input"]', 'secretpassword123');
      await page.click('[data-testid="login-button"]');

      await page.waitForTimeout(2000);

      // コンソールログにパスワードが含まれていないことを確認
      const hasPasswordInLogs = consoleLogs.some(log => 
        log.includes('secretpassword123')
      );
      expect(hasPasswordInLogs).toBe(false);
    });

    test('HTTPSでのCookie送信確認', async ({ page, context }) => {
      // ログイン実行
      await page.fill('[data-testid="email-input"]', 'existing-user@example.com');
      await page.fill('[data-testid="password-input"]', 'password123');
      await page.click('[data-testid="login-button"]');

      await expect(page).toHaveURL(/\/dashboard/);

      // セキュアクッキーの確認
      const cookies = await context.cookies();
      const sessionCookie = cookies.find(c => c.name === '__session');
      
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie.secure).toBe(true);
      expect(sessionCookie.httpOnly).toBe(true);
    });
  });
});