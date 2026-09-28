const express=require('express'),request=require('supertest'),fs=require('fs'),path=require('path');
test.each(['emergency-api','api/v1/integration','sso-redirect-test'])('retired %s cannot fabricate success if remounted',async file=>{
 const app=express();app.use('/',require('../../routes/'+file));expect((await request(app).get('/health')).status).toBe(410);expect((await request(app).post('/anything')).status).toBe(410);
});
test('database startup cannot automatically sync or alter',()=>{expect(fs.readFileSync(path.join(__dirname,'../../config/db.js'),'utf8')).not.toMatch(/sequelize\.sync\s*\(/);});
test('database setup is migrations only and pinned migration CLI uses actual config',()=>{const pkg=require('../../package.json');expect(pkg.scripts['db:setup']).toBe('npm run migrate');expect(pkg.scripts.migrate).toContain('--config config/config.js');expect(pkg.devDependencies['sequelize-cli']).toBe('6.6.5');});
test('configuration preflight rejects disabled services, emulator and short secrets',()=>{
 const {issues}=require('../../scripts/check-local-config');
 const errors=issues({DISABLE_DB:'true',DISABLE_FIREBASE:'true',FIREBASE_AUTH_EMULATOR_HOST:'localhost:9099',JWT_SECRET:'short'});
 expect(errors).toContain('DISABLE_DB must be false for real testing');expect(errors).toContain('DISABLE_FIREBASE must be false for real testing');expect(errors).toContain('Firebase Emulator is forbidden for this integration');expect(errors).toContain('JWT_SECRET needs at least 32 bytes');
});
test('API/worker production preflight cannot accept missing config',()=>{
 const {assertProduction}=require('../../scripts/check-local-config');
 expect(()=>assertProduction({NODE_ENV:'production',DISABLE_DB:'true'})).toThrow('PRODUCTION_CONFIG_INVALID');
});
test.each(['development','production'])('environment loader does not borrow from another environment in %s',env=>{
 const original=process.env.NODE_ENV;process.env.NODE_ENV=env;
 jest.resetModules();jest.doMock('fs',()=>({existsSync:jest.fn(()=>true)}));jest.doMock('dotenv',()=>({config:jest.fn()}));
 try {
  const loaded=require('../../config/loadEnv');
  expect(loaded.loadedEnvFiles).toEqual([env==='production'?'.env.production':'.env']);
  expect(require('dotenv').config).toHaveBeenCalledTimes(1);
 } finally {process.env.NODE_ENV=original;jest.dontMock('fs');jest.dontMock('dotenv');jest.resetModules();}
});
