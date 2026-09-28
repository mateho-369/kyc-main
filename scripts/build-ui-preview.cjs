'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const result = spawnSync(process.execPath, [path.join(__dirname, 'build-fixture-bundle.cjs')], {
  cwd: root, stdio: 'inherit', env: { ...process.env, BUILD_PATH: 'build', PUBLIC_URL: '/',
    REACT_APP_UI_PREVIEW: 'true', REACT_APP_FIXTURE_BUNDLE: 'true', REACT_APP_API_URL: '/api', REACT_APP_USE_MOCK_API: 'false',
    GENERATE_SOURCEMAP: 'false', INLINE_RUNTIME_CHUNK: 'false' }
});
if (result.status !== 0) process.exit(result.status || 1);
fs.writeFileSync(path.join(root, 'build/preview-only.json'), JSON.stringify({ uiPreviewOnly: true, temporaryFixtures: true }));

// Preview fonts are local assets: no Google Fonts request is needed.
const htmlPath = path.join(root, 'build/index.html');
fs.writeFileSync(htmlPath, fs.readFileSync(htmlPath, 'utf8').replace(/<link[^>]+(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>/g, ''));
