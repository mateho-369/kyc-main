'use strict';
const fs = require('fs');
const path = require('path');
// Never fill missing local settings from production, or production from local.
const name = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
const file = path.resolve(__dirname, '..', name);
const loadedEnvFiles = [];
if (fs.existsSync(file)) {
  require('dotenv').config({ path: file });
  loadedEnvFiles.push(name);
}
module.exports = { loadedEnvFiles };
