import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ReviewDecisionPanel from '../ReviewDecisionPanel';
import ReviewStatusNotice, { reviewState, ReviewBadge } from '../ReviewStatus';
import PreviewApp from '../../../preview/PreviewApp';
import Header from '../../Header';
import Navigation from '../../Navigation';

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin', name: 'Unit test account' }, logout: vi.fn() }) }));
window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
window.scrollTo = vi.fn();
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const ready = () => ({ status: 'pending', kycStatus: 'in_progress', documents: {
  agreementFile: { verified: true }, idFront: { verified: true }, selfie: { verified: true }
} });

describe('record truth, not decorative success badges', () => {
  it('does not equate active with verified KYC', () => {
    expect(reviewState({ status: 'active', kycStatus: 'in_progress' })).toBe('unknown');
    render(<ReviewBadge performer={{ status: 'pending' }} />);
    expect(screen.getByText('確認待ち')).toBeInTheDocument();
  });
  it('supports MariaDB JSON-string metadata for correction state', () => {
    expect(reviewState({ status: 'pending', kycMetadata: '{"reviewState":"correction_required"}' })).toBe('correction');
    expect(reviewState({ status: 'pending', kycMetadata: 'bad JSON' })).toBe('pending');
  });
  it('labels template messages as not delivered notifications', () => {
    render(<ReviewStatusNotice templateState="rejected" />);
    expect(screen.getByText(/Message template · not a real notification/)).toBeInTheDocument();
  });
});
describe('final decision controls', () => {
  it('blocks preview submissions even after choosing a decision and typing a reason', () => {
    const callback = vi.fn();
    render(<ReviewDecisionPanel preview onDecision={callback} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Final rejection' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Preview text only' } });
    expect(screen.getByRole('button', { name: 'Confirm decision' })).toBeDisabled();
    expect(callback).not.toHaveBeenCalled();
  });
  it('requires ready documents and explicit acknowledgement before approval', async () => {
    const callback = vi.fn().mockResolvedValue({ decisionId: 'test-decision', notification: { status: 'pending' } });
    const { rerender } = render(<ReviewDecisionPanel performer={{ ...ready(), documents: {} }} onDecision={callback} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Confirm decision' })).toBeDisabled();
    rerender(<ReviewDecisionPanel performer={ready()} onDecision={callback} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
    await waitFor(() => expect(callback).toHaveBeenCalledWith('approve', {}));
    expect(await screen.findByRole('status')).toHaveTextContent('Sharegram delivery is pending—not confirmed');
    expect(screen.getByRole('status')).toHaveTextContent('Email is not sent');
  });
  it('requires a trimmed reason for correction requests', async () => {
    const callback = vi.fn().mockResolvedValue({ decisionId: 'test-correction', notification: null });
    render(<ReviewDecisionPanel performer={ready()} onDecision={callback} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Request correction' }));
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Confirm decision' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Please replace the photo.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
    await waitFor(() => expect(callback).toHaveBeenCalledWith('request-correction', { reason: 'Please replace the photo.' }));
    expect(await screen.findByRole('status')).toHaveTextContent('No email or external notification was sent');
  });
  it.each(['active', 'rejected'])('blocks a new decision on %s', status => {
    render(<ReviewDecisionPanel performer={{ ...ready(), status }} onDecision={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Confirm decision' })).toBeDisabled();
  });
  it('surfaces a server conflict without claiming success', async () => {
    const callback = vi.fn().mockRejectedValue({ response: { data: { code: 'INVALID_REVIEW_TRANSITION' } } });
    render(<ReviewDecisionPanel performer={ready()} onDecision={callback} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('INVALID_REVIEW_TRANSITION');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('does not claim success when a response has no decision ID', async () => {
    render(<ReviewDecisionPanel performer={ready()} onDecision={async () => ({})} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('did not confirm');
  });
});
describe('honest preview role perspectives', () => {
  it('shows review-only as proposed and hides full-admin navigation', () => {
    render(<PreviewApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Review-only admin', exact: true }));
    expect(screen.getByText('Proposed permission set.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'People & access', exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Audit trail', exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'User', exact: true }));
    expect(screen.getByRole('button', { name: 'My applications', exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Approve', exact: true })).not.toBeInTheDocument();
  });
});
describe('existing production navigation', () => {
  it('exposes expanded state and notification information without an unread count', () => {
    render(<MemoryRouter><Header navOpen onToggleNav={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'メニューを閉じる' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: '通知について' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('まだ実装されていません');
  });
  it('Escape closes the real mobile navigation and scroll lock is restored on cleanup', () => {
    const onClose = vi.fn();
    const { unmount } = render(<MemoryRouter><Navigation mobileOpen onClose={onClose} /></MemoryRouter>);
    expect(screen.getByRole('dialog', { name: 'メニュー' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
