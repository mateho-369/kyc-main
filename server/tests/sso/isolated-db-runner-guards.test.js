const {settings}=require('../../scripts/verify-isolated-security-db');
const valid={NODE_ENV:'test',KYC_ISOLATED_DB_ACK:'disposable-local-server',KYC_TEST_DB_HOST:'127.0.0.1',KYC_TEST_DB_PORT:'3307',KYC_TEST_DB_USER:'isolated'};
test.each([{NODE_ENV:'production'},{KYC_ISOLATED_DB_ACK:''},{KYC_TEST_DB_HOST:'production.example'},{KYC_TEST_DB_PORT:''},{KYC_TEST_DB_USER:''}])('real DB runner rejects unsafe/missing config %j before connecting',change=>expect(()=>settings({...valid,...change})).toThrow());
test('explicit loopback-only settings do not fall back to application DB environment',()=>expect(settings({...valid,MYSQL_HOST:'production.example',MYSQL_DATABASE:'production'})).toMatchObject({host:'127.0.0.1',port:3307,logging:false}));
