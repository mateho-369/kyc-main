// Real CORS and retired-route handlers; legacy integrations are mocked to avoid network.
const express=require('express'),request=require('supertest');
jest.mock('../../middleware/firebaseSSO',()=>({authenticateSharegramSSO:(req,res,next)=>next()}));
jest.mock('../../middleware/auth',()=> (req,res)=>res.sendStatus(401));
jest.mock('../../models',()=>({User:{}}));
jest.mock('../../utils/logger/logger',()=>({logger:{error:jest.fn()}}));
jest.mock('../../utils/logger/auditLogger',()=>({auditLogger:{},auditLog:jest.fn()}));
const {secureCORS}=require('../../middleware/security');
const saved=process.env.NODE_ENV;
afterEach(()=>{process.env.NODE_ENV=saved;});
test.each(['null','http://stg.id-manager.com','https://untrusted.example'])('production CORS rejects %s',async origin=>{
  process.env.NODE_ENV='production';const app=express();app.use(secureCORS());app.get('/',(req,res)=>res.json({ok:true}));app.use((e,req,res,next)=>res.sendStatus(403));
  expect((await request(app).get('/').set('Origin',origin)).status).toBe(403);
});
test('production CORS accepts exact configured HTTPS site',async()=>{
  process.env.NODE_ENV='production';const app=express();app.use(secureCORS());app.get('/',(req,res)=>res.json({ok:true}));
  const r=await request(app).get('/').set('Origin','https://stg.id-manager.com');expect(r.status).toBe(200);expect(r.headers['access-control-allow-origin']).toBe('https://stg.id-manager.com');
});
test('legacy fabricated identity and numeric-UID token exchange are retired',async()=>{
  const app=express();app.use(express.json());app.use('/api/auth/sso',require('../../routes/auth-sso'));app.use('/api/v1/auth',require('../../routes/auth-sharegram-sso'));app.use('/api/sharegram',require('../../routes/sharegram'));
  const r=await request(app).post('/api/auth/sso').send({token:'anything-long-enough'});expect(r.status).toBe(410);expect(r.body.user).toBeUndefined();
  expect((await request(app).post('/api/sharegram/sso/prepare').send({token:'fake',apiKey:'fake'})).status).toBe(410);
  expect((await request(app).get('/api/sharegram/sso/consume?code=fake')).status).toBe(410);
  expect((await request(app).post('/api/v1/auth/sharegram-sso').send({userAccessToken:'untrusted'})).status).toBe(410);
});
