'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
process.env.NODE_ENV = 'production';
// Match CRA's environment-file precedence, without printing configuration values.
require('react-scripts/config/env');
for (const key of ['REACT_APP_UI_PREVIEW','REACT_APP_FIXTURE_BUNDLE','REACT_APP_USE_MOCK_API']) {
  if (process.env[key] === 'true') throw new Error(`Remove retired setting ${key} before building`);
}
for (const file of ['src/preview','src/services/mockApiService.js','scripts/build-fixture-bundle.cjs']) {
  if (fs.existsSync(path.join(root,file))) throw new Error('Runtime fixture code must not be shipped');
}
if (process.argv.includes('--artifact')) {
  const dir = path.resolve(root,process.env.BUILD_PATH || 'build');
  if (!fs.existsSync(path.join(dir,'index.html'))) throw new Error('Build artifact missing');
  if (fs.existsSync(path.join(dir,'preview-only.json'))) throw new Error('Refusing preview artifact');
  function scan(folder) {
    for (const entry of fs.readdirSync(folder,{withFileTypes:true})) {
      const file=path.join(folder,entry.name);
      if(entry.isDirectory())scan(file);
      else if (/\.(js|html|json)$/.test(file) && /KYC_TEMPORARY_FIXTURES_20260928|mock-csrf-token|mockApiService/.test(fs.readFileSync(file,'utf8'))) throw new Error('Runtime fixture marker found in artifact');
    }
  }
  scan(dir);
}
console.log('Real-application build guard passed (not a live integration or production-readiness check).');
