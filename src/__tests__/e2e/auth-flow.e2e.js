import { test, expect } from '@playwright/test';

// E2E認証フローテスト
test.describe('Firebase認証フロー E2E テスト', () => {
  let testUser;

  test.beforeEach(async ({ page }) => {
    // テストユーザーの設定
    testUser = {
      email: `e2e-test-${Date.now()}@example.com`,
      password: 'SecurePassword123!',
      name: 'E2E Test User'
    };

    // ベースURLに移動
    await page.goto('/');
  });

  test.describe('新規ユーザー登録フロー', () => {
    test('完全な新規ユーザー登録からダッシュボードアクセスまで', async ({ page }) => {
      // 1. ログインページの表示確認
      await expect(page).toHaveTitle(/SafeVideo KYC/);
      await expect(page.locator('[data-testid="login-form"]')).toBeVisible();

      // 2. 新規登録モードに切り替え
      await page.click('[data-testid="switch-to-register"]');
      await expect(page.locator('[data-testid="register-form"]')).toBeVisible();

      // 3. ユーザー情報入力
      await page.fill('[data-testid="email-input"]', testUser.email);
      await page.fill('[data-testid="password-input"]', testUser.password);
      await page.fill('[data-testid="confirm-password-input"]', testUser.password);

      // 4. 登録実行
      await page.click('[data-testid="register-button"]');

      // 5. 登録処理の完了待機
      await expect(page.locator('[data-testid="success-notification"]')).toBeVisible({
        timeout: 15000
      });

      // 6. ダッシュボードへのリダイレクト確認
      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page.locator('[data-testid="dashboard-header"]')).toBeVisible();

      // 7. ユーザー情報の表示確認
      await expect(page.locator('[data-testid="user-email"]')).toContainText(testUser.email);

      // 8. セキュリティステータスの確認
      await expect(page.locator('[data-testid="security-status"]')).toBeVisible();
      await expect(page.locator('[data-testid="https-status"]')).toBeVisible();
    });

    test('パスワード不一致時のバリデーション', async ({ page }) => {
      await page.click('[data-testid="switch-to-register"]');
      
      await page.fill('[data-testid="email-input"]', testUser.email);
      await page.fill('[data-testid="password-input"]', testUser.password);
      await page.fill('[data-testid="confirm-password-input"]', 'DifferentPassword123!');

      await page.click('[data-testid="register-button"]');

      // エラーメッセージの表示確認
      await expect(page.locator('[data-testid="error-notification"]')).toBeVisible();
      await expect(page.locator('[data-testid="error-message"]')).toContainText('パスワードが一致しません');
    });

    test('無効なメールアドレスのバリデーション', async ({ page }) => {
      await page.click('[data-testid="switch-to-register"]');
      
      await page.fill('[data-testid="email-input"]', 'invalid-email');
      await page.fill('[data-testid="password-input"]', testUser.password);
      await page.fill('[data-testid="confirm-password-input"]', testUser.password);

      await page.click('[data-testid="register-button"]');

      // エラーメッセージの表示確認
      await expect(page.locator('[data-testid="error-notification"]')).toBeVisible();
      await expect(page.locator('[data-testid="error-message"]')).toContainText('有効なメールアドレス');
    });
  });

  test.describe('ログインフロー', () => {
    test('正常なログインフロー', async ({ page }) => {
      // 事前にテストユーザーを作成（実際の環境では別途セットアップ）
      const existingUser = {
        email: 'existing-user@example.com',
        password: 'password123'
      };

      // 1. ログイン情報入力
      await page.fill('[data-testid="email-input"]', existingUser.email);
      await page.fill('[data-testid="password-input"]', existingUser.password);

      // 2. ログイン実行
      await page.click('[data-testid="login-button"]');

      // 3. ダッシュボードへのリダイレクト確認
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
      await expect(page.locator('[data-testid="dashboard-header"]')).toBeVisible();

      // 4. ユーザー情報の確認
      await expect(page.locator('[data-testid="user-email"]')).toContainText(existingUser.email);
    });

    test('無効な認証情報でのログイン試行', async ({ page }) => {
      await page.fill('[data-testid="email-input"]', 'nonexistent@example.com');
      await page.fill('[data-testid="password-input"]', 'wrongpassword');

      await page.click('[data-testid="login-button"]');

      // エラーメッセージの表示確認
      await expect(page.locator('[data-testid="error-notification"]')).toBeVisible();
      await expect(page.locator('[data-testid="error-message"]')).toContainText(/認証に失敗|アカウントが見つかりません/);
    });

    test('空のフィールドでの送信試行', async ({ page }) => {
      await page.click('[data-testid="login-button"]');

      // バリデーションエラーの確認
      await expect(page.locator('[data-testid="error-notification"]')).toBeVisible();
      await expect(page.locator('[data-testid="error-message"]')).toContainText(/必須|入力してください/);
    });
  });

  test.describe('Googleログイン', () => {
    test('Googleログインボタンの存在確認', async ({ page }) => {
      await expect(page.locator('[data-testid="google-login-button"]')).toBeVisible();
      
      // ボタンのテキスト確認
      await expect(page.locator('[data-testid="google-login-button"]')).toContainText('Google');
    });

    test('Googleログインポップアップの起動確認', async ({ page, context }) => {
      // 新しいページのオープンを監視
      const pagePromise = context.waitForEvent('page');
      
      await page.click('[data-testid="google-login-button"]');
      
      // ポップアップウィンドウの確認（エミュレーター環境）
      const popup = await pagePromise;
      await expect(popup).toHaveURL(/accounts\.google\.com|localhost:9099/);
      
      await popup.close();
    });
  });

  test.describe('パスワードリセット', () => {
    test('パスワードリセットフローの開始', async ({ page }) => {
      // 1. パスワードリセットリンクをクリック
      await page.click('[data-testid="forgot-password-link"]');

      // 2. パスワードリセットモードの確認
      await expect(page.locator('[data-testid="reset-password-form"]')).toBeVisible();
      await expect(page.locator('h2')).toContainText('パスワードリセット');

      // 3. メールアドレス入力
      await page.fill('[data-testid="email-input"]', 'test@example.com');

      // 4. リセットメール送信
      await page.click('[data-testid="send-reset-email-button"]');

      // 5. 成功メッセージの確認
      await expect(page.locator('[data-testid="success-notification"]')).toBeVisible();
      await expect(page.locator('[data-testid="success-message"]')).toContainText(/メールを送信/);
    });

    test('無効なメールでのパスワードリセット', async ({ page }) => {
      await page.click('[data-testid="forgot-password-link"]');
      
      await page.fill('[data-testid="email-input"]', 'invalid-email');
      await page.click('[data-testid="send-reset-email-button"]');

      // エラーメッセージの確認
      await expect(page.locator('[data-testid="error-notification"]')).toBeVisible();
      await expect(page.locator('[data-testid="error-message"]')).toContainText('有効なメールアドレス');
    });
  });

  test.describe('セッション管理', () => {
    test('ログイン後のセッション維持', async ({ page }) => {
      // ログイン
      await page.fill('[data-testid="email-input"]', 'existing-user@example.com');
      await page.fill('[data-testid="password-input"]', 'password123');
      await page.click('[data-testid="login-button"]');

      await expect(page).toHaveURL(/\/dashboard/);

      // ページリロード後もセッションが維持されることを確認
      await page.reload();
      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page.locator('[data-testid="dashboard-header"]')).toBeVisible();
    });

    test('ログアウト機能', async ({ page }) => {
      // ログイン
      await page.fill('[data-testid="email-input"]', 'existing-user@example.com');
      await page.fill('[data-testid="password-input"]', 'password123');
      await page.click('[data-testid="login-button"]');

      await expect(page).toHaveURL(/\/dashboard/);

      // ログアウト
      await page.click('[data-testid="logout-button"]');

      // ログインページにリダイレクトされることを確認
      await expect(page).toHaveURL(/\/login/);
      await expect(page.locator('[data-testid="login-form"]')).toBeVisible();
    });

    test('未認証時のダッシュボードアクセス制限', async ({ page }) => {
      // 直接ダッシュボードにアクセス
      await page.goto('/dashboard');

      // ログインページにリダイレクトされることを確認
      await expect(page).toHaveURL(/\/login/);
      await expect(page.locator('[data-testid="login-form"]')).toBeVisible();
    });
  });

  test.describe('レスポンシブデザイン', () => {
    test('モバイル画面での表示', async ({ page }) => {
      // モバイル画面サイズに設定
      await page.setViewportSize({ width: 375, height: 667 });

      await page.goto('/');

      // モバイル向けのレイアウト確認
      await expect(page.locator('[data-testid="login-form"]')).toBeVisible();
      
      // タッチターゲットのサイズ確認（44px以上）
      const loginButton = page.locator('[data-testid="login-button"]');
      const buttonBox = await loginButton.boundingBox();
      expect(buttonBox.height).toBeGreaterThanOrEqual(44);
    });

    test('タブレット画面での表示', async ({ page }) => {
      // タブレット画面サイズに設定
      await page.setViewportSize({ width: 768, height: 1024 });

      await page.goto('/');

      // タブレット向けのレイアウト確認
      await expect(page.locator('[data-testid="login-form"]')).toBeVisible();
      
      // レイアウトの適切な調整確認
      const form = page.locator('[data-testid="login-form"]');
      const formBox = await form.boundingBox();
      expect(formBox.width).toBeLessThan(600); // 最大幅の制限
    });
  });

  test.describe('アクセシビリティ', () => {
    test('キーボードナビゲーション', async ({ page }) => {
      await page.goto('/');

      // タブキーでのナビゲーション
      await page.keyboard.press('Tab');
      await expect(page.locator('[data-testid="email-input"]')).toBeFocused();

      await page.keyboard.press('Tab');
      await expect(page.locator('[data-testid="password-input"]')).toBeFocused();

      await page.keyboard.press('Tab');
      await expect(page.locator('[data-testid="login-button"]')).toBeFocused();

      // Enterキーでのフォーム送信
      await page.fill('[data-testid="email-input"]', 'test@example.com');
      await page.fill('[data-testid="password-input"]', 'password123');
      await page.keyboard.press('Enter');

      // フォーム送信の実行確認
      await expect(page.locator('[data-testid="loading-state"]')).toBeVisible();
    });

    test('スクリーンリーダー対応のARIA属性', async ({ page }) => {
      await page.goto('/');

      // ARIA属性の確認
      await expect(page.locator('[data-testid="email-input"]')).toHaveAttribute('aria-label');
      await expect(page.locator('[data-testid="password-input"]')).toHaveAttribute('aria-label');
      
      // エラーメッセージのARIA属性
      await page.fill('[data-testid="email-input"]', 'invalid');
      await page.click('[data-testid="login-button"]');
      
      await expect(page.locator('[data-testid="error-notification"]')).toHaveAttribute('role', 'alert');
      await expect(page.locator('[data-testid="error-notification"]')).toHaveAttribute('aria-live');
    });
  });
});