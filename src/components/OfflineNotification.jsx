import React, { useState, useEffect } from 'react';
import { setupNetworkStatusListener } from '../serviceWorkerRegistration';

const OfflineNotification = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showNotification, setShowNotification] = useState(false);

  useEffect(() => {
    // ネットワーク状態の監視を開始
    const cleanup = setupNetworkStatusListener((status) => {
      const online = status === 'online';
      setIsOnline(online);
      
      // オフラインになった時に通知を表示
      if (!online) {
        setShowNotification(true);
      } else {
        // オンラインに戻ったら3秒後に通知を非表示
        setTimeout(() => {
          setShowNotification(false);
        }, 3000);
      }
    });

    return cleanup;
  }, []);

  if (!showNotification) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: isOnline ? '#10b981' : '#ef4444',
        color: 'white',
        padding: '12px 24px',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        zIndex: 9999,
        minWidth: '300px',
        animation: 'slideUp 0.3s ease-out',
      }}
    >
      <style>
        {`
          @keyframes slideUp {
            from {
              transform: translate(-50%, 100%);
              opacity: 0;
            }
            to {
              transform: translate(-50%, 0);
              opacity: 1;
            }
          }
        `}
      </style>
      
      <div style={{ fontSize: '20px' }}>
        {isOnline ? '✅' : '⚠️'}
      </div>
      
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: '600', marginBottom: '2px' }}>
          {isOnline ? 'オンラインに戻りました' : 'オフラインです'}
        </div>
        <div style={{ fontSize: '14px', opacity: 0.9 }}>
          {isOnline 
            ? 'インターネット接続が回復しました' 
            : '一部の機能が制限される場合があります'}
        </div>
      </div>
      
      <button
        onClick={() => setShowNotification(false)}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'white',
          fontSize: '20px',
          cursor: 'pointer',
          padding: '4px',
          opacity: 0.8,
          transition: 'opacity 0.2s',
        }}
        onMouseEnter={(e) => e.target.style.opacity = '1'}
        onMouseLeave={(e) => e.target.style.opacity = '0.8'}
      >
        ×
      </button>
    </div>
  );
};

export default OfflineNotification;