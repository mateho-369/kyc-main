/**
 * Sharegram SSO flow tests
 *
 * These tests mount the REAL route that the /sso page calls
 * (POST /api/auth/firebase-session -> server/routes/auth-firebase-standard.js)
 * together with the REAL authentication middleware
 * (server/middleware/firebaseAuth.js).
 *
 * Only the two external boundaries are faked:
 *  - firebase-admin  (Sharegram's production Firebase project)
 *  - sequelize models (MySQL)
 *
 * Everything in between is the shipped code path.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret';
// The server must be pointed at Sharegram's Firebase project, otherwise every
// Sharegram token fails verification with "Invalid token".
process.env.FIREBASE_PROJECT_ID = 'adroit-standard-496710-r5';
process.env.FIREBASE_CLIENT_EMAIL = 'firebase-adminsdk@adroit-standard-496710-r5.iam.gserviceaccount.com';
process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n';
delete process.env.DISABLE_FIREBASE;
delete process.env.DISABLE_DB;

const express = require('express');
const request = require('supertest');

// ---------------------------------------------------------------------------
// In-memory stand-ins for the Sequelize models
// ---------------------------------------------------------------------------
const mockDb = { users: [], firebaseUsers: [], nextUserId: 1 };

const mockMatches = (row, where = {}) =>
  Object.keys(where).every((key) => {
    const expected = where[key];
    // NULL never equals NULL in SQL, and neither should it here.
    if (expected === null || expected === undefined) return false;
    return row[key] === expected;
  });

/**
 * Users.profilePicture is VARCHAR(512) in MySQL strict mode. The mock enforces
 * that width so an oversized value fails here exactly as it would on a real
 * database — without this, the "sharegram avatar is an encrypted blob" bug was
 * invisible to the suite.
 */
const COLUMN_WIDTHS = { profilePicture: 512 };

const assertFitsColumns = (values) => {
  Object.entries(COLUMN_WIDTHS).forEach(([column, width]) => {
    const value = values[column];
    if (typeof value === 'string' && value.length > width) {
      const error = new Error(`Data too long for column '${column}' at row 1`);
      error.code = 'ER_DATA_TOO_LONG';
      error.sqlMessage = `Data too long for column '${column}' at row 1`;
      throw error;
    }
  });
};

class MockUser {
  constructor(values) {
    Object.assign(this, values);
  }

  async update(values) {
    assertFitsColumns(values);
    Object.assign(this, values, { updatedAt: new Date() });
    return this;
  }

  static async findOne({ where } = {}) {
    return mockDb.users.find((u) => mockMatches(u, where)) || null;
  }

  static async findByPk(id) {
    return mockDb.users.find((u) => u.id === id) || null;
  }

  static async create(values) {
    assertFitsColumns(values);
    const user = new MockUser({
      id: mockDb.nextUserId++,
      role: 'user',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...values
    });
    mockDb.users.push(user);
    return user;
  }
}

/**
 * Mirrors server/models/FirebaseUser.js — which has NO association to User,
 * no sequelize.transaction helper and no provider/lastLoginAt columns.
 * Anything the real model does not implement throws here on purpose, so the
 * middleware cannot silently depend on it again.
 */
class MockFirebaseUser {
  constructor(values) {
    Object.assign(this, values);
  }

  async update(values) {
    Object.assign(this, values, { updatedAt: new Date() });
    return this;
  }

  static async findOne(options = {}) {
    if (options.include) {
      throw new Error('FirebaseUser is not associated to User!');
    }
    return mockDb.firebaseUsers.find((f) => mockMatches(f, options.where)) || null;
  }

  static async findOrCreate({ where, defaults } = {}) {
    const existing = await MockFirebaseUser.findOne({ where });
    if (existing) return [existing, false];
    const row = new MockFirebaseUser({
      id: mockDb.firebaseUsers.length + 1,
      ...defaults,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    mockDb.firebaseUsers.push(row);
    return [row, true];
  }

  static async create(values) {
    const row = new MockFirebaseUser({ id: mockDb.firebaseUsers.length + 1, ...values });
    mockDb.firebaseUsers.push(row);
    return row;
  }

  static async update() {
    return [1];
  }

  static async destroy() {
    return 1;
  }
}

jest.mock('../../models', () => ({
  User: MockUser,
  FirebaseUser: MockFirebaseUser
}));

// ---------------------------------------------------------------------------
// Fake Sharegram production Firebase project
// ---------------------------------------------------------------------------
// Accounts that exist in Sharegram's Firebase project. The ID token Sharegram
// hands to /sso is signed by that project, so verification only succeeds for
// tokens issued for one of these uids.
const mockFirebaseAccounts = {
  'bTN7Cc1Hk06UwldQi6H5DFcEdIs7': {
    uid: 'bTN7Cc1Hk06UwldQi6H5DFcEdIs7',
    email: 'hana@gmail.com',
    email_verified: true,
    displayName: null,
    photoURL: null,
    firebase: { identities: { email: ['hana@gmail.com'] }, sign_in_provider: 'custom' }
  },
  'uid-makara-0001': {
    uid: 'uid-makara-0001',
    email: 'makara@gmail.com',
    email_verified: true,
    displayName: null,
    photoURL: null,
    firebase: { identities: { email: ['makara@gmail.com'] }, sign_in_provider: 'password' }
  },
  'uid-hana-claims-0003': {
    uid: 'uid-hana-claims-0003',
    email: 'hana-claims@gmail.com',
    email_verified: true,
    displayName: null,
    photoURL: null,
    // Sharegram can put the account profile straight into the custom token.
    account_name: 'Hana',
    account_id: 'Hana1',
    first_name: 'Jonthon',
    last_name: 'David',
    sharegram_user_id: '12046',
    firebase: { identities: { email: ['hana-claims@gmail.com'] }, sign_in_provider: 'custom' }
  },
  'uid-makara-0005': {
    uid: 'uid-makara-0005',
    email: 'makara@gmail.com',
    email_verified: true,
    displayName: null,
    photoURL: null,
    firebase: { identities: { email: ['makara@gmail.com'] }, sign_in_provider: 'custom' }
  },
  'uid-api-lookup-0004': {
    uid: 'uid-api-lookup-0004',
    email: 'hana@gmail.com',
    email_verified: true,
    displayName: null,
    photoURL: null,
    firebase: { identities: { email: ['hana@gmail.com'] }, sign_in_provider: 'password' }
  },
  'uid-dara-0002': {
    uid: 'uid-dara-0002',
    email: 'dara@gmail.com',
    email_verified: true,
    displayName: 'Dara',
    photoURL: null,
    firebase: { identities: { email: ['dara@gmail.com'] }, sign_in_provider: 'password' }
  }
};

// Tokens the browser holds: the Sharegram-issued Firebase ID token, and the
// stale local access token left over from a previous id-manager login.
const firebaseIdTokenFor = (uid) => `firebase-id-token-${uid}`;
const staleLocalAccessToken = 'stale-local-jwt-from-a-previous-login';

const mockVerifyIdToken = jest.fn(async (token) => {
  if (typeof token !== 'string' || !token.startsWith('firebase-id-token-')) {
    const error = new Error('Firebase ID token has invalid format');
    error.code = 'auth/argument-error';
    throw error;
  }
  const uid = token.replace('firebase-id-token-', '');
  const account = mockFirebaseAccounts[uid];
  if (!account) {
    const error = new Error('Firebase ID token has invalid signature');
    error.code = 'auth/argument-error';
    throw error;
  }
  return { ...account };
});

const mockGetUser = jest.fn(async (uid) => {
  const account = mockFirebaseAccounts[uid];
  if (!account) {
    const error = new Error('There is no user record corresponding to the provided identifier.');
    error.code = 'auth/user-not-found';
    throw error;
  }
  return { ...account };
});

jest.mock('axios', () => ({
  get: jest.fn()
}));

jest.mock('firebase-admin', () => ({
  apps: [],
  credential: { cert: jest.fn((value) => value) },
  // Mirror the real SDK: initializing registers a default app.
  initializeApp: jest.fn(function initApp() {
    const mod = require('firebase-admin');
    if (mod.apps.length === 0) mod.apps.push({ name: '[DEFAULT]' });
    return mod.apps[0];
  }),
  auth: () => ({
    verifyIdToken: mockVerifyIdToken,
    getUser: mockGetUser,
    setCustomUserClaims: jest.fn(async () => {}),
    revokeRefreshTokens: jest.fn(async () => {}),
    updateUser: jest.fn(async () => {}),
    deleteUser: jest.fn(async () => {})
  })
}));

// Redis is not part of the SSO contract; silence the optional client.
jest.mock('redis', () => ({
  createClient: () => ({
    on: jest.fn(),
    connect: jest.fn(async () => {}),
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
    expire: jest.fn(async () => 1),
    del: jest.fn(async () => 1),
    quit: jest.fn(async () => {})
  })
}));

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    connect: jest.fn(async () => {}),
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
    setex: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
    quit: jest.fn(async () => {}),
    status: 'ready'
  }));
});

// ---------------------------------------------------------------------------
// App under test
// ---------------------------------------------------------------------------
const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../../routes/auth-firebase-standard'));
  app.use((err, req, res, next) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
};

describe('Sharegram SSO -> POST /api/auth/firebase-session', () => {
  beforeEach(() => {
    mockDb.users = [];
    mockDb.firebaseUsers = [];
    mockDb.nextUserId = 1;
    mockVerifyIdToken.mockClear();
    mockGetUser.mockClear();
  });

  it('creates a real user from the Sharegram token sent the way the frontend sends it (body.idToken)', async () => {
    const res = await request(buildApp())
      .post('/api/auth/firebase-session')
      .send({ idToken: firebaseIdTokenFor('bTN7Cc1Hk06UwldQi6H5DFcEdIs7') });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.email).toBe('hana@gmail.com');
    expect(res.body.user.email).not.toBe('test@example.com');
    expect(res.body.user.name).toBe('hana');
    expect(res.body.token).toBeTruthy();

    // The user is persisted, keyed by the Sharegram Firebase uid.
    expect(mockDb.users).toHaveLength(1);
    expect(mockDb.users[0].email).toBe('hana@gmail.com');
    expect(mockDb.users[0].firebaseUid).toBe('bTN7Cc1Hk06UwldQi6H5DFcEdIs7');

    // The FirebaseUsers mirror row is written too (findOrCreate, no include:
    // FirebaseUser has no association to User, so `include` would throw).
    expect(mockDb.firebaseUsers).toHaveLength(1);
    expect(mockDb.firebaseUsers[0].firebaseUid).toBe('bTN7Cc1Hk06UwldQi6H5DFcEdIs7');
    expect(mockDb.firebaseUsers[0].userId).toBe(mockDb.users[0].id);
    expect(mockDb.firebaseUsers[0].providerId).toBe('custom');
  });

  it('never signs the Sharegram user in as the shared "Test User"', async () => {
    const res = await request(buildApp())
      .post('/api/auth/firebase-session')
      .send({ idToken: firebaseIdTokenFor('uid-makara-0001') });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('makara@gmail.com');
    expect(res.body.user.name).toBe('makara');
    expect(res.body.user.email).not.toBe('test@example.com');
  });

  it('ignores a stale local access token in the Authorization header during SSO', async () => {
    // The browser still has an old id-manager JWT in localStorage; the axios
    // interceptor attaches it to every request, including the SSO one.
    const res = await request(buildApp())
      .post('/api/auth/firebase-session')
      .set('Authorization', `Bearer ${staleLocalAccessToken}`)
      .send({ idToken: firebaseIdTokenFor('uid-makara-0001') });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('makara@gmail.com');
    expect(res.body.user.name).toBe('makara');
  });

  it('accepts the ID token in the Authorization header too', async () => {
    const res = await request(buildApp())
      .post('/api/auth/firebase-session')
      .set('Authorization', `Bearer ${firebaseIdTokenFor('uid-dara-0002')}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('dara@gmail.com');
    // Firebase profile displayName wins over the email local-part.
    expect(res.body.user.name).toBe('Dara');
  });

  it('returns the same account (not a duplicate row) when Sharegram SSO is repeated', async () => {
    const first = await request(buildApp())
      .post('/api/auth/firebase-session')
      .send({ idToken: firebaseIdTokenFor('uid-makara-0001') });

    const second = await request(buildApp())
      .post('/api/auth/firebase-session')
      .send({ idToken: firebaseIdTokenFor('uid-makara-0001') });

    expect(first.body.user.id).toBe(second.body.user.id);
    expect(mockDb.users).toHaveLength(1);
    expect(mockDb.firebaseUsers).toHaveLength(1);
    expect(second.body.user.lastLoginAt).toBeTruthy();
  });

  it('keeps two Sharegram accounts as two distinct users', async () => {
    const makara = await request(buildApp())
      .post('/api/auth/firebase-session')
      .send({ idToken: firebaseIdTokenFor('uid-makara-0001') });

    const dara = await request(buildApp())
      .post('/api/auth/firebase-session')
      .send({ idToken: firebaseIdTokenFor('uid-dara-0002') });

    expect(makara.body.user.email).toBe('makara@gmail.com');
    expect(dara.body.user.email).toBe('dara@gmail.com');
    expect(makara.body.user.id).not.toBe(dara.body.user.id);
    expect(mockDb.users.map((u) => u.email).sort()).toEqual(['dara@gmail.com', 'makara@gmail.com']);
  });

  it('rejects a token that Sharegram did not issue', async () => {
    const res = await request(buildApp())
      .post('/api/auth/firebase-session')
      .send({ idToken: 'not-a-sharegram-token' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockDb.users).toHaveLength(0);
  });

  it('uses the Sharegram account name carried in the custom token', async () => {
    const res = await request(buildApp())
      .post('/api/auth/firebase-session')
      .send({ idToken: firebaseIdTokenFor('uid-hana-claims-0003') });

    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Hana');
    expect(res.body.user.sharegramUserId).toBe('12046');
    expect(mockDb.users[0].name).toBe('Hana');
    expect(mockDb.users[0].sharegramUserId).toBe('12046');
  });

  it('fills the name from the Sharegram account API when it is configured', async () => {
    process.env.SHAREGRAM_ACCOUNT_API_URL = 'https://api.share-gram.com/api/v2';
    process.env.SHAREGRAM_API_KEY = 'sharegram-api-key-test-2025';

    const axios = require('axios');
    axios.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          id: 12046,
          first_name: 'Jonthon',
          last_name: 'David',
          account_name: 'Hana',
          account_id: 'Hana1',
          status: 1,
          email: 'hana@gmail.com',
          points: 3200
        }
      }
    });

    try {
      const res = await request(buildApp())
        .post('/api/auth/firebase-session')
        .send({ idToken: firebaseIdTokenFor('uid-api-lookup-0004') });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('hana@gmail.com');
      expect(res.body.user.name).toBe('Hana');
      expect(res.body.user.sharegramUserId).toBe('12046');
      expect(axios.get).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.SHAREGRAM_ACCOUNT_API_URL;
      delete process.env.SHAREGRAM_API_KEY;
    }
  });

  it('still logs the user in when the Sharegram account API is down', async () => {
    process.env.SHAREGRAM_ACCOUNT_API_URL = 'https://api.share-gram.com/api/v2';
    process.env.SHAREGRAM_API_KEY = 'sharegram-api-key-test-2025';

    const axios = require('axios');
    axios.get.mockRejectedValueOnce(new Error('connect ETIMEDOUT'));

    try {
      const res = await request(buildApp())
        .post('/api/auth/firebase-session')
        .send({ idToken: firebaseIdTokenFor('uid-api-lookup-0004') });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('hana@gmail.com');
      expect(res.body.user.name).toBe('hana');
    } finally {
      delete process.env.SHAREGRAM_ACCOUNT_API_URL;
      delete process.env.SHAREGRAM_API_KEY;
    }
  });

  it('stores the real Sharegram account even when avatar is an encrypted blob', async () => {
    // Sharegram's real payload (as sent in production) carries a long encrypted
    // string in `avatar`, not a URL. Writing that into Users.profilePicture
    // (VARCHAR(512)) used to abort user creation with "Data too long for column
    // 'profilePicture'" — i.e. the Sharegram user never reached the database.
    process.env.SHAREGRAM_ACCOUNT_API_URL = 'https://api.share-gram.com/api/v2';
    process.env.SHAREGRAM_API_KEY = 'sharegram-api-key-test-2025';

    const axios = require('axios');
    axios.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          id: 12046,
          first_name: 'Jonthon',
          last_name: 'David',
          account_name: 'Hana',
          account_id: 'Hana1',
          email: 'hana@gmail.com',
          avatar: `U2FsdGVkX1${'k'.repeat(3000)}`
        }
      }
    });

    try {
      const res = await request(buildApp())
        .post('/api/auth/firebase-session')
        .send({ idToken: firebaseIdTokenFor('uid-api-lookup-0004') });

      expect(res.status).toBe(200);
      const saved = mockDb.users.find((u) => u.email === 'hana@gmail.com');
      // the identity is still persisted in full ...
      expect(saved.name).toBe('Hana');
      expect(saved.sharegramUserId).toBe('12046');
      expect(saved.authProvider).toBe('firebase');
      // ... only the unusable picture is dropped (null, or left untouched)
      expect(saved.profilePicture ?? null).toBeNull();
    } finally {
      delete process.env.SHAREGRAM_ACCOUNT_API_URL;
      delete process.env.SHAREGRAM_API_KEY;
      axios.get.mockReset();
    }
  });

  it('keeps a real avatar URL when it fits the column', async () => {
    process.env.SHAREGRAM_ACCOUNT_API_URL = 'https://api.share-gram.com/api/v2';
    process.env.SHAREGRAM_API_KEY = 'sharegram-api-key-test-2025';

    const axios = require('axios');
    axios.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          id: 12047,
          account_name: 'Makara',
          email: 'makara@gmail.com',
          avatar: 'https://cdn.share-gram.com/u/makara/200.jpg'
        }
      }
    });

    try {
      const res = await request(buildApp())
        .post('/api/auth/firebase-session')
        .send({ idToken: firebaseIdTokenFor('uid-makara-0005') });

      expect(res.status).toBe(200);
      expect(mockDb.users.find((u) => u.email === 'makara@gmail.com').profilePicture).toBe(
        'https://cdn.share-gram.com/u/makara/200.jpg'
      );
    } finally {
      delete process.env.SHAREGRAM_ACCOUNT_API_URL;
      delete process.env.SHAREGRAM_API_KEY;
      axios.get.mockReset();
    }
  });

  it('keeps an existing picture when a later sign-in cannot fetch one', async () => {
    // Same account, two sign-ins. The first gets a usable avatar URL, the
    // second reaches a failing Sharegram API. The stored picture must survive
    // rather than being cleared by the failed enrichment.
    process.env.SHAREGRAM_ACCOUNT_API_URL = 'https://api.share-gram.com/api/v2';
    process.env.SHAREGRAM_API_KEY = 'sharegram-api-key-test-2025';

    const axios = require('axios');
    const avatarUrl = 'https://cdn.share-gram.com/u/makara/200.jpg';
    axios.get
      .mockResolvedValueOnce({
        data: { success: true, data: { id: 12047, account_name: 'Makara', email: 'makara@gmail.com', avatar: avatarUrl } }
      })
      .mockRejectedValueOnce(new Error('ETIMEDOUT'));

    try {
      const first = await request(buildApp())
        .post('/api/auth/firebase-session')
        .send({ idToken: firebaseIdTokenFor('uid-makara-0005') });
      expect(first.status).toBe(200);
      const saved = mockDb.users.find((u) => u.email === 'makara@gmail.com');
      expect(saved.profilePicture).toBe(avatarUrl);

      const second = await request(buildApp())
        .post('/api/auth/firebase-session')
        .send({ idToken: firebaseIdTokenFor('uid-makara-0005') });

      expect(second.status).toBe(200);
      // still one row, and the picture was not wiped
      expect(mockDb.users.filter((u) => u.email === 'makara@gmail.com')).toHaveLength(1);
      expect(saved.profilePicture).toBe(avatarUrl);
    } finally {
      delete process.env.SHAREGRAM_ACCOUNT_API_URL;
      delete process.env.SHAREGRAM_API_KEY;
      axios.get.mockReset();
    }
  });

  it('rejects a request with no token at all', async () => {
    const res = await request(buildApp()).post('/api/auth/firebase-session').send({});

    expect(res.status).toBe(401);
    expect(mockDb.users).toHaveLength(0);
  });
});
