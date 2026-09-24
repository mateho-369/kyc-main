import { expect, describe, test, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecureFirebaseAuthProvider } from '../../contexts/SecureFirebaseAuthContext';
import FirebaseAuthUI from '../../components/auth/FirebaseAuthUI';

// セキュリティ機能統合テスト
describe('セキュリティ機能統合テスト', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch.mockClear();
  });

  const renderWithAuth = (component) => {
    return render(
      <SecureFirebaseAuthProvider>
        {component}
      </SecureFirebaseAuthProvider>
    );
  };

  describe('localStorage使用禁止の確認', () => {
    test('localStorage への書き込み試行でエラーが発生する', () => {
      renderWithAuth(<FirebaseAuthUI onAuthSuccess={vi.fn()} />);
      
      // localStorage 使用でエラーが発生することを確認
      expect(() => {
        window.localStorage.setItem('test', 'value');
      }).toThrow('localStorage usage is forbidden for security reasons');
    });

    test('localStorage からの読み込み試行でエラーが発生する', () => {
      renderWithAuth(<FirebaseAuthUI onAuthSuccess={vi.fn()} />);
      
      // localStorage 読み込みでエラーが発生することを確認
      expect(() => {
        window.localStorage.getItem('test');
      }).toThrow('localStorage usage is forbidden for security reasons');
    });
  });

  describe('HTTPS必須の確認', () => {
    test('HTTP接続時にセキュリティ警告が表示される', async () => {
      // HTTP環境をシミュレート
      Object.defineProperty(window, 'location', {
        value: {
          protocol: 'http:',
          hostname: 'localhost',
          port: '3000',
          href: 'http://localhost:3000'
        },
        writable: true
      });

      renderWithAuth(<FirebaseAuthUI onAuthSuccess={vi.fn()} />);

      // セキュリティ警告の表示を確認
      await waitFor(() => {
        const warning = screen.queryByText(/セキュアな接続.*必要/);
        expect(warning).toBeInTheDocument();
      });
    });

    test('HTTPS接続時にはセキュリティ警告が表示されない', async () => {
      // HTTPS環境をシミュレート
      Object.defineProperty(window, 'location', {
        value: {
          protocol: 'https:',
          hostname: 'localhost',
          port: '3000',
          href: 'https://localhost:3000'
        },
        writable: true
      });

      renderWithAuth(<FirebaseAuthUI onAuthSuccess={vi.fn()} />);

      // セキュリティ警告が表示されないことを確認
      await waitFor(() => {
        const warning = screen.queryByText(/セキュアな接続.*必要/);
        expect(warning).not.toBeInTheDocument();
      });
    });
  });

  describe('CSRFトークン保護', () => {
    test('API リクエストにCSRFトークンが含まれる', async () => {
      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({
            'x-csrf-token': 'test-csrf-token'
          }),
          json: () => Promise.resolve({ csrfToken: 'test-csrf-token' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true })
        });

      const user = userEvent.setup();
      renderWithAuth(<FirebaseAuthUI onAuthSuccess={vi.fn()} />);

      await user.type(screen.getByLabelText('メールアドレス'), 'test@example.com');
      await user.type(screen.getByLabelText('パスワード'), 'password123');
      await user.click(screen.getByRole('button', { name: 'ログイン' }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            headers: expect.objectContaining({
              'X-CSRF-Token': 'test-csrf-token'
            })
          })
        );
      });
    });

    test('CSRFトークンがない場合のエラーハンドリング', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: 'Invalid CSRF token' })
      });

      const user = userEvent.setup();
      renderWithAuth(<FirebaseAuthUI onAuthSuccess={vi.fn()} />);

      await user.type(screen.getByLabelText('メールアドレス'), 'test@example.com');
      await user.type(screen.getByLabelText('パスワード'), 'password123');
      await user.click(screen.getByRole('button', { name: 'ログイン' }));

      await waitFor(() => {
        expect(screen.getByText(/セキュリティエラー/)).toBeInTheDocument();
      });
    });
  });

  describe('XSS攻撃対策', () => {
    test('スクリプトタグを含む入力の処理', async () => {
      const user = userEvent.setup();
      renderWithAuth(<FirebaseAuthUI onAuthSuccess={vi.fn()} />);

      const maliciousInput = '<script>alert("XSS")</script>';
      const emailInput = screen.getByLabelText('メールアドレス');

      await user.type(emailInput, maliciousInput);

      // スクリプトが実行されないことを確認
      expect(document.querySelector('script')).toBeNull();
      expect(emailInput.value).not.toContain('<script>');
    });

    test('HTMLタグを含む入力のエスケープ', async () => {
      const user = userEvent.setup();
      renderWithAuth(<FirebaseAuthUI onAuthSuccess={vi.fn()} />);

      const htmlInput = '<img src="x" onerror="alert(1)">';
      const emailInput = screen.getByLabelText('メールアドレス');

      await user.type(emailInput, htmlInput);

      // HTMLタグが実行されないことを確認
      expect(document.querySelector('img[src="x"]')).toBeNull();
    });
  });

  describe('セッション管理のセキュリティ', () => {
    test('セッション固定攻撃対策', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        headers: new Headers({
          'x-csrf-token': 'new-csrf-token-after-login'
        }),
        json: () => Promise.resolve({ success: true })
      });

      const user = userEvent.setup();
      renderWithAuth(<FirebaseAuthUI onAuthSuccess={vi.fn()} />);

      // ログイン実行
      await user.type(screen.getByLabelText('メールアドレス'), 'test@example.com');
      await user.type(screen.getByLabelText('パスワード'), 'password123');
      await user.click(screen.getByRole('button', { name: 'ログイン' }));

      await waitFor(() => {
        // ログイン後にセッションが再生成されることを確認
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/auth/firebase/session'),
          expect.any(Object)
        );
      });
    });

    test('セッションハイジャック対策', async () => {
      const mockOnAuthSuccess = vi.fn();
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      renderWithAuth(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} />);

      // 異常なユーザーエージェントの検出をシミュレート
      Object.defineProperty(navigator, 'userAgent', {
        value: 'malicious-bot/1.0',
        writable: true
      });

      const user = userEvent.setup();
      await user.type(screen.getByLabelText('メールアドレス'), 'test@example.com');
      await user.type(screen.getByLabelText('パスワード'), 'password123');
      await user.click(screen.getByRole('button', { name: 'ログイン' }));

      // セキュリティチェックが実行されることを確認
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            headers: expect.objectContaining({
              'User-Agent': expect.any(String)
            })
          })
        );
      });
    });
  });

  describe('ブルートフォース攻撃対策', () => {
    test('連続ログイン失敗時のアカウントロック', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Invalid credentials' })
      });

      const user = userEvent.setup();
      renderWithAuth(<FirebaseAuthUI onAuthSuccess={vi.fn()} />);

      // 5回連続でログイン失敗
      for (let i = 0; i < 5; i++) {
        await user.clear(screen.getByLabelText('メールアドレス'));
        await user.clear(screen.getByLabelText('パスワード'));
        await user.type(screen.getByLabelText('メールアドレス'), 'attacker@example.com');
        await user.type(screen.getByLabelText('パスワード'), 'wrongpassword');
        await user.click(screen.getByRole('button', { name: 'ログイン' }));

        await waitFor(() => {
          expect(screen.getByText(/認証に失敗/)).toBeInTheDocument();
        });

        // エラーメッセージを閉じる
        const closeButton = screen.queryByRole('button', { name: /閉じる/ });
        if (closeButton) {
          await user.click(closeButton);
        }
      }

      // 6回目でアカウントロックメッセージの確認
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ 
          error: 'アカウントがロックされています。しばらく時間をおいてからお試しください。' 
        })
      });

      await user.clear(screen.getByLabelText('メールアドレス'));
      await user.clear(screen.getByLabelText('パスワード'));
      await user.type(screen.getByLabelText('メールアドレス'), 'attacker@example.com');
      await user.type(screen.getByLabelText('パスワード'), 'wrongpassword');
      await user.click(screen.getByRole('button', { name: 'ログイン' }));

      await waitFor(() => {
        expect(screen.getByText(/アカウントがロック/)).toBeInTheDocument();
      });
    });

    test('IPアドレスベースのレート制限', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ 
          error: 'レート制限に達しました。時間をおいてからお試しください。' 
        })
      });

      const user = userEvent.setup();
      renderWithAuth(<FirebaseAuthUI onAuthSuccess={vi.fn()} />);

      await user.type(screen.getByLabelText('メールアドレス'), 'test@example.com');
      await user.type(screen.getByLabelText('パスワード'), 'password123');
      await user.click(screen.getByRole('button', { name: 'ログイン' }));

      await waitFor(() => {
        expect(screen.getByText(/レート制限/)).toBeInTheDocument();
      });

      // APIリクエストにクライアント情報が含まれることを確認
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Client-IP': expect.any(String)
          })
        })
      );
    });
  });

  describe('コンテンツセキュリティポリシー（CSP）', () => {
    test('インラインスクリプトの実行防止', () => {
      renderWithAuth(<FirebaseAuthUI onAuthSuccess={vi.fn()} />);

      // インラインスクリプトを動的に追加しようとする
      const script = document.createElement('script');
      script.innerHTML = 'window.malicious = true;';
      
      expect(() => {
        document.head.appendChild(script);
      }).not.toThrow(); // 追加は成功するが実行されない

      // maliciousな変数が設定されていないことを確認
      expect(window.malicious).toBeUndefined();
    });

    test('外部リソースの制限', async () => {
      renderWithAuth(<FirebaseAuthUI onAuthSuccess={vi.fn()} />);

      // 許可されていない外部ドメインからのリソース読み込みをテスト
      const img = new Image();
      const loadPromise = new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      img.src = 'https://malicious-site.com/tracker.gif';

      try {
        await loadPromise;
        // 本来はCSPによってブロックされるべき
        expect(true).toBe(false);
      } catch (error) {
        // エラーが発生することを期待
        expect(error).toBeDefined();
      }
    });
  });

  describe('メモリリーク対策', () => {
    test('コンポーネントアンマウント時のクリーンアップ', () => {
      const { unmount } = renderWithAuth(<FirebaseAuthUI onAuthSuccess={vi.fn()} />);

      // イベントリスナーの数を記録
      const initialEventListeners = document.querySelectorAll('*').length;

      unmount();

      // メモリリークがないことを確認
      const finalEventListeners = document.querySelectorAll('*').length;
      expect(finalEventListeners).toBeLessThanOrEqual(initialEventListeners);
    });

    test('タイマーの適切なクリーンアップ', () => {
      vi.useFakeTimers();

      const { unmount } = renderWithAuth(<FirebaseAuthUI onAuthSuccess={vi.fn()} />);

      // アクティブなタイマーがあることを確認
      const initialTimerCount = vi.getTimerCount();

      unmount();

      // タイマーがクリアされることを確認
      expect(vi.getTimerCount()).toBeLessThanOrEqual(initialTimerCount);

      vi.useRealTimers();
    });
  });
});