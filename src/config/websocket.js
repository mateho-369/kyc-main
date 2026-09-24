// WebSocket設定
export const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:5002/ws';

// WebSocket接続オプション
export const WS_OPTIONS = {
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  timeout: 20000
};

// デバッグ用
console.log('WebSocket URL:', WS_URL);

export default {
  WS_URL,
  WS_OPTIONS
};