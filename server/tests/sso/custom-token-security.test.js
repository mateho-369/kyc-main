const express=require('express'),request=require('supertest');
const mockFirebase={verifyIdToken:jest.fn(async()=>({uid:'verified-uid',aud:'configured-project',email:'owner@example.invalid'})),getUser:jest.fn(async()=>({uid:'verified-uid',email:'owner@example.invalid',disabled:false})),createCustomToken:jest.fn(async()=> 'mock-custom-token'),logger:{info:jest.fn(),warn:jest.fn(),error:jest.fn()}};
jest.mock('../../config/firebase-admin',()=>mockFirebase);
const app=express();app.use(express.json());app.use('/api/auth',require('../../routes/auth-custom-token-simple'));
beforeEach(()=>{jest.clearAllMocks();process.env.FIREBASE_PROJECT_ID='configured-project';process.env.KYC_CUSTOM_TOKEN_API_KEYS='unit-only-key-00000000000000000000000';});
test('public/default test keys and missing config never authenticate',async()=>{
  expect((await request(app).post('/api/auth/custom-token').set('Authorization','Bearer sharegram-api-key-test-2025').send({idToken:'a.b.c'})).status).toBe(401);
  delete process.env.KYC_CUSTOM_TOKEN_API_KEYS;
  expect((await request(app).post('/api/auth/custom-token').set('Authorization','Bearer anything').send({idToken:'a.b.c'})).status).toBe(401);
  expect(mockFirebase.verifyIdToken).not.toHaveBeenCalled();
});
test('client metadata cannot mint role/ownership claims or expose API key',async()=>{
  const r=await request(app).post('/api/auth/custom-token').set('Authorization',`Bearer ${process.env.KYC_CUSTOM_TOKEN_API_KEYS}`).send({idToken:'a.b.c',metadata:{role:'admin',admin:true,sharegramUserId:'victim',kycPermissions:['admin']}});
  expect(r.status).toBe(200);expect(mockFirebase.verifyIdToken).toHaveBeenCalledWith('a.b.c',true);
  const claims=mockFirebase.createCustomToken.mock.calls[0][1];for(const key of ['role','admin','sharegramUserId','kycPermissions','apiKeyUsed'])expect(claims[key]).toBeUndefined();
  expect(JSON.stringify(mockFirebase.logger)).not.toContain(process.env.KYC_CUSTOM_TOKEN_API_KEYS);
});
test('test-token minting route is retired',async()=>{
  expect((await request(app).post('/api/auth/custom-token/test')).status).toBe(410);expect(mockFirebase.createCustomToken).not.toHaveBeenCalled();
});
