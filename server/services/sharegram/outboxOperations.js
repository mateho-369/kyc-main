'use strict';
const { Op } = require('sequelize');
const { fail } = require('../performerReview');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODES = new Set(['TRANSPORT_ERROR','DELIVERY_ERROR','ATTEMPTS_EXHAUSTED','UNSAFE_DESTINATION_ADDRESS']);
function errorSummary(value) {
  if (value == null) return null;
  return ERROR_CODES.has(value) || /^HTTP_[1-5]\d{2}$/.test(value) ? value : 'DELIVERY_ERROR';
}
function authorize(actor) {
  if (!actor || actor.role !== 'admin' || !Number.isSafeInteger(Number(actor.id)) || Number(actor.id) <= 0 || actor.isActive === false || actor.isLocked) fail(403,'REVIEWER_REQUIRED');
}
const FIELDS = ['id','eventType','status','attempts','nextAttemptAt','leaseUntil','lastError','sentAt','createdAt','updatedAt'];
function summary(row) {
  const result = Object.fromEntries(FIELDS.map(key => [key,row[key]]));
  result.lastError = errorSummary(result.lastError);
  return result;
}
async function list({models, actor, status, limit = 25, offset = 0, ip}) {
  authorize(actor);
  if (status != null && !['pending','failed','sent'].includes(status)) fail(400,'INVALID_OUTBOX_STATUS');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) fail(400,'INVALID_PAGINATION');
  const statuses = status ? [status] : ['pending','failed'];
  const {count,rows} = await models.DecisionOutbox.findAndCountAll({where:{status:{[Op.in]:statuses}},attributes:FIELDS,order:[['createdAt','ASC'],['id','ASC']],limit,offset});
  await models.AuditLog.create({userId:actor.id,action:'read',resourceType:'decision_outbox',resourceId:0,details:{statuses,limit,offset},ipAddress:ip});
  return {data:rows.map(summary),total:count,limit,offset};
}
async function retry({models, actor, eventId, expectedAttempts, confirmation, ip, now = () => new Date()}) {
  authorize(actor);
  if (!UUID.test(eventId || '') || !Number.isInteger(expectedAttempts) || expectedAttempts < 0 || confirmation !== 'retry_same_event') fail(400,'INVALID_RETRY_REQUEST');
  const {DecisionOutbox,AuditLog} = models;
  return DecisionOutbox.sequelize.transaction(async transaction => {
    const row = await DecisionOutbox.findByPk(eventId,{transaction,lock:transaction.LOCK.UPDATE});
    if (!row) fail(404,'OUTBOX_EVENT_NOT_FOUND');
    const time=now();
    // Failed only: never resend sent/pending work, race an active lease, or apply
    // a stale operator command. Fencing token is cleared atomically with audit.
    if (row.status !== 'failed' || row.attempts !== expectedAttempts || (row.leaseUntil && new Date(row.leaseUntil) > time)) fail(409,'OUTBOX_RETRY_CONFLICT');
    const previousAttempts=row.attempts;
    await row.update({status:'pending',attempts:0,nextAttemptAt:time,leaseUntil:null,leaseToken:null,lastError:null,sentAt:null},{transaction});
    await AuditLog.create({userId:actor.id,action:'outbox_retry',resourceType:'decision_outbox',resourceId:row.performerId,
      details:{eventId,previousStatus:'failed',newStatus:'pending',previousAttempts,newAttempts:0},ipAddress:ip},{transaction});
    // Payload, event type and event ID are never accepted from the client or replaced.
    return summary(row);
  });
}
module.exports={list,retry,summary,errorSummary};
