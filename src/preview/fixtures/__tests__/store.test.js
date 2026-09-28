import { beforeEach, describe, it, expect } from 'vitest';
import { fixtureRequest as request, resetFixtures, setPerspective, visiblePerformers, visibleNotifications, getFixtureState } from '../store';
beforeEach(() => { setPerspective('admin'); resetFixtures(); });
describe('temporary in-memory preview isolation', () => {
  it('fails closed for unknown endpoints and external origins', async () => {
    await expect(request('GET','/unknown')).rejects.toThrow('DEMO_ENDPOINT_NOT_IMPLEMENTED');
    await expect(request('GET','https://example.com/performers')).rejects.toThrow('DEMO_EXTERNAL_REQUEST_BLOCKED');
  });
  it('scopes ordinary users to their own records and notes', async () => {
    setPerspective('user');
    expect(visiblePerformers().map(p=>p.id)).toEqual([101,103,104]);
    expect(visibleNotifications().every(n=>n.ownerId===201)).toBe(true);
    await expect(request('GET','/performers/102')).rejects.toThrow('DEMO_OWNER_REQUIRED');
    await expect(request('POST','/performers/101/approve')).rejects.toThrow('DEMO_REVIEWER_REQUIRED');
  });
  it('blocks reviewer management actions independently of navigation', async () => {
    setPerspective('reviewer');
    for (const path of ['/admin/users','/audit-logs']) await expect(request('GET',path)).rejects.toThrow('DEMO_FULL_ADMIN_REQUIRED');
    for (const [method,path] of [['POST','/performers'],['PUT','/performers/101'],['DELETE','/performers/101']]) await expect(request(method,path,{})).rejects.toThrow('DEMO_REVIEW_ONLY');
  });
  it('requires all three verified documents before approval', async () => {
    await expect(request('POST','/performers/102/approve')).rejects.toThrow('DEMO_DOCUMENTS_NOT_VERIFIED');
    for (const type of ['idFront','selfie']) await request('PUT',`/performers/102/documents/${type}/verify`);
    await request('POST','/performers/102/approve');
    expect(getFixtureState().performers.find(p=>p.id===102)).toMatchObject({status:'active',kycStatus:'verified'});
    expect(visibleNotifications()[0]).toMatchObject({performerId:102,state:'approved'});
    await expect(request('POST','/performers/102/reject',{reason:'sample'})).rejects.toThrow('DEMO_FINAL_RECORD_IMMUTABLE');
  });
  it('keeps correction distinct from final rejection and preserves audit history', async () => {
    await request('POST','/performers/101/request-correction',{reason:'Replace sample photo'});
    await expect(request('POST','/performers/101/approve')).rejects.toThrow('DEMO_RESUBMIT_FIRST');
    setPerspective('user'); await request('POST','/performers/101/resubmit');
    setPerspective('admin');
    await expect(request('POST','/performers/101/reject',{reason:' '})).rejects.toThrow('DEMO_REASON_REQUIRED');
    await request('POST','/performers/101/reject',{reason:'Sample final rejection'});
    expect(getFixtureState().logs.slice(0,3).map(l=>l.action)).toEqual(['reject','resubmit','request_correction']);
    expect(new Set(getFixtureState().logs.map(l=>l.id)).size).toBe(getFixtureState().logs.length);
  });
  it('resets changes without persistence and supplies generated document blobs', async () => {
    const response = await request('GET','/performers/101/documents/id_front');
    expect(response.data.type).toBe('image/svg+xml');
    await request('POST','/performers/101/approve'); resetFixtures();
    expect(getFixtureState().performers[0].status).toBe('pending');
    expect(getFixtureState().logs).toHaveLength(4);
  });
});
