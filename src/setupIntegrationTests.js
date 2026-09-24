// 統合テスト用のセットアップファイル
import { vi } from 'vitest';

// Firebase Admin SDK のモック（統合テスト用）
vi.mock('firebase-admin', () => ({
  initializeApp: vi.fn(),
  auth: vi.fn(() => ({
    verifyIdToken: vi.fn(),
    createCustomToken: vi.fn(),
    createUser: vi.fn(),
    getUserByEmail: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn()
  })),
  firestore: vi.fn(() => ({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        set: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
      })),
      add: vi.fn(),
      where: vi.fn().mockReturnThis(),
      get: vi.fn()
    }))
  }))
}));

// Firebase Client SDK のモック（統合テスト用）
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({
    currentUser: null,
    onAuthStateChanged: vi.fn(),
    signOut: vi.fn()
  })),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  GoogleAuthProvider: vi.fn(() => ({
    setCustomParameters: vi.fn()
  })),
  connectAuthEmulator: vi.fn(),
  getIdToken: vi.fn(() => Promise.resolve('mock-id-token'))
}));

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
  getApps: vi.fn(() => []),
  getApp: vi.fn(() => ({}))
}));

// テスト環境の設定
global.console.warn = vi.fn();
global.console.error = vi.fn();

// DOM APIs のモック
global.crypto = {
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).substr(2, 9)
};

global.fetch = vi.fn();

// localStorage のモック（使用禁止のため、エラーをスロー）
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn(() => {
      throw new Error('localStorage usage is forbidden for security reasons');
    }),
    setItem: vi.fn(() => {
      throw new Error('localStorage usage is forbidden for security reasons');
    }),
    removeItem: vi.fn(() => {
      throw new Error('localStorage usage is forbidden for security reasons');
    }),
    clear: vi.fn(() => {
      throw new Error('localStorage usage is forbidden for security reasons');
    })
  },
  writable: false
});

// sessionStorage のモック（制限付き使用）
Object.defineProperty(window, 'sessionStorage', {
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn()
  },
  writable: false
});

// location のモック
Object.defineProperty(window, 'location', {
  value: {
    protocol: 'https:',
    hostname: 'localhost',
    port: '3000',
    href: 'https://localhost:3000',
    origin: 'https://localhost:3000',
    reload: vi.fn()
  },
  writable: true
});

// navigator のモック
Object.defineProperty(navigator, 'onLine', {
  value: true,
  writable: true
});

// IntersectionObserver のモック
global.IntersectionObserver = vi.fn(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}));

// ResizeObserver のモック
global.ResizeObserver = vi.fn(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}));

// テスト実行前の初期化
beforeEach(() => {
  vi.clearAllMocks();
  
  // fetch のデフォルトモック
  global.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({
      'content-type': 'application/json'
    }),
    json: () => Promise.resolve({}),
    text: () => Promise.resolve('')
  });
});

// テスト実行後のクリーンアップ
afterEach(() => {
  vi.restoreAllMocks();
});

// 統合テスト用のヘルパー関数
export const createMockUser = (overrides = {}) => ({
  uid: 'test-uid',
  email: 'test@example.com',
  displayName: 'Test User',
  emailVerified: true,
  ...overrides
});

export const createMockAuthState = (overrides = {}) => ({
  user: createMockUser(),
  isAuthenticated: true,
  loading: false,
  error: null,
  ...overrides
});

export const mockApiResponse = (data, options = {}) => {
  const { status = 200, headers = {}, delay = 0 } = options;
  
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({
          'content-type': 'application/json',
          ...headers
        }),
        json: () => Promise.resolve(data),
        text: () => Promise.resolve(JSON.stringify(data))
      });
    }, delay);
  });
};

// テスト用の環境変数設定
process.env.REACT_APP_API_URL = 'http://localhost:3001';
process.env.REACT_APP_USE_FIREBASE_EMULATOR = 'true';
process.env.NODE_ENV = 'test';