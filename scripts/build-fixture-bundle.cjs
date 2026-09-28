'use strict';
// Build-time substitution only. npm run build never loads this script.
const path = require('path');
const webpack = require('webpack');
if (process.env.REACT_APP_UI_PREVIEW !== 'true' || process.env.REACT_APP_FIXTURE_BUNDLE !== 'true') throw new Error('Explicit isolated fixture build required');
process.env.NODE_ENV = 'production';
process.env.BABEL_ENV = 'production';
const root = path.resolve(__dirname, '..');
const configPath = require.resolve('react-scripts/config/webpack.config');
const original = require(configPath);
const aliases = {
  'src/contexts/AuthContext': 'AuthContext.jsx',
  'src/services/SecureApiClient': 'client.js',
  'src/services/api': 'client.js',
  'src/services/auth': 'auth.js',
  'src/services/firebaseAnalytics': 'analytics.js',
  'src/utils/sharegramReturn': 'sharegramReturn.js',
  'src/components/NotificationInfoDialog': 'NotificationInbox.jsx'
};
require.cache[configPath].exports = env => {
  const config = original(env);
  config.plugins.push(new webpack.NormalModuleReplacementPlugin(/./, resource => {
    if (!resource.request.startsWith('.')) return;
    const candidate = path.relative(root, path.resolve(resource.context, resource.request)).replace(/\\/g,'/').replace(/\.(jsx?|tsx?)$/,'');
    if (aliases[candidate]) resource.request = path.join(root, 'src/preview/fixtures', aliases[candidate]);
  }));
  return config;
};
require('react-scripts/scripts/build');
