// Actual operation service/routes, mocked DB/auth boundary. No delivery occurs.
const express=require('express'),request=require('supertest');
const mockState={rows:[],audits:[],failAudit:false};
const mockEvent='00000000-0000-4000-8000-000000000001';
function mockMakeRow(values){return {...values,update:async function(changes,opts){expect(opts.transaction.LOCK.UPDATE).toBe('UPDATE');Object.assign(this,changes);return this;}};}
jest.mock('../../models',()=>({
 DecisionOutbox:{sequelize:{transaction:async fn=>{const saved=mockState.rows.map(r=>({...r}));try{return await fn({LOCK:{UPDATE:'UPDATE'}});}catch(e){mockState.rows=saved;throw e;}}},
 findByPk:jest.fn(async id=>mockState.rows.find(r=>r.id===id)),
 findAndCountAll:jest.fn(async()=>({count:mockState.rows.length,rows:mockState.rows}))},
 AuditLog:{create:jest.fn(async value=>{if(mockState.failAudit)throw new Error('private database error');mockState.audits.push(value);})}
}));
jest.mock('../../middleware/auth',()=> (req,res,next)=>{const role=req.get('x-test-role');if(!role)return res.sendStatus(401);req.user={id:7,role};next();});
const ops=require('../../services/sharegram/outboxOperations');
const models=require('../../models');
const app=express();app.use(express.json());app.use('/outbox',require('../../routes/decision-outbox'));app.use('/invites',require('../../routes/admin-invitations'));
const actor={id:7,role:'admin'};
beforeEach(()=>{jest.clearAllMocks();mockState.audits=[];mockState.failAudit=false;mockState.rows=[mockMakeRow({id:mockEvent,performerId:1,eventType:'performer.approved',status:'failed',attempts:8,leaseUntil:null,leaseToken:'old',payload:{owner:{email:'private@example.invalid'},documents:'private-path'},lastError:'PRIVATE_TOKEN',createdAt:new Date()})];});
function retry(overrides={}){return ops.retry({models,actor,eventId:mockEvent,expectedAttempts:8,confirmation:'retry_same_event',...overrides});}
test('retry preserves event ID/payload and atomically audits history',async()=>{
 const original=JSON.stringify(mockState.rows[0].payload);const result=await retry();
 expect(result).toMatchObject({id:mockEvent,status:'pending',attempts:0});expect(result.payload).toBeUndefined();
 expect(JSON.stringify(mockState.rows[0].payload)).toBe(original);expect(mockState.rows[0].leaseToken).toBeNull();
 expect(mockState.audits[0]).toMatchObject({action:'outbox_retry',details:{eventId:mockEvent,previousStatus:'failed',newStatus:'pending',previousAttempts:8}});
 await expect(retry()).rejects.toMatchObject({status:409});
});
test.each(['sent','pending'])('does not replay %s work',async status=>{mockState.rows[0].status=status;await expect(retry()).rejects.toMatchObject({status:409});});
test('rejects active lease, stale attempt count, missing confirmation and non-admin',async()=>{
 mockState.rows[0].leaseUntil=new Date(Date.now()+60000);await expect(retry()).rejects.toMatchObject({status:409});mockState.rows[0].leaseUntil=null;
 await expect(retry({expectedAttempts:7})).rejects.toMatchObject({status:409});await expect(retry({confirmation:undefined})).rejects.toMatchObject({status:400});await expect(retry({actor:{id:2,role:'user'}})).rejects.toMatchObject({status:403});
});
test('audit failure rolls back replay',async()=>{mockState.failAudit=true;await expect(retry()).rejects.toThrow();expect(mockState.rows[0]).toMatchObject({status:'failed',attempts:8,leaseToken:'old'});});
test('list is bounded, audited and never exposes payload/lease token/PII/error text',async()=>{
 const r=await request(app).get('/outbox').set('x-test-role','admin');expect(r.status).toBe(200);expect(r.headers['cache-control']).toBe('no-store');expect(JSON.stringify(r.body)).not.toMatch(/private|PRIVATE_TOKEN|leaseToken|payload/);expect(r.body.data[0].lastError).toBe('DELIVERY_ERROR');expect(mockState.audits[0].action).toBe('read');
 expect((await request(app).get('/outbox?limit=1000').set('x-test-role','admin')).status).toBe(400);
});
test('routes enforce local admin; invite functionality remains explicitly blocked',async()=>{
 for(const methodPath of [['get','/outbox'],['post',`/outbox/${mockEvent}/retry`],['post','/invites']]){
 const [method,path]=methodPath;expect((await request(app)[method](path)).status).toBe(401);expect((await request(app)[method](path).set('x-test-role','user').send({role:'admin'})).status).toBe(403);
 }
 const r=await request(app).post('/invites').set('x-test-role','admin').send({role:'admin',email:'not-created@example.invalid'});expect(r.status).toBe(503);expect(r.body.code).toBe('ADMIN_INVITATION_CONTRACT_REQUIRED');expect(mockState.audits).toHaveLength(0);
});
