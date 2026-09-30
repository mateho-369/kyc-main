'use strict';
// Retired synthetic-data endpoint. No authentication or persistence is simulated.
const router = require('express').Router();
router.use((req, res) => res.status(410).json({ code: 'SYNTHETIC_ENDPOINT_REMOVED' }));
module.exports = router;
