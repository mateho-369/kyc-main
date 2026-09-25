/**
 * Fail-closed behaviour of the Sharegram SSO endpoint.
 *
 * The old middleware answered DISABLE_FIREBASE=true (and, in practice, any
 * broken Firebase config) by signing the caller in as a shared
 * test@example.com "Test User". These tests pin the new behaviour: a Sharegram
 * SSO request must never be able to log in as Test User.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key';

const express = require('express');
const request = require('supertest');

jest.mock('../../models', () => ({
  User: {
    findOne: jest.fn(async () => null),
    create: jest.fn(async (values) => ({ id: 99, ...values }))
  },
  FirebaseUser: {
    findOne: jest.fn(async () => null),
    create: jest.fn(async (values) => values),
    sequelize: { transaction: async () => ({ commit: async () => {}, rollback: async () => {} }) }
  }
}));

jest.mock('firebase-admin', () => ({
  apps: [],
  credential: { cert: jest.fn((value) => value) },
  initializeApp: jest.fn(),
  auth: () => ({
    verifyIdToken: jest.fn(async () => {
      throw new Error('must never be reached when Firebase is not configured');
    }),
    getUser: jest.fn()
  })
}));

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

const loadApp = () => {
  let router;
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require
    router = require('../../routes/auth-firebase-standard');
  });
  const app = express();
  app.use(express.json());
  app.use('/api/auth', router);
  return app;
};

const SHAREGRAM_TOKEN = 'firebase-id-token-uid-makara-0001';

describe('Sharegram SSO with a misconfigured server', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.resetModules();
  });

  it('refuses the login instead of falling back to Test User when Firebase is disabled', async () => {
    process.env.DISABLE_FIREBASE = 'true';
    delete process.env.FIREBASE_PROJECT_ID;

    const res = await request(loadApp())
      .post('/api/auth/firebase-session')
      .send({ idToken: SHAREGRAM_TOKEN });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('FIREBASE_NOT_CONFIGURED');
    expect(JSON.stringify(res.body)).not.toContain('test@example.com');
    expect(JSON.stringify(res.body)).not.toContain('Test User');
  });

  it('refuses the login when the Firebase service account is missing', async () => {
    delete process.env.DISABLE_FIREBASE;
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;

    const res = await request(loadApp())
      .post('/api/auth/firebase-session')
      .send({ idToken: SHAREGRAM_TOKEN });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('FIREBASE_NOT_CONFIGURED');
  });
});
