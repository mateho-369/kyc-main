import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { auth, db } from '../../config/firebase-fallback';
const root=process.cwd();
describe('real-data-only application',()=>{
 it('cannot select the removed mock adapter or fixture entry',()=>{
  for(const file of ['src/index.js','src/App.jsx','src/services/SecureApiClient.js']){
   expect(fs.readFileSync(path.join(root,file),'utf8')).not.toMatch(/mockApiInterceptor|REACT_APP_UI_PREVIEW|RealPagesPreview|DebugTools/);
  }
  expect(fs.existsSync(path.join(root,'src/services/mockApiService.js'))).toBe(false);
  expect(fs.existsSync(path.join(root,'src/preview'))).toBe(false);
 });
 it('missing Firebase never pretends reads/writes succeeded',async()=>{
  expect(auth.currentUser).toBe(null);
  await expect(auth.signInWithEmailAndPassword()).rejects.toThrow('not configured');
  for(const method of ['get','set','update','delete'])await expect(db.collection('test').doc('test')[method]()).rejects.toThrow('not configured');
 });
 it('local development never defaults to staging',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  expect(pkg.proxy).toBe('http://127.0.0.1:5000');expect(pkg.scripts['preview:build']).toBeUndefined();
 });
});
