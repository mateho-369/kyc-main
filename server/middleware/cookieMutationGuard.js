'use strict';
const { AppError } = require('../utils/errors/AppError');
// Cookie fallback broadened formerly bearer-only routes. Do not let an ambient
// browser cookie authorize an unsafe cross-origin request. Explicit bearer auth
// does not use ambient cookies; its token is still verified by the caller.
module.exports = function cookieMutationGuard(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET')) return;
  const origin = req.get('origin');
  let parsed;
  try { parsed = new URL(origin); } catch (_) { throw new AppError('Cookie write requires a same-origin request', 403); }
  const production = process.env.NODE_ENV === 'production' || process.env.FORCE_HTTPS === 'true';
  if (parsed.origin !== origin || parsed.host !== req.get('host') ||
      !['http:', 'https:'].includes(parsed.protocol) || (production && parsed.protocol !== 'https:') ||
      req.get('sec-fetch-site') === 'cross-site') {
    throw new AppError('Cookie write requires a same-origin request', 403);
  }
};
