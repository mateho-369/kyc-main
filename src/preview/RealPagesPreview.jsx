import '@fontsource-variable/noto-sans-jp';
import '@fontsource-variable/outfit';
import React, { useState, useCallback, useEffect, useSyncExternalStore } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom';
import { FiInfo, FiRefreshCw, FiBell, FiDownload, FiShield, FiArrowRight } from 'react-icons/fi';
import { FixtureIdentityProvider } from './fixtures/AuthContext';
import { MOCK_MARKER, getFixtureState, subscribe, snapshot, resetFixtures, setPerspective, visiblePerformers, fixtureRequest } from './fixtures/store';
import { FixtureInbox } from './fixtures/NotificationInbox';
// These are the actual application components, not copies of their markup.
import Header from '../components/Header';
import Navigation from '../components/Navigation';
import DashboardPage from '../pages/DashboardPage';
import PerformersPage from '../pages/PerformersPage';
import PerformerDetailPage from '../pages/PerformerDetailPage';
import AddPerformerPage from '../pages/AddPerformerPage';
import AdminUsersPage from '../pages/AdminUsersPage';
import UserDetailPage from '../pages/UserDetailPage';
import AuditLogsPage from '../pages/AuditLogsPage';
import './fixtures/fixtures.css';

const perspectives = [['admin','Full admin'],['reviewer','Review-only admin'],['user','User · Aoi']];
const fixtureCases = {101:'Ready to approve',102:'Documents to verify',103:'Already approved',104:'Correction requested',105:'Final rejection',106:'Missing document'};
function downloadSample() {
  // A safe PNG for exercising the real upload form. No external file or person.
  const canvas=document.createElement('canvas');canvas.width=800;canvas.height=500;
  const c=canvas.getContext('2d');c.fillStyle='#f0f4f8';c.fillRect(0,0,800,500);c.fillStyle='#102a43';c.fillRect(0,0,800,100);c.fillStyle='#fbbf24';c.font='bold 30px sans-serif';c.fillText('DEMO DOCUMENT — NOT A REAL ID',70,65);c.fillStyle='#9fb3c8';c.beginPath();c.arc(230,230,70,0,2*Math.PI);c.fill();c.fillRect(150,310,160,70);c.fillStyle='#486581';c.font='24px sans-serif';c.fillText('Synthetic preview artwork',360,210);c.fillText('No identity information',360,255);c.fillStyle='#92400e';c.fillText('TEMPORARY UI FIXTURE',250,460);
  canvas.toBlob(blob=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='DEMO-document.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/png');
}
function CorrectionHelper() {
  const navigate=useNavigate(),location=useLocation();
  const [error,setError]=useState('');
  useSyncExternalStore(subscribe,snapshot,snapshot);
  const state=getFixtureState(),p=visiblePerformers().find(p=>location.pathname===`/performers/${p.id}`);
  if(state.perspective!=='user' || p?.kycMetadata?.reviewState!=='correction_required')return null;
  return <section className="fixture-correction card-premium p-5 mb-6"><p className="eyebrow">PREVIEW-ONLY USER WORKFLOW</p><h2 className="text-lg font-semibold">DEMO correction: replace the blurry sample photo</h2><p className="muted-copy my-3">Edit the application using the generated sample image, then try resubmission. A real owner-facing correction-message API and this user action still need production integration.</p><div className="flex flex-wrap gap-3"><Link className="workspace-button secondary" to={`/performers/${p.id}/edit`}>Edit sample documents</Link><button className="workspace-button primary" onClick={async()=>{try{await fixtureRequest('POST',`/performers/${p.id}/resubmit`,{});navigate('/performers');}catch(e){setError(e.message);}}}>Simulate resubmission</button></div>{error&&<p role="alert">{error}</p>}</section>;
}
function Workspace() {
  useSyncExternalStore(subscribe,snapshot,snapshot);
  const state=getFixtureState(),navigate=useNavigate(),location=useLocation();
  const [navOpen,setNavOpen]=useState(false);
  const closeNav=useCallback(()=>setNavOpen(false),[]);
  const full=state.perspective==='admin',reviewer=state.perspective==='reviewer';
  const label=perspectives.find(([key])=>key===state.perspective)[1];
  useEffect(()=>{document.title='Id Manager · Actual pages with DEMO data';},[]);
  const changePerspective=value=>{setPerspective(value);closeNav();navigate('/performers');};
  const gated = page => full ? page : <Navigate to="/performers" replace />;
  return <div className="fixture-preview" data-preview-source={MOCK_MARKER}>
    <a href="#main-content" className="skip-link">Skip to actual application</a>
    <section className="fixture-banner" aria-label="Temporary mock preview controls">
      <div className="fixture-banner-heading"><span className="fixture-demo-badge"><FiShield />MOCK DATA</span><div><strong>The real application pages, with temporary sample data.</strong><p>Nothing reaches a server, Firebase, Sharegram, or email. Refresh or reset to restore samples. Do not upload real identity documents.</p></div><button className="workspace-button secondary" onClick={()=>{resetFixtures();navigate('/performers');}}><FiRefreshCw />Reset samples</button></div>
      <div className="fixture-toolbar"><div className="role-switch" role="group" aria-label="Demo perspective">{perspectives.map(([key,name])=><button key={key} aria-pressed={state.perspective===key} onClick={()=>changePerspective(key)} className={state.perspective===key?'selected':''}>{name}</button>)}</div><label className="fixture-case-label">Open a sample<select aria-label="Open a sample application" value={visiblePerformers().some(p=>location.pathname===`/performers/${p.id}`)?location.pathname.split('/').pop():''} onChange={e=>{if(e.target.value)navigate(`/performers/${e.target.value}`);}}><option value="">Choose a review state…</option>{visiblePerformers().map(p=><option key={p.id} value={p.id}>DEMO-{p.id} · {fixtureCases[p.id] || 'New sample'}</option>)}</select></label><Link className="fixture-toolbar-link" to="/preview-notifications"><FiBell />Demo inbox</Link><button className="fixture-toolbar-link" onClick={downloadSample}><FiDownload />Sample upload image</button></div>
      {reviewer && <p className="fixture-reviewer-note"><FiInfo />Review-only is a simulated permission set, not a new backend role. User management, global audit, creation and editing are blocked in this mock adapter.</p>}
      {state.lastEventText && <p role="status" className="fixture-action-result">{state.lastEventText}</p>}
    </section>
    <Header navOpen={navOpen} onToggleNav={()=>setNavOpen(value=>!value)} roleLabel={`${label} · DEMO`} />
    <div className="flex flex-1 min-w-0"><Navigation mobileOpen={navOpen} onClose={closeNav} showAdministration={full} roleLabel={`${label} · DEMO`} /><main id="main-content" className="min-w-0 flex-1 bg-navy-50/50"><div className="w-full max-w-screen-2xl mx-auto px-4 py-6 sm:px-6 lg:p-8" key={`${state.perspective}-${state.generation}`}>
      <CorrectionHelper />
      <Routes>
        <Route path="/" element={<DashboardPage showAdministration={full} allowCreate={!reviewer} systemStatus={{api:'Mock adapter only',database:'Not connected',storage:'Generated artwork'}} />} />
        <Route path="/performers" element={<PerformersPage allowCreate={!reviewer} />} />
        <Route path="/performers/add" element={reviewer?<Navigate to="/performers" replace />:<AddPerformerPage />} />
        <Route path="/performers/:id" element={<PerformerDetailPage simulation allowRecordChanges={!reviewer} />} />
        <Route path="/performers/:id/edit" element={reviewer?<Navigate to="/performers" replace />:<AddPerformerPage />} />
        <Route path="/admin/users" element={gated(<AdminUsersPage />)} />
        <Route path="/admin/users/:id" element={gated(<UserDetailPage />)} />
        <Route path="/audit-logs" element={gated(<AuditLogsPage allowExport={false} />)} />
        <Route path="/preview-notifications" element={<section className="card-premium p-5 sm:p-8"><p className="eyebrow">TEMPORARY UI FIXTURES</p><h1 className="text-2xl font-semibold mb-6">Notifications · demo inbox</h1><FixtureInbox /></section>} />
        <Route path="/login" element={<section className="card-premium p-8"><h1 className="text-2xl mb-4">Demo session ended</h1><p className="muted-copy">No real login is available. Select a demo perspective above to continue reviewing the UI.</p><Link to="/performers" className="workspace-button primary mt-5">Return to samples <FiArrowRight /></Link></section>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <footer className="fixture-page-footer">Temporary mock data · production records and permissions are unchanged.</footer>
    </div></main></div>
    <div className="fixture-watermark" aria-hidden="true">MOCK DATA · LOCAL ONLY</div>
  </div>;
}
export default function RealPagesPreview() {
  return <BrowserRouter><FixtureIdentityProvider><Workspace /></FixtureIdentityProvider></BrowserRouter>;
}
