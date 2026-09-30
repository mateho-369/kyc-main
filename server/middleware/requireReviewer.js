'use strict';

// Integration credentials receive a synthetic admin role in hybrid-auth, but
// are not human reviewers. A review requires an auditable local DB principal.
module.exports = function requireReviewer(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Authentication required' });
  if (req.sharegramAuth || req.user.role !== 'admin' ||
      !Number.isSafeInteger(Number(req.user.id)) || Number(req.user.id) <= 0) {
    return res.status(403).json({ message: 'A local administrator account is required', code: 'REVIEWER_REQUIRED' });
  }
  return next();
};
