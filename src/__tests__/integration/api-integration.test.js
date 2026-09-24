import { expect, describe, test, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecureFirebaseAuthProvider } from '../../contexts/SecureFirebaseAuthContext';
import { useSecureApi } from '../../hooks/useSecureApi';
import SecureDashboard from '../../pages/SecureDashboard';

// APIクライアント統合テスト
describe('API統合テスト', () => {
  const mockUser = {
    uid: 'test-uid',
    email: 'test@example.com',
    displayName: 'Test User'
  };

  beforeEach(() => {
    // fetch のモック
    global.fetch = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const TestComponent = () => {
    const { data, loading, error } = useSecureApi('/api/test');
    
    if (loading) return <div data-testid="loading">Loading...</div>;
    if (error) return <div data-testid="error">{error}</div>;
    if (data) return <div data-testid="data">{JSON.stringify(data)}</div>;
    return <div data-testid="no-data">No data</div>;
  };

  const renderWithAuth = (component, authState = { user: mockUser, isAuthenticated: true }) => {
    return render(
      <SecureFirebaseAuthProvider value={authState}>
        {component}
      </SecureFirebaseAuthProvider>
    );
  };

  describe('SecureApiClient の動作確認', () => {
    test('成功レスポンスの処理', async () => {
      const mockData = { message: 'success', data: [1, 2, 3] };
      
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
          'x-csrf-token': 'test-csrf-token'
        }),
        json: () => Promise.resolve(mockData)
      });

      renderWithAuth(<TestComponent />);

      await waitFor(() => {
        expect(screen.getByTestId('data')).toBeInTheDocument();
      });

      expect(screen.getByTestId('data')).toHaveTextContent(JSON.stringify(mockData));
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({
          method: 'GET',
          credentials: 'include',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          })
        })
      );
    });

    test('エラーレスポンスの処理', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ error: 'リソースが見つかりません' })
      });

      renderWithAuth(<TestComponent />);

      await waitFor(() => {
        expect(screen.getByTestId('error')).toBeInTheDocument();
      });

      expect(screen.getByTestId('error')).toHaveTextContent('リソースが見つかりません');
    });

    test('ネットワークエラーの処理', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      renderWithAuth(<TestComponent />);

      await waitFor(() => {
        expect(screen.getByTestId('error')).toBeInTheDocument();
      });

      expect(screen.getByTestId('error')).toHaveTextContent('ネットワークエラー');
    });

    test('CSRFトークンの自動付与', async () => {
      // セッション初期化のモック
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
          json: () => Promise.resolve({ message: 'success' })
        });

      renderWithAuth(<TestComponent />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });

      // 2回目の呼び出しでCSRFトークンが付与されることを確認
      const secondCall = global.fetch.mock.calls[1];
      expect(secondCall[1].headers).toEqual(
        expect.objectContaining({
          'X-CSRF-Token': 'test-csrf-token'
        })
      );
    });
  });

  describe('認証状態との統合', () => {
    test('認証済みユーザーのAPIアクセス', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ userProfile: 'success' })
      });

      renderWithAuth(<TestComponent />, {
        user: mockUser,
        isAuthenticated: true
      });

      await waitFor(() => {
        expect(screen.getByTestId('data')).toBeInTheDocument();
      });
    });

    test('未認証ユーザーのAPIアクセス制限', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: '認証が必要です' })
      });

      renderWithAuth(<TestComponent />, {
        user: null,
        isAuthenticated: false
      });

      await waitFor(() => {
        expect(screen.getByTestId('error')).toBeInTheDocument();
      });

      expect(screen.getByTestId('error')).toHaveTextContent('認証が必要です');
    });
  });

  describe('SecureDashboard API統合', () => {
    test('ダッシュボードデータの取得', async () => {
      const mockProfile = {
        name: 'Test User',
        role: 'admin',
        createdAt: '2023-01-01T00:00:00Z'
      };

      const mockKycStatus = {
        status: 'verified',
        expiresAt: '2024-01-01T00:00:00Z'
      };

      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockProfile)
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockKycStatus)
        });

      renderWithAuth(<SecureDashboard />, {
        user: mockUser,
        isAuthenticated: true,
        getSecurityStatus: () => ({
          isHttps: true,
          isAuthenticated: true,
          sessionActive: true,
          remainingAttempts: 5
        })
      });

      await waitFor(() => {
        expect(screen.getByText('Test User')).toBeInTheDocument();
      });

      expect(screen.getByText('認証済み')).toBeInTheDocument();
      expect(screen.getByText('admin')).toBeInTheDocument();
    });

    test('API エラー時のエラー表示', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Server error'));

      renderWithAuth(<SecureDashboard />, {
        user: mockUser,
        isAuthenticated: true,
        getSecurityStatus: () => ({
          isHttps: true,
          isAuthenticated: true,
          sessionActive: true,
          remainingAttempts: 5
        })
      });

      await waitFor(() => {
        expect(screen.getByText(/エラー/)).toBeInTheDocument();
      });
    });
  });

  describe('リアルタイム機能のテスト', () => {
    test('セキュリティステータスの定期更新', async () => {
      vi.useFakeTimers();

      const mockGetSecurityStatus = vi.fn()
        .mockReturnValueOnce({
          isHttps: true,
          isAuthenticated: true,
          sessionActive: true,
          remainingAttempts: 5
        })
        .mockReturnValueOnce({
          isHttps: true,
          isAuthenticated: true,
          sessionActive: true,
          remainingAttempts: 4
        });

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({})
      });

      renderWithAuth(<SecureDashboard />, {
        user: mockUser,
        isAuthenticated: true,
        getSecurityStatus: mockGetSecurityStatus
      });

      // 最初の値確認
      await waitFor(() => {
        expect(screen.getByText('残り 5 回')).toBeInTheDocument();
      });

      // 5秒進める
      vi.advanceTimersByTime(5000);

      // 更新された値確認
      await waitFor(() => {
        expect(screen.getByText('残り 4 回')).toBeInTheDocument();
      });

      expect(mockGetSecurityStatus).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    test('セッション期限切れ時の自動リダイレクト', async () => {
      const mockNavigate = vi.fn();
      
      // react-router-dom のモック
      vi.mock('react-router-dom', () => ({
        useNavigate: () => mockNavigate,
        Navigate: ({ to }) => <div data-testid="redirect">{to}</div>
      }));

      renderWithAuth(<SecureDashboard />, {
        user: null,
        isAuthenticated: false,
        getSecurityStatus: () => ({
          isHttps: true,
          isAuthenticated: false,
          sessionActive: false,
          remainingAttempts: 5
        })
      });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/login');
      });

      vi.clearAllMocks();
    });
  });

  describe('パフォーマンステスト', () => {
    test('同時API呼び出しの処理', async () => {
      const responses = Array.from({ length: 10 }, (_, i) => ({
        ok: true,
        json: () => Promise.resolve({ id: i, data: `test-${i}` })
      }));

      global.fetch.mockImplementation(() => 
        Promise.resolve(responses[Math.floor(Math.random() * responses.length)])
      );

      const TestMultipleApi = () => {
        const api1 = useSecureApi('/api/test1');
        const api2 = useSecureApi('/api/test2');
        const api3 = useSecureApi('/api/test3');
        
        return (
          <div>
            <div data-testid="api1">{api1.loading ? 'loading' : 'loaded'}</div>
            <div data-testid="api2">{api2.loading ? 'loading' : 'loaded'}</div>
            <div data-testid="api3">{api3.loading ? 'loading' : 'loaded'}</div>
          </div>
        );
      };

      renderWithAuth(<TestMultipleApi />);

      await waitFor(() => {
        expect(screen.getByTestId('api1')).toHaveTextContent('loaded');
        expect(screen.getByTestId('api2')).toHaveTextContent('loaded');
        expect(screen.getByTestId('api3')).toHaveTextContent('loaded');
      });

      // 同時にAPIが呼び出されることを確認
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    test('大量データのレンダリング性能', async () => {
      const largeData = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        description: `Description for item ${i}`
      }));

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(largeData)
      });

      const renderStart = performance.now();

      const LargeDataComponent = () => {
        const { data } = useSecureApi('/api/large-data');
        
        return (
          <div data-testid="large-data">
            {data && data.map(item => (
              <div key={item.id}>{item.name}</div>
            ))}
          </div>
        );
      };

      renderWithAuth(<LargeDataComponent />);

      await waitFor(() => {
        expect(screen.getByTestId('large-data')).toBeInTheDocument();
      });

      const renderTime = performance.now() - renderStart;
      
      // レンダリング時間が1秒以内であることを確認
      expect(renderTime).toBeLessThan(1000);
    });
  });
});