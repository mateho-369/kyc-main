// TEMPORARY, USER-AUTHORIZED UI FIXTURES. No DB, Firebase, network or persistence.
// Only the special preview webpack build aliases real service modules to here.
export const MOCK_MARKER = 'KYC_TEMPORARY_FIXTURES_20260928';
const clone = value => JSON.parse(JSON.stringify(value));
const time = '2026-09-28T08:00:00.000Z';
const docNames = { agreementFile: 'Consent agreement', idFront: 'ID front', idBack: 'ID back', selfie: 'Selfie', selfieWithId: 'Selfie with ID' };
const aliases = { agreement_file: 'agreementFile', id_front: 'idFront', id_back: 'idBack', selfie_with_id: 'selfieWithId' };
export const normalizeType = type => aliases[type] || type;
const sampleDoc = (type, verified = false) => ({ path: `mock-only/${type}.svg`, originalName: `DEMO-${type}.svg`, mimeType: 'image/svg+xml', verified, verifiedAt: verified ? time : null, uploadedAt: time, size: 1200 });
const allDocs = verified => Object.fromEntries(Object.keys(docNames).map(type => [type, sampleDoc(type, verified)]));
const user = (id, name, role = 'user') => ({ id, name, email: `demo-${id}@preview.invalid`, role, authProvider: 'jwt', emailVerified: true, isActive: true, createdAt: '2026-09-01T09:00:00.000Z', lastLoginAt: time });
function seed() {
  const users = [user(900,'Preview Admin · DEMO','admin'),user(901,'Preview Reviewer · DEMO','admin'),user(201,'Aoi Tanaka · DEMO'),user(202,'Ren Sato · DEMO'),user(203,'Kai Mori · DEMO'),user(204,'Mio Ito · DEMO')];
  const row = (id,userId,lastName,firstName,roman,status,kycStatus,docs,metadata = {}) => ({ id,userId,lastName,firstName: `${firstName} · DEMO`,lastNameRoman: roman,firstNameRoman: 'Sample',status,kycStatus,documents: docs,kycMetadata: metadata,external_id: `DEMO-${id}`,createdAt: '2026-09-24T10:00:00.000Z',updatedAt: time,kycVerifiedAt: kycStatus === 'verified' ? time : null });
  const performers = [
    row(101,201,'田中','葵','Tanaka','pending','in_progress',allDocs(true)),
    row(102,202,'佐藤','蓮','Sato','pending','in_progress',{...allDocs(false), agreementFile:sampleDoc('agreementFile',true)}),
    row(103,201,'山本','花','Yamamoto','active','verified',allDocs(true)),
    row(104,201,'鈴木','空','Suzuki','pending','in_progress',allDocs(false),{reviewState:'correction_required'}),
    row(105,203,'森','海','Mori','rejected','rejected',allDocs(false)),
    row(106,204,'伊藤','美緒','Ito','pending','not_started',{agreementFile:sampleDoc('agreementFile'),idFront:sampleDoc('idFront')})
  ];
  const logs = [
    {id:1,userId:900,user:users[0],action:'approve',resourceType:'performer',resourceId:103,createdAt:'2026-09-28T07:40:00.000Z',ipAddress:'DEMO',details:{mock:true,previousStatus:'pending',newStatus:'active'}},
    {id:2,userId:900,user:users[0],action:'request_correction',resourceType:'performer',resourceId:104,createdAt:'2026-09-28T07:20:00.000Z',ipAddress:'DEMO',details:{mock:true,reason:'DEMO: Replace the blurry sample image.'}},
    {id:3,userId:900,user:users[0],action:'reject',resourceType:'performer',resourceId:105,createdAt:'2026-09-27T16:00:00.000Z',ipAddress:'DEMO',details:{mock:true,reason:'DEMO: Sample identity could not be verified.'}},
    {id:4,userId:900,user:users[0],action:'verify',resourceType:'document',resourceId:101,createdAt:'2026-09-27T15:10:00.000Z',ipAddress:'DEMO',details:{mock:true,documentType:'idFront'}}
  ];
  return { perspective:'admin', generation:0, users, performers, logs, notifications:[
    {id:'demo-note-1',ownerId:201,performerId:104,state:'correction',read:false,createdAt:time},
    {id:'demo-note-2',ownerId:201,performerId:103,state:'approved',read:false,createdAt:time},
    {id:'demo-note-3',ownerId:203,performerId:105,state:'rejected',read:true,createdAt:time}
  ] };
}
let state = seed();
let revision = 0;
let eventSequence = 100;
const listeners = new Set();
export const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export const snapshot = () => revision;
export const getFixtureState = () => state;
function changed() { revision += 1; listeners.forEach(listener => listener()); }
export function resetFixtures() { const generation = state.generation + 1, perspective = state.perspective; state = seed(); state.perspective = perspective; state.generation = generation; changed(); }
export function setPerspective(value) { if (!['admin','reviewer','user'].includes(value)) throw new Error('Unknown demo perspective'); state.perspective = value; changed(); }
export const currentUser = () => clone(state.users.find(u => u.id === (state.perspective === 'admin' ? 900 : state.perspective === 'reviewer' ? 901 : 201)));
export const visiblePerformers = () => state.performers.filter(p => state.perspective !== 'user' || p.userId === 201);
export const visibleNotifications = () => state.notifications.filter(n => state.perspective !== 'user' || n.ownerId === 201);
export function markRead(id) { const item = visibleNotifications().find(n => n.id === id); if (item) { item.read = true; changed(); } }
function fail(status, message) { throw Object.assign(new Error(message), { response: { status, data: { message, code: message } } }); }
function findPerformer(id) { const p = state.performers.find(p => p.id === Number(id)); if (!p) fail(404,'DEMO_RECORD_NOT_FOUND'); if (state.perspective === 'user' && p.userId !== 201) fail(403,'DEMO_OWNER_REQUIRED'); return p; }
function reviewer() { if (state.perspective === 'user') fail(403,'DEMO_REVIEWER_REQUIRED'); }
function administrator() { if (state.perspective !== 'admin') fail(403,'DEMO_FULL_ADMIN_REQUIRED'); }
function reviewable(p) { if (p.status !== 'pending' || !['not_started','in_progress'].includes(p.kycStatus)) fail(409,'DEMO_FINAL_RECORD_IMMUTABLE'); }
function ready(p) { return ['agreementFile','idFront','selfie'].every(t => p.documents[t]?.verified === true); }
function log(action, p, details = {}) {
  state.lastEventText = `DEMO: ${action} on DEMO-${p.id}. Only this tab changed. No Sharegram or email message was sent.`;
  state.logs.unshift({ id: ++eventSequence, userId: currentUser().id, user: currentUser(), action, resourceType:'performer', resourceId:p.id, createdAt:new Date().toISOString(), ipAddress:'DEMO', details:{ mock:true, ...details } });
}
function metadata(p) { return Object.entries(docNames).map(([type,name]) => ({type,name,status: !p.documents[type] ? 'missing' : p.documents[type].verified ? 'verified' : p.documents[type].rejectedAt ? 'rejected' : 'pending',mimeType:'image/svg+xml',uploadedAt:time,fileSize:p.documents[type]?.size || null})); }
function syntheticImage(type) {
  const portrait = ['selfie','selfieWithId'].includes(type);
  const art = portrait ? '<circle cx="200" cy="119" r="47" fill="#9fb3c8"/><path d="M106 266c0-72 42-100 94-100s94 28 94 100" fill="#627d98"/>' : '<rect x="64" y="91" width="272" height="149" rx="16" fill="white" stroke="#bcccdc" stroke-width="2"/><circle cx="119" cy="142" r="23" fill="#d9e2ec"/><path d="M89 198c0-27 13-35 30-35s30 8 30 35" fill="#9fb3c8"/><path d="M178 126h121m-121 25h92m-92 26h113m-113 25h65" stroke="#d9e2ec" stroke-width="9" stroke-linecap="round"/>';
  return new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="330" viewBox="0 0 400 330"><rect width="400" height="330" fill="#f0f4f8"/><rect width="400" height="48" fill="#102a43"/><text x="200" y="30" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#fcd34d">DEMO DOCUMENT — NOT A REAL ID</text>${art}<rect y="276" width="400" height="54" fill="#fef3c7"/><text x="200" y="298" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#92400e">${docNames[type] || 'Sample document'}</text><text x="200" y="318" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#92400e">Synthetic artwork · no identity information</text></svg>`], { type:'image/svg+xml' });
}

export async function fixtureRequest(method, input, body) {
  const url = new URL(input, 'https://preview.invalid');
  if (url.origin !== 'https://preview.invalid') fail(403,'DEMO_EXTERNAL_REQUEST_BLOCKED');
  const path = url.pathname;
  const respond = data => ({ data: clone(data) });
  if (method === 'GET' && path === '/dashboard/stats') {
    const rows = visiblePerformers();
    return respond({totalPerformers:rows.length,pendingVerification:rows.filter(p=>p.status==='pending').length,recentlyUpdated:rows.length,expiringDocuments:0,recentActivity:[]});
  }
  if (method === 'GET' && path === '/performers') {
    let rows = visiblePerformers();
    if (url.searchParams.get('status')) rows = rows.filter(p => p.status === url.searchParams.get('status'));
    return respond({success:true,data:rows});
  }
  if (path.startsWith('/admin/users')) {
    administrator(); if (method !== 'GET') fail(501,'DEMO_ADMIN_INVITATION_NOT_IMPLEMENTED');
    if (path === '/admin/users') {
      const search = (url.searchParams.get('search') || '').toLowerCase();
      const rows = state.users.filter(u => `${u.name} ${u.email}`.toLowerCase().includes(search)).map(u=>({...u,performerCount:state.performers.filter(p=>p.userId===u.id).length}));
      const page = Math.max(1,Number(url.searchParams.get('page')) || 1), limit = Math.min(100,Math.max(1,Number(url.searchParams.get('limit')) || 20));
      return respond({success:true,data:rows.slice((page-1)*limit,page*limit),pagination:{page,limit,total:rows.length,totalPages:Math.ceil(rows.length/limit)}});
    }
    const target = state.users.find(u=>u.id===Number(path.split('/').pop()));
    if (!target) fail(404,'DEMO_USER_NOT_FOUND');
    return respond({success:true,data:{...target,Performers:state.performers.filter(p=>p.userId===target.id)}});
  }
  if (path.startsWith('/audit-logs')) {
    administrator(); if (path !== '/audit-logs' || method !== 'GET') fail(501,'DEMO_EXPORT_NOT_IMPLEMENTED');
    return respond(state.logs.filter(l => (!url.searchParams.get('action') || l.action===url.searchParams.get('action')) && (!url.searchParams.get('resourceType') || l.resourceType===url.searchParams.get('resourceType')) && (!url.searchParams.get('startDate') || l.createdAt >= url.searchParams.get('startDate')) && (!url.searchParams.get('endDate') || l.createdAt.slice(0,10) <= url.searchParams.get('endDate'))));
  }
  if (method === 'POST' && path === '/performers') {
    if (state.perspective === 'reviewer') fail(403,'DEMO_REVIEW_ONLY');
    const values = Object.fromEntries(body instanceof FormData ? body.entries() : Object.entries(body || {}));
    if (!['lastName','firstName','lastNameRoman','firstNameRoman','agreementFile','idFront','selfie'].every(k=>values[k])) fail(400,'DEMO_REQUIRED_FIELDS_MISSING');
    const id = Math.max(...state.performers.map(p=>p.id)) + 1;
    const p = {id,userId:state.perspective==='user'?201:900,lastName:String(values.lastName),firstName:`${values.firstName} · DEMO`,lastNameRoman:String(values.lastNameRoman),firstNameRoman:String(values.firstNameRoman),external_id:`DEMO-${id}`,status:'pending',kycStatus:'not_started',kycMetadata:{},documents:{},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    // Never retain user-selected file bytes. A synthetic placeholder replaces each input.
    for (const type of Object.keys(docNames)) if (values[type]) p.documents[type]=sampleDoc(type);
    state.performers.push(p); log('create',p); changed(); return respond({success:true,data:p});
  }
  const match = path.match(/^\/performers\/(\d+)(?:\/(.*))?$/);
  if (!match) fail(501,'DEMO_ENDPOINT_NOT_IMPLEMENTED');
  const p = findPerformer(match[1]), tail = match[2] || '';
  if (method === 'GET' && !tail) return respond({success:true,data:{performer:p}});
  if (method === 'GET' && tail === 'documents') return respond({success:true,data:{documents:Object.entries(p.documents).map(([type,doc])=>({type,...doc,uploaded_at:doc.uploadedAt,status:doc.verified?'verified':doc.rejectedAt?'rejected':'pending'}))}});
  if (method === 'GET' && tail === 'documents/metadata') return respond({success:true,data:{documents:metadata(p)}});
  if (method === 'GET' && tail.startsWith('documents/')) {
    const type=normalizeType(tail.split('/')[1]); if (!p.documents[type]) fail(404,'DEMO_DOCUMENT_NOT_FOUND');
    return {data:syntheticImage(type)};
  }
  if (method === 'PUT' && /^documents\/[^/]+\/(verify|reject)$/.test(tail)) {
    reviewer(); reviewable(p); if (p.kycMetadata.reviewState === 'correction_required') fail(409,'DEMO_RESUBMIT_FIRST');
    const [,typeInput,action] = tail.split('/'), type=normalizeType(typeInput), doc=p.documents[type];
    if (!doc) fail(404,'DEMO_DOCUMENT_NOT_FOUND');
    if (action==='reject' && !body?.reason?.trim()) fail(400,'DEMO_REASON_REQUIRED');
    doc.verified=action==='verify'; doc.verifiedAt=action==='verify'?new Date().toISOString():null; doc.rejectedAt=action==='reject'?new Date().toISOString():null;
    log(action,p,{documentType:type}); changed(); return respond({verified:doc.verified,allVerified:ready(p)});
  }
  if (method === 'POST' && ['approve','reject','request-correction'].includes(tail)) {
    reviewer(); reviewable(p); if (p.kycMetadata.reviewState==='correction_required') fail(409,'DEMO_RESUBMIT_FIRST');
    if (tail==='approve' && !ready(p)) fail(409,'DEMO_DOCUMENTS_NOT_VERIFIED');
    if (tail!=='approve' && (typeof body?.reason !== 'string' || !body.reason.trim() || body.reason.length>2000)) fail(400,'DEMO_REASON_REQUIRED');
    const previousStatus=p.status, decisionId=`demo-decision-${++eventSequence}`;
    p.status=tail==='approve'?'active':tail==='reject'?'rejected':'pending';
    p.kycStatus=tail==='approve'?'verified':tail==='reject'?'rejected':'in_progress';
    p.kycMetadata={...p.kycMetadata,reviewState:tail==='request-correction'?'correction_required':'decided',lastDecisionId:decisionId};
    p.updatedAt=new Date().toISOString();
    log(tail.replace('-','_'),p,{previousStatus,newStatus:p.status,reason:body?.reason || null});
    state.notifications.unshift({id:decisionId,ownerId:p.userId,performerId:p.id,state:tail==='approve'?'approved':tail==='reject'?'rejected':'correction',read:false,createdAt:p.updatedAt});
    changed(); return respond({performer:p,decisionId,notification:tail==='request-correction'?null:{eventId:decisionId,status:'pending'},mock:true});
  }
  if (method === 'POST' && tail === 'resubmit') {
    if (state.perspective==='reviewer') fail(403,'DEMO_OWNER_REQUIRED');
    reviewable(p); if (p.kycMetadata.reviewState!=='correction_required') fail(409,'DEMO_INVALID_RESUBMISSION');
    if (!['agreementFile','idFront','selfie'].every(t=>p.documents[t])) fail(409,'DEMO_REQUIRED_DOCUMENTS_MISSING');
    p.kycMetadata.reviewState='submitted'; log('resubmit',p); changed(); return respond({performer:p,mock:true});
  }
  if (method === 'PUT' && !tail) {
    if (state.perspective==='reviewer') fail(403,'DEMO_REVIEW_ONLY'); reviewable(p);
    const values=Object.fromEntries(body instanceof FormData ? body.entries() : Object.entries(body || {}));
    let identityChanged=false;
    for (const field of ['lastName','firstName','lastNameRoman','firstNameRoman']) if (typeof values[field]==='string' && values[field].trim()) {identityChanged ||= p[field]!==values[field].trim();p[field]=values[field].trim();}
    for (const type of Object.keys(docNames)) {if(values[type])p.documents[type]=sampleDoc(type); else if(identityChanged && p.documents[type])p.documents[type].verified=false;}
    log('update',p);changed();return respond({success:true,data:{performer:p},mock:true});
  }
  if (method === 'DELETE' && !tail) {
    if (state.perspective==='reviewer') fail(403,'DEMO_REVIEW_ONLY');reviewable(p);
    log('delete',p);state.performers=state.performers.filter(row=>row.id!==p.id);changed();return respond({message:'Demo record removed from memory only',mock:true});
  }
  fail(501,'DEMO_ENDPOINT_NOT_IMPLEMENTED');
}
