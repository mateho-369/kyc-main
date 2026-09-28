'use strict';
// Opt-in integration runner. Does NOT load app .env/config/models or touch an
// existing application schema. Only its own freshly-created database is dropped.
const assert=require('node:assert/strict');
const crypto=require('crypto');
function settings(env) {
  if (env.NODE_ENV === 'production' || env.KYC_ISOLATED_DB_ACK !== 'disposable-local-server') throw new Error('ISOLATED_DB_ACK_REQUIRED');
  if (!['127.0.0.1','::1'].includes(env.KYC_TEST_DB_HOST)) throw new Error('LOOPBACK_TEST_DB_REQUIRED');
  const port=Number(env.KYC_TEST_DB_PORT);
  if (!Number.isInteger(port) || port<1 || port>65535 || !env.KYC_TEST_DB_USER) throw new Error('EXPLICIT_TEST_DB_CONFIG_REQUIRED');
  return {host:env.KYC_TEST_DB_HOST,port,username:env.KYC_TEST_DB_USER,password:env.KYC_TEST_DB_PASSWORD || '',dialect:'mysql',logging:false,dialectOptions:{connectTimeout:5000}};
}
async function run(env=process.env) {
  const config=settings(env); // Validate before requiring any database code.
  const {Sequelize,DataTypes:D}=require('sequelize');
  const migration=require('../migrations/20240101000016-unique-sharegram-owner');
  const database='kyc_isolated_security_'+crypto.randomBytes(12).toString('hex');
  const control=new Sequelize({...config,database:'mysql'});
  let db,created=false;
  const pass=name=>console.log(JSON.stringify({case:name,status:'passed'}));
  try {
    await control.authenticate();
    const [version]=await control.query('SELECT VERSION() AS version');
    console.log(JSON.stringify({engine:version[0].version,mode:'disposable SQL database; no Firebase or Sharegram'}));
    // No IF NOT EXISTS: never claim ownership of an existing database.
    await control.query(`CREATE DATABASE \`${database}\``);created=true;
    db=new Sequelize({...config,database});const q=db.getQueryInterface();
    async function users(rows=[]) {
      await q.createTable('Users',{id:{type:D.INTEGER,primaryKey:true,autoIncrement:true},firebaseUid:{type:D.STRING,unique:true},sharegramUserId:{type:D.STRING,allowNull:true}});
      if(rows.length)await q.bulkInsert('Users',rows);
    }
    async function snapshot(){const [rows]=await db.query('SELECT id, firebaseUid, sharegramUserId FROM Users ORDER BY id');return rows;}
    await users();await migration.up(q);await migration.up(q);assert.deepEqual(await snapshot(),[]);pass('migration16_empty_and_rerun');await q.dropTable('Users');
    await users([{id:1,firebaseUid:'isolated-a',sharegramUserId:'isolated-owner-a'},{id:2,firebaseUid:'isolated-b',sharegramUserId:'isolated-owner-b'},{id:3,firebaseUid:'isolated-c',sharegramUserId:null},{id:4,firebaseUid:'isolated-d',sharegramUserId:null}]);
    const before=await snapshot();await migration.up(q);assert.deepEqual(await snapshot(),before);await assert.rejects(q.bulkInsert('Users',[{id:5,firebaseUid:'isolated-e',sharegramUserId:'isolated-owner-a'}]),e=>e.name==='SequelizeUniqueConstraintError');assert.deepEqual(await snapshot(),before);pass('migration16_unique_bindings_and_multiple_nulls');await q.dropTable('Users');
    await users([{id:1,firebaseUid:'isolated-a',sharegramUserId:'duplicate-test-owner'},{id:2,firebaseUid:'isolated-b',sharegramUserId:'duplicate-test-owner'}]);
    const duplicates=await snapshot();await assert.rejects(migration.up(q),e=>e.name==='SequelizeUniqueConstraintError' || e.original?.code==='ER_DUP_ENTRY');assert.deepEqual(await snapshot(),duplicates);pass('migration16_duplicates_abort_without_data_changes');await q.dropTable('Users');
    await users();await q.addIndex('Users',['sharegramUserId'],{name:'users_sharegram_identity_unique',unique:false});await assert.rejects(migration.up(q),/DEFINITION_CONFLICT/);pass('migration16_wrong_existing_index_rejected');await q.dropTable('Users');
    await users();await migration.up(q);
    const race=await Promise.allSettled([1,2].map(id=>q.bulkInsert('Users',[{id,firebaseUid:`isolated-${id}`,sharegramUserId:'one-owner'}])));
    assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal((await snapshot()).length,1);pass('migration16_concurrent_duplicate_insert');
    // Use the real migration's column definitions and actual SQL transactions,
    // not the app registry (which could import a configured production DB).
    const definitions={};const capture=Object.create(q);
    capture.createTable=async(name,columns,...rest)=>{definitions[name]=columns;return q.createTable(name,columns,...rest);};
    await require('../migrations/20240101000015-create-review-decisions-outbox').up(capture,require('sequelize'));
    const DecisionOutbox=db.define('IsolatedOutbox',definitions.decision_outbox,{tableName:'decision_outbox'});
    const AuditLog=db.define('IsolatedOperationsAudit',{userId:{type:D.INTEGER,allowNull:false},action:D.STRING,resourceType:D.STRING,resourceId:D.INTEGER,details:D.JSON,ipAddress:D.STRING},{tableName:'isolated_operations_audit'});
    await AuditLog.sync(); // Test-owned new table ONLY. No application models/sync.
    const {runOnce}=require('../services/sharegram/decisionOutbox');
    const operations=require('../services/sharegram/outboxOperations');
    const models={DecisionOutbox,AuditLog};
    const eventId=crypto.randomUUID(),payload={schemaVersion:2,eventId,eventType:'performer.approved',performer:{id:1,status:'active',kycStatus:'verified'},owner:{firebaseUid:'isolated-uid'}};
    const row=await DecisionOutbox.create({id:eventId,performerId:1,eventType:payload.eventType,payload,status:'pending',attempts:0,nextAttemptAt:new Date(0)});
    const delivered=[];
    await runOnce({models,send:async p=>{delivered.push(p.eventId);return {delivered:false,error:'HTTP_503'};}});
    await row.reload();assert.equal(row.status,'pending');assert.equal(row.attempts,1);
    await runOnce({models,now:()=>new Date(Date.now()+60000),send:async p=>{delivered.push(p.eventId);return {delivered:true};}});
    await row.reload();assert.equal(row.status,'sent');assert.deepEqual(delivered,[eventId,eventId]);pass('outbox_transient_retry_same_id_real_sql');
    await row.update({status:'failed',attempts:8,leaseUntil:null,leaseToken:null});
    const originalPayload=JSON.stringify(typeof row.payload==='string'?JSON.parse(row.payload):row.payload);
    const actor={id:1,role:'admin'},args={models,actor,eventId,expectedAttempts:8,confirmation:'retry_same_event'};
    await operations.retry(args);await row.reload();assert.equal(row.status,'pending');assert.equal(JSON.stringify(typeof row.payload==='string'?JSON.parse(row.payload):row.payload),originalPayload);assert.equal(await AuditLog.count(),1);await assert.rejects(operations.retry(args),e=>e.status===409);pass('outbox_manual_retry_atomic_audit_no_payload_change');
    await row.update({status:'failed',attempts:8});
    const failingModels={DecisionOutbox,AuditLog:{create:(value,options)=>AuditLog.create({...value,userId:null},options)}};
    await assert.rejects(operations.retry({...args,models:failingModels}));await row.reload();assert.equal(row.status,'failed');assert.equal(row.attempts,8);pass('outbox_audit_failure_real_transaction_rollback');
    await row.update({status:'pending',attempts:0,nextAttemptAt:new Date(0),leaseUntil:null,leaseToken:null});
    let release,started;const start=new Promise(r=>{started=r;});const gate=new Promise(r=>{release=r;});
    const first=runOnce({models,send:async()=>{started();await gate;return {delivered:true};}});
    await start;assert.equal(await runOnce({models,send:async()=>{throw new Error('active lease was double-claimed');}}),false);
    // Simulate worker loss/time passing; a second worker obtains a new fence.
    await row.update({leaseUntil:new Date(0),nextAttemptAt:new Date(0)});
    await runOnce({models,send:async()=>({delivered:false,permanent:true,error:'HTTP_400'})});
    release();await first;await row.reload();assert.equal(row.status,'failed');assert.equal(row.lastError,'HTTP_400');assert.equal(row.attempts,2);pass('outbox_active_lease_expiry_and_stale_worker_fence_real_sql');
  } finally {
    if(db)await db.close();
    if(created)await control.query(`DROP DATABASE \`${database}\``);
    await control.close();
  }
}
module.exports={settings,run};
if(require.main===module)run().catch(error=>{console.error(/^ISOLATED_|^LOOPBACK_|^EXPLICIT_/.test(error.message)?error.message:'ISOLATED_DB_TEST_FAILED: '+(error.name || 'Error'));process.exitCode=1;});
