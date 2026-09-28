const seeder=require('../../seeders/20240101000002-promote-sso-admin');
describe('removed email-only admin provisioning',()=>{
 test('cannot create or promote a real account via a legacy seed',async()=>{await expect(seeder.up()).rejects.toThrow('ACCOUNT_SEEDING_REMOVED');});
 test('cannot demote/delete existing users via rollback',async()=>{await expect(seeder.down()).rejects.toThrow('ACCOUNT_SEEDING_REMOVED');});
});
