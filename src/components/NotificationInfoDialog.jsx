import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import { FiBell, FiX } from 'react-icons/fi';
import useDialogFocus from '../hooks/useDialogFocus';

export default function NotificationInfoDialog({ open, onClose }) {
  const ref = useRef(null);
  useDialogFocus(ref, open, onClose);
  if (!open) return null;
  return <div className="workspace-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="workspace-modal" role="dialog" aria-modal="true" aria-labelledby="notification-title" tabIndex={-1} ref={ref}>
      <div className="section-heading"><h2 id="notification-title">通知について</h2><button type="button" className="icon-button" aria-label="通知を閉じる" onClick={onClose}><FiX /></button></div>
      <div className="subtle-note"><FiBell /><p>通知一覧・未読管理・メール配信はまだ実装されていません。現在の審査状況は出演者の詳細ページで確認できます。</p></div>
      <p className="muted-copy" style={{ margin: '20px 0' }}>承認・却下の保存とSharegramへの配信は別の処理です。審査結果が保存されても、Sharegram側での反映を保証するものではありません。</p>
      <Link to="/performers" className="workspace-button primary" onClick={onClose}>審査状況を確認</Link>
    </section>
  </div>;
}
