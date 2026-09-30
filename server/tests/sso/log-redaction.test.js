const {structuredLogger}=require('../../utils/logger/logger');
test('redacts mixed-case credentials and nested KYC data without mutating requests',()=>{
  const headers={'Authorization':'a','X-Firebase-Token':'b','X-Sharegram-API-Key':'c','Cookie':'d'};
  expect(Object.values(structuredLogger.sanitizeHeaders(headers))).toEqual(['[REDACTED]','[REDACTED]','[REDACTED]','[REDACTED]']);
  const body={apiKey:'a',nested:{idToken:'b',private_key:'c',documents:{idFront:'sensitive'},email:'private@example.invalid'},status:'pending'};
  const sanitized=structuredLogger.sanitizeBody(body);
  expect(sanitized).toMatchObject({apiKey:'[REDACTED]',nested:{idToken:'[REDACTED]',private_key:'[REDACTED]',documents:'[REDACTED]',email:'[REDACTED]'},status:'pending'});
  expect(body.nested.idToken).toBe('b');
});
