'use strict';
const { User } = require('../models');
// Query scope is part of the authenticated request signature. Explicit UID never
// falls through into the separate Sharegram account-ID namespace.
module.exports = async function externalOwnerScope(query = {}) {
  const uid = query.firebase_uid, account = query.user_id;
  const value = uid || account;
  if (typeof value !== 'string' || !value.trim() || value.length > 255) {
    throw Object.assign(new Error('OWNER_SCOPE_REQUIRED'), { status: 400 });
  }
  let owner = await User.findOne({ where: { firebaseUid: value }, attributes: ['id'] });
  if (!owner && !uid) owner = await User.findOne({ where: { sharegramUserId: value }, attributes: ['id'] });
  if (owner) return { userId: owner.id };
  return uid ? { userId: -1 } : { sharegramUserId: value };
};
