const migration=require('../../migrations/20240101000016-unique-sharegram-owner');
test('creates only a unique index on fresh/existing tables; no data mutation',async()=>{
  const q={showIndex:jest.fn(async()=>[]),addIndex:jest.fn(async()=>{}),bulkDelete:jest.fn(),bulkUpdate:jest.fn()};
  await migration.up(q);expect(q.addIndex).toHaveBeenCalledWith('Users',['sharegramUserId'],{unique:true,name:'users_sharegram_identity_unique'});expect(q.bulkDelete).not.toHaveBeenCalled();expect(q.bulkUpdate).not.toHaveBeenCalled();
});
test('re-run verifies an existing index instead of weakening it',async()=>{
  const q={showIndex:jest.fn(async()=>[{name:'users_sharegram_identity_unique',unique:true,fields:[{attribute:'sharegramUserId'}]}]),addIndex:jest.fn()};
  await migration.up(q);expect(q.addIndex).not.toHaveBeenCalled();
  q.showIndex.mockResolvedValueOnce([{name:'users_sharegram_identity_unique',unique:false,fields:[]}]);await expect(migration.up(q)).rejects.toThrow('CONFLICT');
});
test('duplicate existing identities fail rather than modifying records',async()=>{
  const q={showIndex:async()=>[],addIndex:async()=>{throw new Error('DUPLICATE_EXISTING_IDENTITY');}};
  await expect(migration.up(q)).rejects.toThrow('DUPLICATE_EXISTING_IDENTITY');await expect(migration.down()).rejects.toThrow();
});
