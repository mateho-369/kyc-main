'use strict';
// Standalone static UI preview, never proxying to staging or a real backend.
const express = require('../server/node_modules/express');
const path = require('path');
const fs = require('fs');
const app = express();
const root = path.resolve(__dirname, '../build');
if (!fs.existsSync(path.join(root, 'preview-only.json'))) {
  throw new Error('Missing UI-preview build marker. Build with REACT_APP_UI_PREVIEW=true first.');
}
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'self'; worker-src 'none'");
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(['/api', '/auth', '/uploads'], (req, res) => res.status(503).json({
  code: 'UI_PREVIEW_ONLY', message: 'Backend is not connected. No operation was performed.'
}));
app.use(express.static(root));
app.get('*', (req, res) => res.sendFile(path.join(root, 'index.html')));
app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('UI preview on port ' + (process.env.PORT || 3000) + ' — all API operations blocked'));
