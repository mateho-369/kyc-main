'use strict';
const { Op } = require('sequelize');
const { randomUUID } = require('crypto');
const { object } = require('../performerReview');
const MAX_ATTEMPTS = 8;
const LEASE_MS = 60000;
async function runOnce({ models, send, now = () => new Date() }) {
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
  let result;
  try { result = await send(object(row.payload)); }
  catch (_) { result = { delivered: false, error: 'DELIVERY_ERROR' }; }
  const time = now();
  const failed = !result.delivered && (result.permanent || row.attempts >= MAX_ATTEMPTS);
  // Fencing prevents a slow/stale worker overwriting a subsequent claim.
  await DecisionOutbox.update({
    status: result.delivered ? 'sent' : failed ? 'failed' : 'pending',
    sentAt: result.delivered ? time : null,
    leaseToken: null, leaseUntil: null,
    nextAttemptAt: new Date(time.getTime() + Math.min(3600000, 1000 * 2 ** row.attempts)),
    lastError: result.delivered ? null : (/^[A-Z0-9_]{1,128}$/.test(result.error || '') ? result.error : 'DELIVERY_ERROR')
  }, { where: { id: row.id, leaseToken: row.leaseToken } });
  return true;
}
module.exports = { runOnce, MAX_ATTEMPTS, LEASE_MS };
