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
  GoogleAuthProvider: vi.fn(() => ({}))
}));

// Firebase設定のモック
vi.mock('../../../config/firebase', () => ({
  auth: {}
}));

describe('FirebaseAuthUI Component', () => {
  const mockOnAuthSuccess = vi.fn();
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('レンダリングテスト', () => {
    test('ログインモードで正しくレンダリングされる', () => {
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      expect(screen.getByText('ログイン')).toBeInTheDocument();
      expect(screen.getByLabelText('メールアドレス')).toBeInTheDocument();
      expect(screen.getByLabelText('パスワード')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'ログイン' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Googleでログイン/ })).toBeInTheDocument();
    });

    test('新規登録モードで正しくレンダリングされる', () => {
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="register" />);
      
      expect(screen.getByText('新規登録')).toBeInTheDocument();
      expect(screen.getByLabelText('パスワード（確認）')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '登録' })).toBeInTheDocument();
    });

    test('パスワードリセットモードで正しくレンダリングされる', () => {
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="reset" />);
      
      expect(screen.getByText('パスワードリセット')).toBeInTheDocument();
      expect(screen.queryByLabelText('パスワード')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'リセットメールを送信' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Googleでログイン/ })).not.toBeInTheDocument();
    });
  });

  describe('フォームバリデーション', () => {
    test('無効なメールアドレスでエラーが表示される', async () => {
      const user = userEvent.setup();
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      const emailInput = screen.getByLabelText('メールアドレス');
      const submitButton = screen.getByRole('button', { name: 'ログイン' });
      
      await user.type(emailInput, 'invalid-email');
      await user.click(submitButton);
      
      expect(screen.getByText('有効なメールアドレスを入力してください。')).toBeInTheDocument();
    });

    test('短いパスワードでエラーが表示される', async () => {
      const user = userEvent.setup();
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      const emailInput = screen.getByLabelText('メールアドレス');
      const passwordInput = screen.getByLabelText('パスワード');
      const submitButton = screen.getByRole('button', { name: 'ログイン' });
      
      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, '12345');
      await user.click(submitButton);
      
      expect(screen.getByText('パスワードは6文字以上で入力してください。')).toBeInTheDocument();
    });

    test('パスワード確認が一致しない場合エラーが表示される', async () => {
      const user = userEvent.setup();
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="register" />);
      
      const emailInput = screen.getByLabelText('メールアドレス');
      const passwordInput = screen.getByLabelText('パスワード');
      const confirmPasswordInput = screen.getByLabelText('パスワード（確認）');
      const submitButton = screen.getByRole('button', { name: '登録' });
      
      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'password123');
      await user.type(confirmPasswordInput, 'password456');
      await user.click(submitButton);
      
      expect(screen.getByText('パスワードが一致しません。')).toBeInTheDocument();
    });
  });

  describe('認証処理', () => {
    test('ログイン成功時にonAuthSuccessが呼ばれる', async () => {
      const { signInWithEmailAndPassword } = await import('firebase/auth');
      const mockUser = { uid: '123', email: 'test@example.com', getIdToken: vi.fn(() => 'mock-token') };
      signInWithEmailAndPassword.mockResolvedValue({ user: mockUser });
      
      const user = userEvent.setup();
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      await user.type(screen.getByLabelText('メールアドレス'), 'test@example.com');
      await user.type(screen.getByLabelText('パスワード'), 'password123');
      await user.click(screen.getByRole('button', { name: 'ログイン' }));
      
      await waitFor(() => {
        expect(mockOnAuthSuccess).toHaveBeenCalledWith(mockUser, 'mock-token');
      });
      
      expect(screen.getByText('ログインに成功しました！')).toBeInTheDocument();
    });

    test('ログイン失敗時にエラーメッセージが表示される', async () => {
      const { signInWithEmailAndPassword } = await import('firebase/auth');
      signInWithEmailAndPassword.mockRejectedValue({ code: 'auth/user-not-found' });
      
      const user = userEvent.setup();
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      await user.type(screen.getByLabelText('メールアドレス'), 'test@example.com');
      await user.type(screen.getByLabelText('パスワード'), 'password123');
      await user.click(screen.getByRole('button', { name: 'ログイン' }));
      
      await waitFor(() => {
        expect(screen.getByText('アカウントが見つかりません。新規登録をお試しください。')).toBeInTheDocument();
      });
    });

    test('Googleログインが正しく動作する', async () => {
      const { signInWithPopup } = await import('firebase/auth');
      const mockUser = { uid: '123', email: 'test@example.com', getIdToken: vi.fn(() => 'mock-token') };
      signInWithPopup.mockResolvedValue({ user: mockUser });
      
      const user = userEvent.setup();
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      await user.click(screen.getByRole('button', { name: /Googleでログイン/ }));
      
      await waitFor(() => {
        expect(mockOnAuthSuccess).toHaveBeenCalledWith(mockUser, 'mock-token');
      });
      
      expect(screen.getByText('Googleアカウントでログインしました！')).toBeInTheDocument();
    });
  });

  describe('モード切替', () => {
    test('ログインから新規登録へ切り替えができる', async () => {
      const user = userEvent.setup();
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      await user.click(screen.getByText('アカウントをお持ちでない方はこちら'));
      
      expect(screen.getByText('新規登録')).toBeInTheDocument();
      expect(screen.getByLabelText('パスワード（確認）')).toBeInTheDocument();
    });

    test('ログインからパスワードリセットへ切り替えができる', async () => {
      const user = userEvent.setup();
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      await user.click(screen.getByText('パスワードをお忘れの方'));
      
      expect(screen.getByText('パスワードリセット')).toBeInTheDocument();
      expect(screen.queryByLabelText('パスワード')).not.toBeInTheDocument();
    });
  });

  describe('ローディング状態', () => {
    test('処理中はボタンが無効化される', async () => {
      const { signInWithEmailAndPassword } = await import('firebase/auth');
      signInWithEmailAndPassword.mockImplementation(() => new Promise(() => {})); // 永続的にpending
      
      const user = userEvent.setup();
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      await user.type(screen.getByLabelText('メールアドレス'), 'test@example.com');
      await user.type(screen.getByLabelText('パスワード'), 'password123');
      
      const submitButton = screen.getByRole('button', { name: 'ログイン' });
      await user.click(submitButton);
      
      expect(submitButton).toBeDisabled();
      expect(submitButton).toHaveTextContent('処理中...');
    });
  });

  describe('通知の自動非表示', () => {
    test('成功通知は3秒後に自動的に消える', async () => {
      vi.useFakeTimers();
      const { signInWithEmailAndPassword } = await import('firebase/auth');
      const mockUser = { uid: '123', email: 'test@example.com', getIdToken: vi.fn(() => 'mock-token') };
      signInWithEmailAndPassword.mockResolvedValue({ user: mockUser });
      
      const user = userEvent.setup({ delay: null });
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      await user.type(screen.getByLabelText('メールアドレス'), 'test@example.com');
      await user.type(screen.getByLabelText('パスワード'), 'password123');
      await user.click(screen.getByRole('button', { name: 'ログイン' }));
      
      await waitFor(() => {
        expect(screen.getByText('ログインに成功しました！')).toBeInTheDocument();
      });
      
      vi.advanceTimersByTime(3000);
      
      await waitFor(() => {
        expect(screen.queryByText('ログインに成功しました！')).not.toBeInTheDocument();
      });
      
      vi.useRealTimers();
    });

    test('エラー通知は手動で閉じるまで表示される', async () => {
      const { signInWithEmailAndPassword } = await import('firebase/auth');
      signInWithEmailAndPassword.mockRejectedValue({ code: 'auth/wrong-password' });
      
      const user = userEvent.setup();
      render(<FirebaseAuthUI onAuthSuccess={mockOnAuthSuccess} mode="login" />);
      
      await user.type(screen.getByLabelText('メールアドレス'), 'test@example.com');
      await user.type(screen.getByLabelText('パスワード'), 'wrongpassword');
      await user.click(screen.getByRole('button', { name: 'ログイン' }));
      
      await waitFor(() => {
        expect(screen.getByText('パスワードが間違っています。')).toBeInTheDocument();
      });
      
      // 閉じるボタンをクリック
      const closeButton = screen.getByRole('button', { name: '' }); // X ボタン
      await user.click(closeButton);
      
      expect(screen.queryByText('パスワードが間違っています。')).not.toBeInTheDocument();
    });
  });
});

describe('FirebaseAuthUI Accessibility', () => {
  test('フォームフィールドに適切なラベルが設定されている', () => {
    render(<FirebaseAuthUI mode="login" />);
    
    expect(screen.getByLabelText('メールアドレス')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('パスワード')).toHaveAttribute('type', 'password');
  });

  test('キーボードナビゲーションが機能する', async () => {
    render(<FirebaseAuthUI mode="login" />);
    
    const emailInput = screen.getByLabelText('メールアドレス');
    const passwordInput = screen.getByLabelText('パスワード');
    const submitButton = screen.getByRole('button', { name: 'ログイン' });
    
    // Tab キーでナビゲーション
    emailInput.focus();
    expect(document.activeElement).toBe(emailInput);
    
    fireEvent.keyDown(emailInput, { key: 'Tab' });
    expect(document.activeElement).toBe(passwordInput);
    
    fireEvent.keyDown(passwordInput, { key: 'Tab' });
    expect(document.activeElement).toBe(submitButton);
  });
});