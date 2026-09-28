'use strict';
// Historical migration name retained; no default accounts or email-based admin grants.
// Do not delete existing users on rollback. Provisioning requires explicit identity policy.
const disabled = async () => { throw new Error('ACCOUNT_SEEDING_REMOVED: use approved identity provisioning, not demo seeds'); };
module.exports = { up: disabled, down: disabled };
