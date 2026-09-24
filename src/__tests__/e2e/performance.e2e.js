import { test, expect } from '@playwright/test';

// E2E パフォーマンステスト
test.describe('パフォーマンス E2E テスト', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test.describe('ページ読み込みパフォーマンス', () => {
    test('初回ページ読み込み時間の測定', async ({ page }) => {
      const startTime = Date.now();
      
      // ページ読み込み開始
      await page.goto('/');
      
      // メインコンテンツの表示を待機
      await page.waitForSelector('[data-testid="login-form"]');
      
      const endTime = Date.now();
      const loadTime = endTime - startTime;
      
      console.log(`ページ読み込み時間: ${loadTime}ms`);
      
      // 3秒以内での読み込み完了を確認
      expect(loadTime).toBeLessThan(3000);
    });

    test('リソース読み込み時間の測定', async ({ page }) => {
      // ネットワークアクティビティの監視
      const resourceTimes = [];
      
      page.on('response', response => {
        const timing = response.timing();
        resourceTimes.push({
          url: response.url(),
          status: response.status(),
          time: timing ? timing.responseEnd : 0
        });
      });

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // 重要なリソースの読み込み時間確認
      const cssFiles = resourceTimes.filter(r => r.url.includes('.css'));
      const jsFiles = resourceTimes.filter(r => r.url.includes('.js'));

      console.log(`CSS ファイル数: ${cssFiles.length}`);
      console.log(`JS ファイル数: ${jsFiles.length}`);

      // CSS/JSファイルが2秒以内に読み込まれることを確認
      cssFiles.forEach(css => {
        expect(css.time).toBeLessThan(2000);
      });

      jsFiles.forEach(js => {
        expect(js.time).toBeLessThan(2000);
      });
    });

    test('Core Web Vitals の測定', async ({ page }) => {
      await page.goto('/');
      
      // First Contentful Paint (FCP) の測定
      const fcp = await page.evaluate(() => {
        return new Promise((resolve) => {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (entry.name === 'first-contentful-paint') {
                resolve(entry.startTime);
              }
            }
          }).observe({ entryTypes: ['paint'] });
        });
      });

      console.log(`First Contentful Paint: ${fcp}ms`);
      expect(fcp).toBeLessThan(1500); // 1.5秒以内

      // Largest Contentful Paint (LCP) の測定
      const lcp = await page.evaluate(() => {
        return new Promise((resolve) => {
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            const lastEntry = entries[entries.length - 1];
            resolve(lastEntry.startTime);
          }).observe({ entryTypes: ['largest-contentful-paint'] });
          
          // 5秒後にタイムアウト
          setTimeout(() => resolve(0), 5000);
        });
      });

      if (lcp > 0) {
        console.log(`Largest Contentful Paint: ${lcp}ms`);
        expect(lcp).toBeLessThan(2500); // 2.5秒以内
      }

      // Cumulative Layout Shift (CLS) の測定
      const cls = await page.evaluate(() => {
        return new Promise((resolve) => {
          let clsValue = 0;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (!entry.hadRecentInput) {
                clsValue += entry.value;
              }
            }
          }).observe({ entryTypes: ['layout-shift'] });
          
          setTimeout(() => resolve(clsValue), 3000);
        });
      });

      console.log(`Cumulative Layout Shift: ${cls}`);
      expect(cls).toBeLessThan(0.1); // 0.1以下
    });
  });

  test.describe('認証フローのパフォーマンス', () => {
    test('ログイン処理時間の測定', async ({ page }) => {
      await page.fill('[data-testid="email-input"]', 'existing-user@example.com');
      await page.fill('[data-testid="password-input"]', 'password123');

      const startTime = Date.now();
      
      await page.click('[data-testid="login-button"]');
      
      // ダッシュボードページの表示完了を待機
      await page.waitForURL(/\/dashboard/);
      await page.waitForSelector('[data-testid="dashboard-header"]');
      
      const endTime = Date.now();
      const loginTime = endTime - startTime;
      
      console.log(`ログイン処理時間: ${loginTime}ms`);
      
      // 3秒以内でのログイン完了を確認
      expect(loginTime).toBeLessThan(3000);
    });

    test('新規登録処理時間の測定', async ({ page }) => {
      const testUser = {
        email: `perf-test-${Date.now()}@example.com`,
        password: 'SecurePassword123!'
      };

      await page.click('[data-testid="switch-to-register"]');
      await page.fill('[data-testid="email-input"]', testUser.email);
      await page.fill('[data-testid="password-input"]', testUser.password);
      await page.fill('[data-testid="confirm-password-input"]', testUser.password);

      const startTime = Date.now();
      
      await page.click('[data-testid="register-button"]');
      
      // 登録完了とダッシュボード表示を待機
      await page.waitForURL(/\/dashboard/);
      await page.waitForSelector('[data-testid="dashboard-header"]');
      
      const endTime = Date.now();
      const registerTime = endTime - startTime;
      
      console.log(`新規登録処理時間: ${registerTime}ms`);
      
      // 5秒以内での登録完了を確認
      expect(registerTime).toBeLessThan(5000);
    });

    test('セッション初期化時間の測定', async ({ page }) => {
      const startTime = Date.now();
      
      // セッション初期化APIレスポンスを監視
      const sessionInitPromise = page.waitForResponse(
        response => response.url().includes('/api/auth/session/init')
      );
      
      await page.goto('/');
      
      const sessionResponse = await sessionInitPromise;
      const endTime = Date.now();
      const sessionInitTime = endTime - startTime;
      
      console.log(`セッション初期化時間: ${sessionInitTime}ms`);
      
      // セッション初期化が1秒以内に完了することを確認
      expect(sessionInitTime).toBeLessThan(1000);
      expect(sessionResponse.ok()).toBe(true);
    });
  });

  test.describe('APIレスポンス時間', () => {
    test('ユーザープロフィール取得時間', async ({ page }) => {
      // ログイン
      await page.fill('[data-testid="email-input"]', 'existing-user@example.com');
      await page.fill('[data-testid="password-input"]', 'password123');
      await page.click('[data-testid="login-button"]');
      await page.waitForURL(/\/dashboard/);

      const startTime = Date.now();
      
      // プロフィールAPIレスポンスを監視
      const profilePromise = page.waitForResponse(
        response => response.url().includes('/api/user/profile')
      );
      
      // プロフィール更新ボタンをクリック（存在する場合）
      const refreshButton = page.locator('[data-testid="refresh-profile-button"]');
      if (await refreshButton.isVisible()) {
        await refreshButton.click();
      }
      
      const profileResponse = await profilePromise;
      const endTime = Date.now();
      const apiTime = endTime - startTime;
      
      console.log(`プロフィールAPI応答時間: ${apiTime}ms`);
      
      // API応答が2秒以内であることを確認
      expect(apiTime).toBeLessThan(2000);
      expect(profileResponse.ok()).toBe(true);
    });

    test('KYCステータス取得時間', async ({ page }) => {
      // ログイン
      await page.fill('[data-testid="email-input"]', 'existing-user@example.com');
      await page.fill('[data-testid="password-input"]', 'password123');
      await page.click('[data-testid="login-button"]');
      await page.waitForURL(/\/dashboard/);

      const startTime = Date.now();
      
      // KYCステータスAPIレスポンスを監視
      const kycPromise = page.waitForResponse(
        response => response.url().includes('/api/user/kyc-status')
      );
      
      const kycResponse = await kycPromise;
      const endTime = Date.now();
      const apiTime = endTime - startTime;
      
      console.log(`KYCステータスAPI応答時間: ${apiTime}ms`);
      
      // API応答が1.5秒以内であることを確認
      expect(apiTime).toBeLessThan(1500);
      expect(kycResponse.ok()).toBe(true);
    });
  });

  test.describe('負荷テスト', () => {
    test('同時ログイン処理の負荷テスト', async ({ browser }) => {
      const contexts = [];
      const pages = [];
      const results = [];

      try {
        // 5つの並列セッションを作成
        for (let i = 0; i < 5; i++) {
          const context = await browser.newContext();
          const page = await context.newPage();
          contexts.push(context);
          pages.push(page);
        }

        const startTime = Date.now();

        // 並列でログイン処理を実行
        const loginPromises = pages.map(async (page, index) => {
          try {
            await page.goto('/');
            await page.fill('[data-testid="email-input"]', `load-test-${index}@example.com`);
            await page.fill('[data-testid="password-input"]', 'password123');
            await page.click('[data-testid="login-button"]');
            
            // 結果を待機（成功またはエラー）
            try {
              await page.waitForURL(/\/dashboard/, { timeout: 10000 });
              return { success: true, index };
            } catch (error) {
              return { success: false, index, error: error.message };
            }
          } catch (error) {
            return { success: false, index, error: error.message };
          }
        });

        const loginResults = await Promise.allSettled(loginPromises);
        const endTime = Date.now();
        const totalTime = endTime - startTime;

        console.log(`並列ログイン処理時間: ${totalTime}ms`);

        // 結果の集計
        const successCount = loginResults.filter(
          result => result.status === 'fulfilled' && result.value.success
        ).length;

        console.log(`成功したログイン数: ${successCount}/5`);

        // 80%以上の成功率を期待
        expect(successCount).toBeGreaterThanOrEqual(4);
        
        // 全体処理時間が10秒以内であることを確認
        expect(totalTime).toBeLessThan(10000);

      } finally {
        // クリーンアップ
        for (const context of contexts) {
          await context.close();
        }
      }
    });

    test('大量データ表示のパフォーマンス', async ({ page }) => {
      // ログイン
      await page.fill('[data-testid="email-input"]', 'existing-user@example.com');
      await page.fill('[data-testid="password-input"]', 'password123');
      await page.click('[data-testid="login-button"]');
      await page.waitForURL(/\/dashboard/);

      const startTime = Date.now();

      // 大量データを含むページに移動（存在する場合）
      const dataTableLink = page.locator('[data-testid="large-data-table-link"]');
      if (await dataTableLink.isVisible()) {
        await dataTableLink.click();
        
        // データテーブルの表示完了を待機
        await page.waitForSelector('[data-testid="data-table"]');
        
        const endTime = Date.now();
        const renderTime = endTime - startTime;
        
        console.log(`大量データ表示時間: ${renderTime}ms`);
        
        // 5秒以内での表示完了を確認
        expect(renderTime).toBeLessThan(5000);
      } else {
        console.log('大量データテーブルが見つからないため、テストをスキップします');
      }
    });
  });

  test.describe('メモリ使用量', () => {
    test('メモリリークの検出', async ({ page }) => {
      // 初期メモリ使用量を測定
      await page.goto('/');
      
      const initialMemory = await page.evaluate(() => {
        if (performance.memory) {
          return {
            used: performance.memory.usedJSHeapSize,
            total: performance.memory.totalJSHeapSize
          };
        }
        return null;
      });

      if (!initialMemory) {
        console.log('ブラウザでメモリ情報が取得できないため、テストをスキップします');
        return;
      }

      console.log(`初期メモリ使用量: ${Math.round(initialMemory.used / 1024 / 1024)}MB`);

      // 認証フローを10回繰り返す
      for (let i = 0; i < 10; i++) {
        await page.fill('[data-testid="email-input"]', 'existing-user@example.com');
        await page.fill('[data-testid="password-input"]', 'password123');
        await page.click('[data-testid="login-button"]');
        
        await page.waitForURL(/\/dashboard/);
        
        // ログアウト
        await page.click('[data-testid="logout-button"]');
        await page.waitForURL(/\/login/);
        
        // ガベージコレクションを促進
        await page.evaluate(() => {
          if (window.gc) {
            window.gc();
          }
        });
      }

      // 最終メモリ使用量を測定
      const finalMemory = await page.evaluate(() => {
        if (performance.memory) {
          return {
            used: performance.memory.usedJSHeapSize,
            total: performance.memory.totalJSHeapSize
          };
        }
        return null;
      });

      console.log(`最終メモリ使用量: ${Math.round(finalMemory.used / 1024 / 1024)}MB`);

      const memoryIncrease = finalMemory.used - initialMemory.used;
      const increasePercentage = (memoryIncrease / initialMemory.used) * 100;

      console.log(`メモリ増加: ${Math.round(memoryIncrease / 1024 / 1024)}MB (${increasePercentage.toFixed(2)}%)`);

      // メモリ使用量の増加が50%以下であることを確認
      expect(increasePercentage).toBeLessThan(50);
    });
  });
});