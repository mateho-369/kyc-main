const seeder=require('../../seeders/20240101000001-seed-accounts');
describe('removed sample-account seeder',()=>{
 const original=process.env.NODE_ENV;afterEach(()=>{process.env.NODE_ENV=original;});
 test.each(['development','test','production'])('cannot create demo accounts in %s',async env=>{process.env.NODE_ENV=env;await expect(seeder.up()).rejects.toThrow('ACCOUNT_SEEDING_REMOVED');});
 test('rollback cannot delete existing identities',async()=>{await expect(seeder.down()).rejects.toThrow('ACCOUNT_SEEDING_REMOVED');});
});
