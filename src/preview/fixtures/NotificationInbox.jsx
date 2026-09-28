import React, { useRef, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { FiX, FiBell, FiArrowRight } from 'react-icons/fi';
import useDialogFocus from '../../hooks/useDialogFocus';
import { messages } from '../../components/review/ReviewStatus';
import { subscribe, snapshot, visibleNotifications, markRead } from './store';

export function FixtureInbox({ onClose = () => {} }) {
  useSyncExternalStore(subscribe,snapshot,snapshot);
  const notes=visibleNotifications();
  return <div className="fixture-inbox">
    <p className="fixture-explanation"><strong>Simulated inbox.</strong> These notifications exist only in this preview tab. No email or Sharegram delivery took place. A real notification inbox is still planned.</p>
    {notes.length === 0 && <p className="muted-copy">No demo notifications for this perspective.</p>}
    {notes.map(note => {
      const message=messages[note.state];
      return <article key={note.id} className={`fixture-notification ${note.read?'is-read':''}`}>
        <span className={`fixture-note-icon tone-${message.tone}`}><message.Icon /></span>
        <div className="min-w-0 flex-1"><div className="fixture-note-heading"><h3>{message.title}</h3><span className="preview-chip">{note.read?'Read · demo':'Unread · demo'}</span></div><p>{message.text}</p><small>DEMO-{note.performerId} · {new Date(note.createdAt).toLocaleDateString('en-GB')}</small><div className="fixture-note-actions"><Link to={`/performers/${note.performerId}`} onClick={()=>{markRead(note.id);onClose();}}>View sample application <FiArrowRight /></Link>{!note.read && <button type="button" onClick={()=>markRead(note.id)}>Mark read</button>}</div></div>
      </article>;
    })}
  </div>;
}
export default function NotificationInbox({ open,onClose }) {
  const ref=useRef(null);useDialogFocus(ref,open,onClose);
  if(!open)return null;
  return <div className="workspace-modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)onClose();}}><section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="fixture-inbox-title" className="workspace-modal"><div className="section-heading"><div><p className="eyebrow">TEMPORARY MOCK DATA</p><h2 id="fixture-inbox-title"><FiBell className="inline mr-2" />Notifications</h2></div><button className="icon-button" aria-label="Close notifications" onClick={onClose}><FiX /></button></div><FixtureInbox onClose={onClose} /></section></div>;
}
