'use strict';
// Read-only configuration preflight: no DB/SDK/network/account changes, no values logged.
require('../config/loadEnv');
function issues(env=process.env) {
 const errors=[];
 for(const key of ['MYSQL_HOST','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD','FIREBASE_PROJECT_ID','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY','JWT_SECRET','JWT_REFRESH_SECRET'])if(!env[key]?.trim())errors.push(`${key} is required`);
 for(const key of ['JWT_SECRET','JWT_REFRESH_SECRET'])if(env[key] && Buffer.byteLength(env[key])<32)errors.push(`${key} needs at least 32 bytes`);
 if(env.JWT_SECRET && env.JWT_SECRET===env.JWT_REFRESH_SECRET)errors.push('Use separate access and refresh secrets');
 for(const key of ['DISABLE_DB','DISABLE_FIREBASE'])if(env[key]==='true')errors.push(`${key} must be false for real testing`);
 if(env.FIREBASE_AUTH_EMULATOR_HOST)errors.push('Firebase Emulator is forbidden for this integration');
 if(env.NODE_ENV==='production') {
  if(!env.ALLOWED_ORIGINS || env.ALLOWED_ORIGINS.split(',').some(o=>!/^https:\/\/[^/]+$/.test(o.trim())))errors.push('Production requires explicit HTTPS ALLOWED_ORIGINS');
  if(!env.REDIS_HOST)errors.push('Production requires explicit Redis configuration');
 }
 return errors;
}
function assertProduction(env=process.env) {
 if(env.NODE_ENV !== 'production') return;
 const errors=issues(env);
 if(errors.length) throw new Error('PRODUCTION_CONFIG_INVALID: '+errors.join('; '));
}
module.exports={issues,assertProduction};
if(require.main===module){const errors=issues();if(errors.length){errors.forEach(e=>console.error(e));process.exitCode=1;}else console.log('Required configuration present. Connectivity, credentials, schema, claims and receiver still need live verification.');}
