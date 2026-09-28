import React, { useState } from 'react';
import { FiCheck, FiEdit3, FiX, FiLock, FiInfo } from 'react-icons/fi';
import { reviewState } from './ReviewStatus';

const choices = [
  { id: 'approve', label: 'Approve', Icon: FiCheck, help: 'Approve this application and mark KYC as verified.' },
  { id: 'request-correction', label: 'Request correction', Icon: FiEdit3, help: 'Ask for changes. The owner can update documents and resubmit.' },
  { id: 'reject', label: 'Final rejection', Icon: FiX, help: 'End this review. Rejection does not allow resubmission.' }
];
export default function ReviewDecisionPanel({ performer, preview = false, simulation = false, onDecision }) {
  const [action, setAction] = useState('approve');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  let documents = performer?.documents || {};
  if (typeof documents === 'string') { try { documents = JSON.parse(documents); } catch (_) { documents = {}; } }
  const ready = ['agreementFile', 'idFront', 'selfie'].every(type => documents?.[type]?.verified === true);
  const reviewable = performer?.status === 'pending' && ['not_started', 'in_progress'].includes(performer?.kycStatus) && reviewState(performer) !== 'correction';
  const eligible = reviewable && (action !== 'approve' || ready) && (action === 'approve' || reason.trim().length > 0);
  const selected = choices.find(choice => choice.id === action);
  const submit = async event => {
    event.preventDefault();
    if (preview || !eligible || !confirmed || busy || !onDecision) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await onDecision(action, action === 'approve' ? {} : { reason: reason.trim() });
      if (!result?.decisionId) throw new Error('The server did not confirm a saved decision. Refresh the record before retrying.');
      setNotice(simulation ? 'Demo decision updated in memory only. No Sharegram or email message was sent.' : result.notification ? 'Decision saved. Sharegram delivery is pending—not confirmed. Email is not sent.' : 'Correction request saved. No email or external notification was sent.');
      setConfirmed(false); setReason('');
    } catch (err) {
      setError(err.response?.data?.code || err.message || 'Unable to save. Refresh the record before retrying.');
    } finally { setBusy(false); }
  };
  return <section className="review-panel" aria-labelledby="decision-heading">
    <div className="section-heading"><div><p className="eyebrow">FINAL REVIEW</p><h2 id="decision-heading">Make a clear decision</h2></div><span className="preview-chip"><FiLock />{preview ? 'Controls preview' : simulation ? 'Demo decision' : 'Admin only'}</span></div>
    <p className="muted-copy">Verifying documents does not approve an application. A final decision is always a separate step.</p>
    <div className="document-checklist">
      {[['agreementFile','Consent agreement'],['idFront','Identity document · front'],['selfie','Selfie']].map(([key,label]) => <div key={key}><span>{label}</span><span className={documents?.[key]?.verified ? 'verified-text' : 'muted-copy'}>{preview ? 'Not loaded' : documents?.[key]?.verified ? 'Verified' : 'Not verified'}</span></div>)}
    </div>
    <form onSubmit={submit}>
      <fieldset disabled={busy}><legend className="sr-only">Review decision</legend><div className="decision-options">
        {choices.map(({ id, label, Icon }) => <label key={id} className={`decision-option ${action === id ? 'selected' : ''}`}><input type="radio" name="decision" value={id} checked={action === id} onChange={() => { setAction(id); setConfirmed(false); setError(''); }} /><Icon aria-hidden="true" /><span>{label}</span></label>)}
      </div></fieldset>
      <p className="decision-help"><FiInfo aria-hidden="true" />{selected.help}</p>
      {action !== 'approve' && <label className="field-label">Reason <span className="muted-copy">(required)</span><textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} rows={3} disabled={busy} placeholder="Explain the decision clearly. Do not include sensitive document details." /><span className="field-hint">{reason.length}/2000 · Stored in the internal review history.</span></label>}
      {!preview && <label className="confirmation"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} />I have reviewed this application and understand this decision.</label>}
      {error && <p role="alert" className="inline-error">{error}</p>}
      {notice && <p role="status" className="inline-notice">{notice}</p>}
      <div className="decision-footer"><p>{preview ? 'No record selected. Nothing can be submitted in this preview.' : !reviewable ? 'This record is not available for a new decision.' : action === 'approve' && !ready ? 'Verify every required document before approval.' : 'The server validates permissions and the current review state.'}</p><button type="submit" className="workspace-button primary" disabled={preview || !eligible || !confirmed || busy || !onDecision}>{busy ? 'Saving…' : 'Confirm decision'}</button></div>
    </form>
  </section>;
}
