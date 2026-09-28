const mockGet=jest.fn();
jest.mock('firebase-admin',()=>({apps:[{}],auth:()=>({getUser:mockGet})}));
const check=require('../../services/firebaseSessionPolicy');
const user={firebaseUid:'uid'},claims={sso:true,provider:'firebase',iat:200,sessionStartedAt:100};
beforeEach(()=>{mockGet.mockReset();delete process.env.FIREBASE_AUTH_EMULATOR_HOST;delete process.env.DISABLE_FIREBASE;});
test('revocation uses original session authentication time, not rotated token iat',async()=>{
  mockGet.mockResolvedValue({tokensValidAfterTime:new Date(150000).toISOString()});await expect(check(user,claims)).rejects.toThrow('revoked');
});
test('disabled authoritative Firebase account cannot refresh',async()=>{
  mockGet.mockResolvedValue({disabled:true});await expect(check(user,claims)).rejects.toThrow('disabled');
});
test('SDK/network failure fails closed',async()=>{
  mockGet.mockRejectedValue(new Error('private configuration'));await expect(check(user,claims)).rejects.toThrow('verification unavailable');
});
test('rejects emulator configuration without contacting it',async()=>{
  process.env.FIREBASE_AUTH_EMULATOR_HOST='forbidden.invalid:9099';
  try {await expect(check(user,claims)).rejects.toThrow('unavailable');expect(mockGet).not.toHaveBeenCalled();}
  finally {delete process.env.FIREBASE_AUTH_EMULATOR_HOST;}
});
test('valid non-revoked account passes; local-only session does not call Firebase',async()=>{
  mockGet.mockResolvedValue({disabled:false,tokensValidAfterTime:new Date(50000).toISOString()});await check(user,claims);expect(mockGet).toHaveBeenCalledWith('uid');mockGet.mockClear();await check(user,{provider:'local'});expect(mockGet).not.toHaveBeenCalled();
});
