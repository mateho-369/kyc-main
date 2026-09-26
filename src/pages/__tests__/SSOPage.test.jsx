/**
 * /sso 画面の受け口テスト。
 *
 * 実際の障害: Sharegram から token が付かずに
 *   http://localhost:3300/sso?come_back=...&action=create
 * へ遷移し、画面は「Firebase ID Tokenが指定されていません」だけを出していた。
 * 何が起きても「どのパラメータが足りないか」が分かることを固定する。
 *
 * 実行: npx vitest run src/pages
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJ1aWQiOiJhYmMxMjMifQ.signature_part_123456';

const createFirebaseSession = vi.fn();
const setUser = vi.fn();
const setIsAuthenticated = vi.fn();
const navigate = vi.fn();

vi.mock('../../services/auth', () => ({
  createFirebaseSession: (...args) => createFirebaseSession(...args)
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: false,
    setUser,
    setIsAuthenticated
  })
}));

vi.mock('../../config/firebase', () => ({
  auth: { currentUser: null }
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate
  };
});

// eslint-disable-next-line import/first
import SSOPage from '../SSOPage';

const renderAt = (url) => {
  window.history.pushState({}, '', url);
  return render(
    <MemoryRouter initialEntries={[url]}>
      <SSOPage />
    </MemoryRouter>
  );
};

describe('SSOPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('explains that Sharegram did not send a token instead of failing silently', async () => {
    renderAt('/sso?come_back=http%253A%252F%252Flocalhost%253A3000%252Fposts%252Fnew&action=create');

    expect(await screen.findByText(/認証エラー/)).toBeInTheDocument();
    expect(await screen.findByText(/tokenパラメータ.*送られていません/)).toBeInTheDocument();
    expect(createFirebaseSession).not.toHaveBeenCalled();
  });

  it('reports a malformed token parameter (e.g. token=undefined)', async () => {
    renderAt('/sso?token=undefined&action=create');

    expect(await screen.findByText(/Firebase ID Tokenの形式ではありません/)).toBeInTheDocument();
    expect(createFirebaseSession).not.toHaveBeenCalled();
  });

  it('accepts the token from the URL hash as well as the query', async () => {
    createFirebaseSession.mockResolvedValue({
      user: { id: 1, email: 'hana@gmail.com' },
      token: 'kyc-access-token'
    });

    renderAt(`/sso?action=create#token=${JWT}`);

    await waitFor(() => expect(createFirebaseSession).toHaveBeenCalledWith(JWT));
    await waitFor(() => expect(localStorage.getItem('accessToken')).toBe('kyc-access-token'));
  });

  it('keeps the Sharegram return URL for the back button', async () => {
    renderAt('/sso?token=undefined&action=create&come_back=http%3A%2F%2Flocalhost%3A3000%2Fposts%2Fnew');

    await screen.findByText(/認証エラー/);
    expect(sessionStorage.getItem('sharegram_come_back_url')).toBe('http://localhost:3000/posts/new');
    expect(sessionStorage.getItem('sharegram_action')).toBe('create');
  });
});
