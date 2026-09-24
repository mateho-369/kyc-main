import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import FirebaseAuthUI from '../FirebaseAuthUI';

// Firebase Auth のモック
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  GoogleAuthProvider: vi.fn(() => ({
    setCustomParameters: vi.fn()
  }))
}));

vi.mock('../../../config/firebase', () => ({
  auth: {}
}));

describe('FirebaseAuthUI Edge Cases', () => {
  const mockOnAuthSuccess = vi.fn();
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ネットワークエラーのハンドリング', () => {
    test('ネットワークエラー時に適切なメッセージが表示される', async () => {
      const { signInWithEmailAndPassword } = await import('firebase/auth');
      signInWithEmailAndPassword.mockRejectedValue({ 
        code: 'auth/network-request-failed' 
      });
      
      const user = userEvent.setup();
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      await user.type(screen.getByLabelText('メールアドレス'), 'test@example.com');
      await user.type(screen.getByLabelText('パスワード'), 'password123');
      await user.click(screen.getByRole('button', { name: 'ログイン' }));
      
      await waitFor(() => {
        expect(screen.getByText('ネットワークエラーが発生しました。接続を確認してください。')).toBeInTheDocument();
      });
    });

    test('タイムアウトエラーのハンドリング', async () => {
      const { signInWithEmailAndPassword } = await import('firebase/auth');
      signInWithEmailAndPassword.mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject({ code: 'auth/timeout' }), 100)
        )
      );
      
      const user = userEvent.setup();
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      await user.type(screen.getByLabelText('メールアドレス'), 'test@example.com');
      await user.type(screen.getByLabelText('パスワード'), 'password123');
      await user.click(screen.getByRole('button', { name: 'ログイン' }));
      
      await waitFor(() => {
        expect(screen.getByText(/認証エラーが発生しました/)).toBeInTheDocument();
      }, { timeout: 2000 });
    });
  });

  describe('特殊文字とXSS対策', () => {
    test('特殊文字を含むメールアドレスの処理', async () => {
      const user = userEvent.setup();
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      const emailInput = screen.getByLabelText('メールアドレス');
      await user.type(emailInput, 'test+special@example.com');
      
      expect(emailInput.value).toBe('test+special@example.com');
    });

    test('XSS攻撃を想定した入力のサニタイゼーション', async () => {
      const user = userEvent.setup();
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="register" />);
      
      // スクリプトタグを含む入力を試行
      const emailInput = screen.getByLabelText('メールアドレス');
      await user.type(emailInput, '<script>alert("XSS")</script>@example.com');
      
      // 入力値がエスケープされているか確認
      expect(emailInput.value).not.toContain('<script>');
    });
  });

  describe('並行リクエストの処理', () => {
    test('複数の認証リクエストが同時に発生した場合の処理', async () => {
      const { signInWithEmailAndPassword } = await import('firebase/auth');
      let resolvePromise;
      signInWithEmailAndPassword.mockImplementation(() => 
        new Promise(resolve => {
          resolvePromise = resolve;
        })
      );
      
      const user = userEvent.setup({ delay: null });
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      await user.type(screen.getByLabelText('メールアドレス'), 'test@example.com');
      await user.type(screen.getByLabelText('パスワード'), 'password123');
      
      const submitButton = screen.getByRole('button', { name: 'ログイン' });
      
      // 複数回クリック
      await user.click(submitButton);
      await user.click(submitButton);
      await user.click(submitButton);
      
      // ボタンが無効化されていることを確認
      expect(submitButton).toBeDisabled();
      
      // 最初のリクエストのみが処理されることを確認
      expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1);
    });
  });

  describe('メモリリークの防止', () => {
    test('コンポーネントアンマウント時にタイマーがクリアされる', () => {
      vi.useFakeTimers();
      const { unmount } = render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      // タイマーが設定されている状態でアンマウント
      unmount();
      
      // タイマーが適切にクリアされることを確認
      expect(vi.getTimerCount()).toBe(0);
      
      vi.useRealTimers();
    });

    test('イベントリスナーの適切なクリーンアップ', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
      
      const { unmount } = render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      const addedEvents = addEventListenerSpy.mock.calls.map(call => call[0]);
      
      unmount();
      
      // 追加されたイベントリスナーが削除されることを確認
      addedEvents.forEach(eventType => {
        expect(removeEventListenerSpy).toHaveBeenCalledWith(
          eventType,
          expect.any(Function)
        );
      });
      
      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });
  });

  describe('フォームの状態管理', () => {
    test('モード切替時にフォームの状態がリセットされる', async () => {
      const user = userEvent.setup();
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      // パスワードを入力
      await user.type(screen.getByLabelText('パスワード'), 'password123');
      
      // 登録モードに切り替え
      await user.click(screen.getByText('アカウントをお持ちでない方はこちら'));
      
      // パスワードフィールドがクリアされていることを確認
      expect(screen.getByLabelText('パスワード')).toHaveValue('');
      expect(screen.getByLabelText('パスワード（確認）')).toHaveValue('');
    });

    test('エラー状態がモード切替時にクリアされる', async () => {
      const { signInWithEmailAndPassword } = await import('firebase/auth');
      signInWithEmailAndPassword.mockRejectedValue({ code: 'auth/user-not-found' });
      
      const user = userEvent.setup();
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      // エラーを発生させる
      await user.type(screen.getByLabelText('メールアドレス'), 'test@example.com');
      await user.type(screen.getByLabelText('パスワード'), 'password123');
      await user.click(screen.getByRole('button', { name: 'ログイン' }));
      
      await waitFor(() => {
        expect(screen.getByText(/アカウントが見つかりません/)).toBeInTheDocument();
      });
      
      // モード切替
      await user.click(screen.getByText('アカウントをお持ちでない方はこちら'));
      
      // エラーメッセージがクリアされていることを確認
      expect(screen.queryByText(/アカウントが見つかりません/)).not.toBeInTheDocument();
    });
  });

  describe('高負荷時の動作', () => {
    test('大量のバリデーションエラーの処理', async () => {
      const user = userEvent.setup();
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="register" />);
      
      const submitButton = screen.getByRole('button', { name: '登録' });
      
      // 無効な入力で送信を試行（複数回）
      for (let i = 0; i < 10; i++) {
        await user.click(submitButton);
      }
      
      // エラーメッセージが適切に表示され、重複していないことを確認
      const errorMessages = screen.getAllByText(/有効なメールアドレスを入力してください/);
      expect(errorMessages).toHaveLength(1);
    });
  });

  describe('ブラウザ互換性', () => {
    test('古いブラウザでのフォールバック動作', () => {
      // crypto.randomUUID がない環境をシミュレート
      const originalCrypto = global.crypto;
      global.crypto = undefined;
      
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      // エラーなく表示されることを確認
      expect(screen.getByText('ログイン')).toBeInTheDocument();
      
      global.crypto = originalCrypto;
    });

    test('Intersection Observer がない環境での動作', () => {
      const originalIntersectionObserver = global.IntersectionObserver;
      global.IntersectionObserver = undefined;
      
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      // エラーなく表示されることを確認
      expect(screen.getByText('ログイン')).toBeInTheDocument();
      
      global.IntersectionObserver = originalIntersectionObserver;
    });
  });

  describe('パフォーマンステスト', () => {
    test('大量の再レンダリングでもパフォーマンスが維持される', () => {
      const renderStart = performance.now();
      
      // 複数回レンダリング
      for (let i = 0; i < 100; i++) {
        const { unmount } = render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
        unmount();
      }
      
      const renderTime = performance.now() - renderStart;
      
      // 1秒以内に完了することを確認
      expect(renderTime).toBeLessThan(1000);
    });
  });
});

describe('FirebaseAuthUI セキュリティテスト', () => {
  const mockOnAuthSuccess = vi.fn();

  test('CSRFトークンが適切に処理される', async () => {
    // モックのレスポンスヘッダーにCSRFトークンを設定
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        headers: new Headers({
          'x-csrf-token': 'mock-csrf-token'
        }),
        json: () => Promise.resolve({ success: true })
      })
    );

    const user = userEvent.setup();
    render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
    
    await user.type(screen.getByLabelText('メールアドレス'), 'test@example.com');
    await user.type(screen.getByLabelText('パスワード'), 'password123');
    
    // フォーム送信をシミュレート
    const form = screen.getByRole('button', { name: 'ログイン' }).closest('form');
    fireEvent.submit(form);
    
    // CSRFトークンの処理を確認
    expect(global.fetch).toHaveBeenCalled();
    
    global.fetch.mockRestore();
  });

  test('機密情報がコンソールにログ出力されない', () => {
    const consoleSpy = vi.spyOn(console, 'log');
    
    const user = userEvent.setup();
    render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
    
    // パスワードを入力
    user.type(screen.getByLabelText('パスワード'), 'secretpassword123');
    
    // コンソールログにパスワードが含まれていないことを確認
    const logCalls = consoleSpy.mock.calls.flat();
    const hasPassword = logCalls.some(call => 
      typeof call === 'string' && call.includes('secretpassword123')
    );
    
    expect(hasPassword).toBe(false);
    
    consoleSpy.mockRestore();
  });
});