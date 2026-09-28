import React from 'react';
import { FiClock, FiCheckCircle, FiXCircle, FiEdit3 } from 'react-icons/fi';

export function reviewState(performer) {
  let metadata = performer?.kycMetadata;
  if (typeof metadata === 'string') { try { metadata = JSON.parse(metadata); } catch (_) { metadata = {}; } }
  if (performer?.status === 'rejected') return 'rejected';
  if (performer?.status === 'active' && performer?.kycStatus === 'verified') return 'approved';
  if (metadata?.reviewState === 'correction_required') return 'correction';
  if (performer?.status === 'pending') return 'pending';
  return 'unknown';
}
export const messages = {
  approved: { title: 'Application approved', text: 'Your application has been approved. Check Sharegram separately for your account’s availability.', ja: '承認済み', Icon: FiCheckCircle, tone: 'success' },
  rejected: { title: 'Application not approved', text: 'The review is complete and this decision is final. Contact support if you need clarification. This is different from a request to correct documents.', ja: '却下', Icon: FiXCircle, tone: 'danger' },
  correction: { title: 'Your application needs an update', text: 'Review the correction request, update the requested documents, then resubmit for another review.', ja: '修正が必要', Icon: FiEdit3, tone: 'warning' },
  pending: { title: 'Application awaiting review', text: 'Document verification and final approval are separate steps. Your application has not yet been approved.', ja: '確認待ち', Icon: FiClock, tone: 'neutral' },
  unknown: { title: 'Review status unavailable', text: 'The available status does not confirm a completed KYC review. Ask an administrator to check it.', ja: '状態を確認', Icon: FiClock, tone: 'neutral' }
};
export function ReviewBadge({ performer }) {
  const state = messages[reviewState(performer)];
  return <span className={`review-badge tone-${state.tone}`}><state.Icon aria-hidden="true" />{state.ja}</span>;
}
export default function ReviewStatusNotice({ performer, templateState }) {
  const state = messages[templateState || reviewState(performer)] || messages.unknown;
  return <div className={`review-notice tone-${state.tone}`}>
    <state.Icon aria-hidden="true" className="notice-icon" />
    <div><h3>{state.title}</h3><p>{state.text}</p>{templateState && <small>Message template · not a real notification</small>}</div>
  </div>;
}
