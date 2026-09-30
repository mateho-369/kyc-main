'use strict';
const { randomUUID } = require('crypto');
const REQUIRED_DOCUMENTS = ['agreementFile', 'idFront', 'selfie'];
const object = value => {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch (_) { value = null; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
};
const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const ready = p => REQUIRED_DOCUMENTS.every(type => object(p.documents)[type]?.verified === true);
const reviewable = p => p.status === 'pending' && ['not_started', 'in_progress'].includes(p.kycStatus);

async function decide({ models, performerId, actor, action, reason, reasonCode, ip, userAgent }) {
  const { Performer, PerformerDecision, DecisionOutbox, AuditLog, User } = models;
  if (!actor || actor.role !== 'admin' || !Number.isSafeInteger(Number(actor.id)) || Number(actor.id) <= 0) fail(403, 'REVIEWER_REQUIRED');
  if (!['approve', 'reject', 'request_correction'].includes(action)) fail(400, 'INVALID_ACTION');
  if (action !== 'approve' && (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 2000)) fail(400, 'REASON_REQUIRED_MAX_2000');
  if (reasonCode != null && (typeof reasonCode !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(reasonCode))) fail(400, 'INVALID_REASON_CODE');
  return Performer.sequelize.transaction(async transaction => {
    const performer = await Performer.findByPk(performerId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!performer) fail(404, 'PERFORMER_NOT_FOUND');
    const metadata = object(performer.kycMetadata);
    if (!reviewable(performer) || metadata.reviewState === 'correction_required') fail(409, 'INVALID_REVIEW_TRANSITION');
    if (action === 'approve' && !ready(performer)) fail(409, 'REQUIRED_DOCUMENTS_NOT_VERIFIED');
    const previousStatus = performer.status;
    const previousKycStatus = performer.kycStatus;
    const id = randomUUID();
    const now = new Date();
    let notification = null;
    if (action !== 'request_correction') {
      const owner = await User.findByPk(performer.userId, { transaction });
      if (!owner || (!owner.firebaseUid && !owner.sharegramUserId)) fail(409, 'EXTERNAL_OWNER_IDENTITY_REQUIRED');
      performer.status = action === 'approve' ? 'active' : 'rejected';
      performer.kycStatus = action === 'approve' ? 'verified' : 'rejected';
      performer.kycVerifiedAt = action === 'approve' ? now : null;
      performer.kycExpiresAt = null; // No invented validity duration: product policy not established.
      const eventType = action === 'approve' ? 'performer.approved' : 'performer.rejected';
      const payload = {
        schemaVersion: 2, eventId: id, eventType, occurredAt: now.toISOString(),
        performer: { id: performer.id, externalId: performer.external_id || null,
          status: performer.status, kycStatus: performer.kycStatus },
        owner: { firebaseUid: owner.firebaseUid || null, sharegramUserId: owner.sharegramUserId || null }
      };
      await DecisionOutbox.create({ id, performerId: performer.id, eventType, payload,
        status: 'pending', attempts: 0, nextAttemptAt: now }, { transaction });
      notification = { eventId: id, status: 'pending' };
    } else {
      performer.kycStatus = 'in_progress';
    }
    performer.kycMetadata = { ...metadata, reviewState: action === 'request_correction' ? 'correction_required' : 'decided', lastDecisionId: id };
    await performer.save({ transaction });
    await PerformerDecision.create({ id, performerId: performer.id, reviewerId: actor.id, action,
      reason: action === 'approve' ? null : reason.trim(), reasonCode: reasonCode || null,
      previousStatus, previousKycStatus, status: performer.status, kycStatus: performer.kycStatus,
      createdAt: now }, { transaction });
    await AuditLog.create({ userId: actor.id, action, resourceType: 'performer', resourceId: performer.id,
      details: { decisionId: id, previousStatus, previousKycStatus, newStatus: performer.status, newKycStatus: performer.kycStatus },
      ipAddress: ip, userAgent: userAgent || '' }, { transaction });
    return { performer, decisionId: id, notification };
  });
}
module.exports = { decide, object, ready, reviewable, fail, REQUIRED_DOCUMENTS };
