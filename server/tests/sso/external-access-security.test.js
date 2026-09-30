// Real routers, in-memory database/Redis/auth boundaries. No external systems.
const express=require('express'), request=require('supertest');
const {Op}=require('sequelize');
const mockRows=[{id:1,userId:11,external_id:'one',sharegramUserId:'sg-a',status:'active',kycStatus:'verified',documents:{idFront:{path:'/private/identity.jpg',verified:true}}},{id:2,userId:22,external_id:'two',sharegramUserId:'sg-b',status:'pending',kycStatus:'in_progress',documents:{}}];
function mockMatches(row,where){return Reflect.ownKeys(where).every(k=>k===Op.and?where[k].every(w=>mockMatches(row,w)):k===Op.or?where[k].some(w=>mockMatches(row,w)):row[k]==where[k]);}
jest.mock('../../models',()=>({
  User:{findOne:jest.fn(async({where})=>where.firebaseUid==='uid-a'?{id:11}:where.firebaseUid==='uid-b'?{id:22}:null),findByPk:jest.fn(async()=>({id:11,name:'Owner'})),findAndCountAll:jest.fn(async()=>({count:1,rows:[{toJSON:()=>({id:11,name:'Owner',Performers:[]})}]}))},
  Performer:{findOne:jest.fn(async({where,attributes})=>{const row=mockRows.find(r=>mockMatches(r,where));if(!row)return null;const result=Object.fromEntries(attributes.map(k=>[k,row[k]]));result.toJSON=()=>({...result,toJSON:undefined});return result;})},
  AuditLog:{create:jest.fn(async()=>({}))}
}));
jest.mock('../../middleware/sharegram-auth',()=>({sharegramAuth:(req,res,next)=>{req.sharegramAuth={userId:7,apiClient:req.get('x-api-client')||'sharegram'};next();}}));
jest.mock('../../middleware/auth',()=> (req,res,next)=>{const role=req.get('x-test-role');if(!role)return res.sendStatus(401);req.user={id:7,role};next();});
jest.mock('redis',()=>({createClient:()=>({on:jest.fn(),get:jest.fn((k,cb)=>cb(null,JSON.stringify({private:'wrong cached owner'}))),set:jest.fn(),del:jest.fn((k,cb)=>cb(null,1))})}));
const models=require('../../models');
const app=express();app.use(express.json());
app.use('/api/sharegram/performers',require('../../routes/sharegram-performers'));
app.use('/api/documents',require('../../routes/api/documents'));
app.use('/api/admin/users',require('../../routes/admin-users'));
beforeEach(()=>jest.clearAllMocks());
test.each(['/api/sharegram/performers/one','/api/documents/by-external-id/one'])('owner scope required before data/cache lookup: %s',async url=>{
  const r=await request(app).get(url);expect(r.status).toBe(400);expect(models.Performer.findOne).not.toHaveBeenCalled();
});
test.each(['/api/sharegram/performers/one','/api/documents/by-external-id/one'])('cross-owner and unresolved UID cannot read %s',async url=>{
  for(const scope of ['uid-b','missing','sg-a']){const r=await request(app).get(url+'?firebase_uid='+scope);expect(r.status).toBe(404);}
});
test.each(['/api/sharegram/performers/one','/api/documents/by-external-id/one'])('matching owner receives no paths: %s',async url=>{
  const r=await request(app).get(url+'?firebase_uid=uid-a');expect(r.status).toBe(200);expect(JSON.stringify(r.body)).not.toMatch(/private|wrong cached owner/);expect(models.AuditLog.create).toHaveBeenCalled();
});
test('client-selected admin label cannot access unverified external documents',async()=>{
  const r=await request(app).get('/api/documents/by-external-id/two?firebase_uid=uid-b').set('x-api-client','sharegram-admin');expect(r.status).toBe(403);
});
test('admin management requires authenticated DB admin; no create endpoint exists',async()=>{
  expect((await request(app).get('/api/admin/users')).status).toBe(401);
  expect((await request(app).get('/api/admin/users').set('x-test-role','user')).status).toBe(403);
  expect((await request(app).post('/api/admin/users').set('x-test-role','user').send({role:'admin'})).status).toBe(403);
  expect((await request(app).post('/api/admin/users').set('x-test-role','admin').send({role:'admin'})).status).toBe(404);
});
test('admin reads are audited, bounded and use explicit safe fields',async()=>{
  expect((await request(app).get('/api/admin/users?page=-1&limit=9999').set('x-test-role','admin')).status).toBe(200);
  expect(models.User.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({limit:100,offset:0,attributes:expect.not.arrayContaining(['password','firebaseUid'])}));
  expect(models.AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({resourceType:'user',action:'read',resourceId:0}));
  expect((await request(app).get('/api/admin/users/11').set('x-test-role','admin')).status).toBe(200);
  expect(models.AuditLog.create).toHaveBeenLastCalledWith(expect.objectContaining({resourceId:11}));
});
