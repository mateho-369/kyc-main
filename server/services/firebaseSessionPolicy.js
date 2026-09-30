'use strict';
const admin = require('firebase-admin');
const { AppError } = require('../utils/errors/AppError');
// Local access JWTs are short-lived. Firebase-origin refresh sessions must not
// outlive revocation/disablement in the authoritative shared Firebase project.
module.exports = async function assertFirebaseSession(user, claims) {
  if (!claims.sso || claims.provider !== 'firebase') return;
  if (!user.firebaseUid || process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.DISABLE_FIREBASE === 'true' || !admin.apps.length) {
    throw new AppError('Firebase session verification unavailable', 503);
  }
  let profile;
  try { profile = await admin.auth().getUser(user.firebaseUid); }
  catch (_) { throw new AppError('Firebase session verification unavailable', 503); }
  const started = claims.sessionStartedAt ?? claims.iat;
  const revokedAfter = profile.tokensValidAfterTime ? Date.parse(profile.tokensValidAfterTime) / 1000 : 0;
  if (profile.disabled || !Number.isFinite(started) || !Number.isFinite(revokedAfter) || started < revokedAfter) {
    throw new AppError('Firebase session revoked or disabled', 401);
  }
};
