'use strict';
// Uses the same environment-file precedence as the migration CLI.
require('../config/config');
const models = require('../models');
const { sequelize } = require('../config/db');
const delivery = require('../services/sharegram/decisionDelivery');
const { runOnce } = require('../services/sharegram/decisionOutbox');
let stopped = false;
process.on('SIGTERM', () => { stopped = true; });
process.on('SIGINT', () => { stopped = true; });
(async () => {
  delivery.config(); // Fail startup without consuming attempts if not configured.
  await sequelize.authenticate(); // Never sync/alter schema from a worker.
  while (!stopped) {
    try { await runOnce({ models, send: payload => delivery.send(payload) }); }
    catch (_) { console.error('Decision outbox cycle failed; lease will recover'); }
    if (!stopped) await new Promise(resolve => setTimeout(resolve, 1000));
  }
})().catch(error => {
  console.error(/^DECISION_[A-Z_]+$/.test(error.message) ? error.message : 'Decision worker startup failed');
  process.exitCode = 1;
}).finally(() => sequelize.close());
