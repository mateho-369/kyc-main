const fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
test('local env setup generates private secrets without printing values or seeding accounts',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kyc-env-setup-'));
 try {
  fs.mkdirSync(path.join(root,'scripts'));fs.mkdirSync(path.join(root,'server'));
  fs.copyFileSync(path.resolve(__dirname,'../../../scripts/setup-env.js'),path.join(root,'scripts/setup-env.js'));
  fs.writeFileSync(path.join(root,'.env.example'),'REACT_APP_API_URL=/api\n');
  fs.writeFileSync(path.join(root,'server/.env.example'),'JWT_SECRET=\nJWT_REFRESH_SECRET=\nMYSQL_PASSWORD=\nLOCAL_MYSQL_ROOT_PASSWORD=\n');
  const run=()=>spawnSync(process.execPath,[path.join(root,'scripts/setup-env.js')],{encoding:'utf8'});
  const first=run();expect(first.status).toBe(0);
  const text=fs.readFileSync(path.join(root,'server/.env'),'utf8');
  for(const line of text.trim().split('\n')){
   const secret=line.slice(line.indexOf('=')+1);expect(secret.length).toBeGreaterThanOrEqual(32);
   if(first.stdout.includes(secret) || first.stdout.includes(secret.slice(0,10)))throw new Error('Secret material leaked from setup');
  }
  expect(first.stdout).not.toContain('npm run seed');expect(run().status).toBe(0);expect(fs.readFileSync(path.join(root,'server/.env'),'utf8')).toBe(text);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
