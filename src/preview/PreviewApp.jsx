import React, { useState, useRef, useCallback, useEffect } from 'react';
import { FiShield, FiGrid, FiUsers, FiFileText, FiBell, FiArrowUpRight, FiArrowRight, FiCheckCircle, FiClock, FiLock, FiMenu, FiX, FiMail, FiSend, FiInfo, FiChevronRight, FiSliders, FiCheck, FiMinus, FiBookOpen, FiSearch } from 'react-icons/fi';
import ReviewDecisionPanel from '../components/review/ReviewDecisionPanel';
import ReviewStatusNotice from '../components/review/ReviewStatus';
import useDialogFocus from '../hooks/useDialogFocus';

const roles = {
  admin: { name: 'Full admin', short: 'Administration', title: 'Your review workspace', description: 'Oversee verification, manage your team, and keep every decision accountable.', Icon: FiShield },
  reviewer: { name: 'Review-only admin', short: 'Verification team', title: 'Focus on the right decision', description: 'Review documents, approve applications, or explain what needs to change.', Icon: FiCheckCircle },
  user: { name: 'User', short: 'Personal workspace', title: 'Your verification, at a glance', description: 'Submit your documents, follow your review, and know exactly what to do next.', Icon: FiUsers }
};
const allNav = [
  { id: 'overview', title: 'Overview', Icon: FiGrid },
  { id: 'reviews', title: 'Review queue', Icon: FiFileText },
  { id: 'people', title: 'People & access', Icon: FiUsers },
  { id: 'audit', title: 'Audit trail', Icon: FiBookOpen },
  { id: 'notifications', title: 'Notifications', Icon: FiBell }
];
const capabilities = [
  ['View own applications', 'Available', 'Available', 'Available'],
  ['Review documents & decide', 'Available', 'Proposed', 'Not permitted'],
  ['View all users & audit logs', 'Available', 'Not permitted', 'Not permitted'],
  ['Invite admins & assign roles', 'Planned', 'Not permitted', 'Not permitted'],
  ['Resubmit requested corrections', 'Available', 'Not permitted', 'Own records only']
];

function EmptyState({ title = 'Your records will appear here', text, Icon = FiFileText, children }) {
  return <div className="workspace-empty"><div className="empty-symbol"><Icon aria-hidden="true" /><span><FiLock /></span></div><h3>{title}</h3><p>{text || 'The test backend is not connected. No records have been loaded or created.'}</p>{children}</div>;
}
function Notifications({ compact = false }) {
  const [template, setTemplate] = useState('approved');
  return <div className={compact ? '' : 'notification-layout'}>
    <section className="workspace-card notification-preview"><div className="section-heading"><div><p className="eyebrow">USER EXPERIENCE</p><h2>A clear next step, every time</h2></div><FiBell className="section-icon" /></div><p className="muted-copy">Explore proposed messages. These are templates, not a real notification feed.</p>
      <div className="template-tabs" role="group" aria-label="Notification message templates">{[['approved','Approved'],['correction','Correction needed'],['rejected','Rejected']].map(([id,label]) => <button type="button" key={id} aria-pressed={template === id} onClick={() => setTemplate(id)} className={template === id ? 'selected' : ''}>{label}</button>)}</div>
      <ReviewStatusNotice templateState={template} />
      <div className="template-footnote"><FiLock aria-hidden="true" /><span>Personal details stay in KYC. Email should link back to a secure, authenticated view.</span></div>
    </section>
    {!compact && <section className="workspace-card"><div className="section-heading"><div><p className="eyebrow">DELIVERY CHANNELS</p><h2>One decision. Separate deliveries.</h2></div></div>
      {[['Sharegram', 'Backend implemented', 'Approval and rejection enter the durable outbox. Receiver v2 support and actual delivery are not verified.', FiSend, 'gold'], ['In-app inbox', 'Planned', 'Persistent notifications, read/unread status, and owner-scoped deep links. Current UI displays record status only.', FiBell, 'neutral'], ['Email', 'Planned', 'A minimal transactional message to a verified recipient. No identity documents, sensitive reasons, or attachments.', FiMail, 'neutral']].map(([name,status,text,Icon,tone]) => <div className="channel-row" key={name}><div className="square-icon"><Icon /></div><div><div className="channel-title"><h3>{name}</h3><span className={`preview-chip ${tone}`}>{status}</span></div><p>{text}</p></div></div>)}
      <div className="subtle-note"><FiInfo /><span>A saved decision is not a delivery receipt. Each channel needs its own delivery and retry status.</span></div>
    </section>}
  </div>;
}

export default function PreviewApp() {
  const [role, setRole] = useState('admin');
  const [section, setSection] = useState('overview');
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [search, setSearch] = useState('');
  const drawerRef = useRef(null), dialogRef = useRef(null);
  useEffect(() => { document.documentElement.lang = 'en'; document.title = 'Id Manager · UI Preview'; }, []);
  const closeMenu = useCallback(() => setMenu(false), []);
  const closeDialog = useCallback(() => setDialog(null), []);
  useDialogFocus(drawerRef, menu, closeMenu);
  useDialogFocus(dialogRef, !!dialog, closeDialog);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => { if (media.matches) closeMenu(); };
    media.addEventListener('change', closeOnDesktop);
    return () => media.removeEventListener('change', closeOnDesktop);
  }, [closeMenu]);
  const openDialog = id => { setMenu(false); setDialog(id); };
  const current = roles[role];
  const navItems = allNav.filter(item => role === 'admin' || ['overview','reviews','notifications'].includes(item.id));
  const go = id => { setSection(id); setSearch(''); setMenu(false); window.scrollTo({ top: 0, behavior: 'auto' }); };
  const sidebar = <>
    <a className="workspace-brand" href="#main-content" onClick={closeMenu}><span className="brand-mark"><FiShield /></span><span>Id Manager<span className="brand-subtitle">IDENTITY & TRUST</span></span></a>
    <p className="sidebar-eyebrow">WORKSPACE</p>
    <nav aria-label="Workspace navigation">{navItems.map(({ id, title, Icon }) => <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => go(id)} className={section === id ? 'active' : ''}><Icon /><span>{id === 'reviews' && role === 'user' ? 'My applications' : title}</span>{section === id && <span className="active-dot" />}{id === 'notifications' && <span className="nav-planned">Plan</span>}</button>)}</nav>
    <div className="sidebar-guide"><div className="guide-icon"><FiShield /></div><h3>Built on trust.</h3><p>Clear permissions.<br />Accountable decisions.</p><button onClick={() => openDialog('permissions')}>Explore access levels <FiArrowUpRight /></button></div>
    <div className="sidebar-bottom"><span className="role-avatar"><current.Icon /></span><div><strong>{current.name}</strong><span>Preview perspective</span></div><FiLock /></div>
  </>;
  const reviewContent = <>
    <section className="workspace-card records-panel"><div className="section-heading"><div><p className="eyebrow">{role === 'user' ? 'YOUR RECORDS' : 'APPLICATIONS'}</p><h2>{role === 'user' ? 'My applications' : 'Review queue'}</h2></div><span className="preview-chip">Not connected</span></div>
      <label className="workspace-search"><FiSearch /><span className="sr-only">Search applications</span><input placeholder="Search by application ID" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <EmptyState title={search ? 'Search needs a connected backend' : 'Ready for your first review'} text={search ? 'No search was performed. Connect the test environment to search real records.' : 'Connect the test environment to see applications here. This preview does not contain demo performers.'} />
    </section>
    {role !== 'user' && <ReviewDecisionPanel preview />}
    {role === 'user' && <Notifications compact />}
  </>;
  return <div className="workspace-preview">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="workspace-sidebar desktop-sidebar">{sidebar}</aside>
    {menu && <div className="workspace-overlay" role="dialog" aria-modal="true" aria-label="Workspace menu" ref={drawerRef} tabIndex={-1}><button className="overlay-dismiss" tabIndex={-1} onClick={closeMenu} aria-label="Close menu backdrop" /><aside className="workspace-sidebar mobile-sidebar"><button className="mobile-close" onClick={closeMenu} aria-label="Close menu"><FiX /></button>{sidebar}</aside></div>}
    <div className="workspace-body">
      <header className="workspace-topbar"><div className="breadcrumb"><button className="icon-button menu-toggle" aria-label="Open menu" aria-expanded={menu} onClick={() => setMenu(true)}><FiMenu /></button><span>Workspace</span><FiChevronRight /><strong>{navItems.find(item => item.id === section)?.title}</strong></div><div className="topbar-actions"><span className="environment-label"><span />UI preview</span><button className="icon-button" aria-label="Notification information" onClick={() => openDialog('notifications')}><FiBell /></button><button className="topbar-avatar" aria-label="View access levels" onClick={() => openDialog('permissions')}><current.Icon /></button></div></header>
      <main id="main-content" className="workspace-main">
        <div className="preview-banner"><FiInfo aria-hidden="true" /><p><strong>Design preview.</strong> No live accounts, records, or deliveries. Switching views does not change permissions.</p><button onClick={() => openDialog('setup')}>What works here? <FiArrowUpRight /></button></div>
        <div className="workspace-heading"><div><p className="eyebrow">{current.short}</p><h1>{section === 'overview' ? current.title : section === 'reviews' ? role === 'user' ? 'My applications' : 'Review applications' : section === 'people' ? 'People & access' : section === 'audit' ? 'An accountable review process' : 'Keep everyone informed'}</h1><p>{section === 'overview' ? current.description : 'Designed for clear actions, appropriate access, and room to grow.'}</p></div><button className="workspace-button secondary" onClick={() => openDialog('permissions')}><FiSliders />Access guide</button></div>
        <section className="perspective-bar" aria-label="Preview perspective"><div><span className="eyebrow">PREVIEW AS</span><p>Explore each experience</p></div><div className="role-switch" role="group" aria-label="Preview role">{Object.entries(roles).map(([key, { name, Icon }]) => <button key={key} aria-pressed={role === key} onClick={() => { setRole(key); setSection('overview'); setSearch(''); }} className={role === key ? 'selected' : ''}><Icon /><span>{name}</span></button>)}</div></section>
        {role === 'reviewer' && <div className="role-warning"><FiLock /><p><strong>Proposed permission set.</strong> The backend currently has only admin and user roles. Review-only access must be enforced server-side before it can be assigned.</p></div>}
        {section === 'overview' && <>
          <div className="summary-grid">{(role === 'user' ? [['My applications','Your records only',FiFileText],['Review status','A separate final decision',FiCheckCircle],['Next steps','Clear correction requests',FiClock]] : [['Awaiting review','Applications ready for review',FiFileText],['Decisions recorded','Approved and rejected reviews',FiCheckCircle],['Sharegram delivery','Tracked separately from decisions',FiSend]]).map(([title,subtitle,Icon],i) => <button className="summary-card" key={title} onClick={() => go(i === 2 ? 'notifications' : 'reviews')}><div className="summary-top"><span className={`square-icon ${i === 0 ? 'gold' : ''}`}><Icon /></span><FiArrowUpRight /></div><h2>{title}</h2><div className="summary-value">— <span>Not connected</span></div><p>{subtitle}</p></button>)}</div>
          <div className="overview-grid"><section className="workspace-card overview-queue"><div className="section-heading"><div><p className="eyebrow">{role === 'user' ? 'YOUR APPLICATIONS' : 'REVIEW OPERATIONS'}</p><h2>{role === 'user' ? 'Every step, in one place' : 'A considered review, not a checkbox'}</h2></div><span className="preview-chip gold">Workflow</span></div><div className="workflow-steps">{[['01','Submit','Required documents'],['02','Verify','Check each document'],['03','Decide','Explicit final approval']].map(([n,title,text]) => <div key={n}><span>{n}</span><h3>{title}</h3><p>{text}</p></div>)}</div><EmptyState title="No live records loaded" text="This space will show real, permission-scoped applications once the test backend is connected."><button className="workspace-button secondary" onClick={() => go('reviews')}>{role === 'user' ? 'Explore application view' : 'Explore review controls'}<FiArrowRight /></button></EmptyState></section>
          <section className="access-card"><div className="access-card-icon"><current.Icon /></div><p className="eyebrow">YOUR PERSPECTIVE</p><h2>{current.name}</h2><p>{role === 'admin' ? 'A complete view of review operations, people, and accountability.' : role === 'reviewer' ? 'A focused workspace for document review and final decisions.' : 'A private view of your applications, progress, and next steps.'}</p><ul>{(role === 'admin' ? ['Review and decide applications','View users and audit history','Admin invitations · planned'] : role === 'reviewer' ? ['Verify submitted documents','Approve, reject, or ask for changes','No user or role management'] : ['Access your own records only','Upload requested documents','Resubmit after correction']).map(text => <li key={text}><FiCheck />{text}</li>)}</ul><button onClick={() => openDialog('permissions')}>Compare access levels<FiArrowUpRight /></button><div className="access-card-note"><FiLock />{role === 'reviewer' ? 'Design only · role enforcement pending' : 'Permissions are enforced by the API'}</div></section></div>
          <div className="overview-bottom"><Notifications compact /><section className="workspace-card growth-card"><span className="square-icon gold"><FiSend /></span><p className="eyebrow">DESIGNED TO GROW</p><h2>A decision is just the beginning.</h2><p>Sharegram, in-app updates, and email should work as separate, trackable channels—not a single promise of delivery.</p><button className="text-button" onClick={() => go('notifications')}>Explore notification plan<FiArrowRight /></button><div className="channel-pills"><span><FiSend />Sharegram</span><span><FiBell />In-app</span><span><FiMail />Email</span></div></section></div>
        </>}
        {section === 'reviews' && <div className="review-layout">{reviewContent}</div>}
        {section === 'notifications' && <Notifications />}
        {section === 'people' && <section className="workspace-card"><div className="section-heading"><div><p className="eyebrow">TEAM & ACCESS</p><h2>People in your workspace</h2></div><button className="workspace-button secondary" onClick={() => openDialog('invite')}>Admin invitations <span className="preview-chip">Planned</span></button></div><EmptyState Icon={FiUsers} title="User directory not connected" text="Full admins can list users through the existing API. Invitations and review-only roles are not implemented." /></section>}
        {section === 'audit' && <section className="workspace-card"><div className="section-heading"><div><p className="eyebrow">ACCOUNTABILITY</p><h2>Decision history & audit trail</h2></div><span className="preview-chip">Admin only</span></div><div className="audit-columns" aria-hidden="true"><span>Action</span><span>Reviewer</span><span>Record</span><span>Time</span></div><EmptyState Icon={FiBookOpen} title="No audit data loaded" text="The backend records decision history, reviewer identity, timestamps, and status changes. This preview does not invent audit events." /></section>}
        <footer className="workspace-footer"><span><FiShield />Id Manager · Identity & trust</span><span>UI preview / No production connection</span></footer>
      </main>
    </div>
    {dialog && <div className="workspace-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) closeDialog(); }}><section className="workspace-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title" tabIndex={-1}><div className="section-heading"><div><p className="eyebrow">WORKSPACE GUIDE</p><h2 id="workspace-dialog-title">{dialog === 'permissions' ? 'The right access for each role' : dialog === 'notifications' ? 'Notifications, without false promises' : dialog === 'invite' ? 'Secure invitations come next' : 'An honest UI preview'}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={closeDialog}><FiX /></button></div>
      {dialog === 'permissions' ? <><p className="muted-copy">Current backend roles are admin and user. Reviewer access below is a proposed restricted role—not an existing security boundary.</p><div className="permission-scroll" tabIndex={0} aria-label="Access comparison; scroll horizontally on smaller screens"><table className="permission-table"><thead><tr><th scope="col">Capability</th><th scope="col">Full admin</th><th scope="col">Reviewer</th><th scope="col">User</th></tr></thead><tbody>{capabilities.map(([label,...values]) => <tr key={label}><th scope="row">{label}</th>{values.map((value,i) => <td key={i}>{value === 'Not permitted' ? <span className="permission-denied"><FiMinus />No</span> : value}</td>)}</tr>)}</tbody></table></div><p className="subtle-note">UI visibility is not authorization. A future reviewer role needs database, middleware, and Firebase claim compatibility before rollout.</p></> : dialog === 'notifications' ? <><EmptyState Icon={FiBell} title="No notification feed connected" text="There is no live inbox or unread counter in this preview. You can explore the planned decision-message templates instead." /><button className="workspace-button primary" onClick={() => { closeDialog(); go('notifications'); }}>Explore notification templates<FiArrowRight /></button></> : dialog === 'invite' ? <p className="muted-copy">Admin invitation is not yet available. The planned flow requires a verified identity, expiring single-use invitation, audit history, and safe KYC-specific Firebase claim synchronization. No invitation has been sent.</p> : <><p className="muted-copy">You can test responsive layouts, mobile navigation, role perspectives, decision controls, and notification templates.</p><div className="subtle-note"><FiLock /><span>Login, real records, saving decisions, invitations, email, and Sharegram delivery are unavailable. All API requests fail closed with HTTP 503. No auth bypass or demo account is used.</span></div></>}
    </section></div>}
  </div>;
}
