'use strict';
const { Op } = require('sequelize');
const { randomUUID } = require('crypto');
const { object } = require('../performerReview');
const { errorSummary } = require('./outboxOperations');
const MAX_ATTEMPTS = 8;
const LEASE_MS = 60000;
async function runOnce({ models, send, now = () => new Date(), onResult = () => {} }) {
  const { DecisionOutbox } = models;
  const row = await DecisionOutbox.sequelize.transaction(async transaction => {
    const time = now();
    const item = await DecisionOutbox.findOne({
      where: { status: 'pending', nextAttemptAt: { [Op.lte]: time },
        [Op.or]: [{ leaseUntil: null }, { leaseUntil: { [Op.lte]: time } }] },
      order: [['nextAttemptAt', 'ASC']], transaction, lock: transaction.LOCK.UPDATE
    });
    if (!item) return null;
    if (item.attempts >= MAX_ATTEMPTS) {
      await item.update({ status: 'failed', leaseUntil: null, leaseToken: null, lastError: 'ATTEMPTS_EXHAUSTED' }, { transaction });
      return null;
    }
    await item.update({ attempts: item.attempts + 1, leaseToken: randomUUID(),
      leaseUntil: new Date(time.getTime() + LEASE_MS) }, { transaction });
    return item;
  });
  if (!row) return false;
  const claimToken = row.leaseToken;
  const attempt = row.attempts;
  let result;
  try { result = await send(object(row.payload)); }
  catch (_) { result = { delivered: false, error: 'DELIVERY_ERROR' }; }
  if (!result || typeof result !== 'object') result = { delivered: false, error: 'DELIVERY_ERROR' };
  const time = now();
  const failed = !result.delivered && (result.permanent || attempt >= MAX_ATTEMPTS);
  // Fencing prevents a slow/stale worker overwriting a subsequent claim.
  const status = result.delivered ? 'sent' : failed ? 'failed' : 'pending';
  const lastError = result.delivered ? null : errorSummary(result.error || 'DELIVERY_ERROR');
  const [updated] = await DecisionOutbox.update({
    status,
    sentAt: result.delivered ? time : null,
    leaseToken: null, leaseUntil: null,
    nextAttemptAt: new Date(time.getTime() + Math.min(3600000, 1000 * 2 ** attempt)),
    lastError
  }, { where: { id: row.id, leaseToken: claimToken } });
  try { onResult({ eventId: row.id, status: updated ? status : 'lease_lost', error: updated ? lastError : 'STALE_LEASE' }); } catch (_) { /* Logging must not change delivery state. */ }
  return true;
}
module.exports = { runOnce, MAX_ATTEMPTS, LEASE_MS };
