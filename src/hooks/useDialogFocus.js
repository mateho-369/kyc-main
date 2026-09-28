import { useEffect } from 'react';

// Shared by mobile navigation and dialogs: contain focus, restore the opener,
// close with Escape, and preserve the previous scroll-lock state.
export default function useDialogFocus(ref, open, onClose) {
  useEffect(() => {
    if (!open || !ref.current) return undefined;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = ref.current;
    const focusable = () => [...panel.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select, textarea, [tabindex="0"]')]
      .filter(node => node.tabIndex >= 0 && node.getClientRects().length);
    (focusable()[0] || panel).focus();
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const nodes = focusable();
        if (!nodes.length) { event.preventDefault(); panel.focus(); return; }
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keydown);
      if (previous?.isConnected) previous.focus();
    };
  }, [ref, open, onClose]);
}
