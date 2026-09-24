const express = require('express');
const app = express();

// JSONパース用
app.use(express.json());

// デバッグ用リクエストログ
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  console.log('Headers:', req.headers);
  next();
});

// 認証ミドルウェアのモック
const mockAuth = (req, res, next) => {
  console.log('Mock auth middleware called');
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    console.log('No token provided');
    return res.status(401).json({ message: 'No token provided' });
  }
  
  if (token === 'admin-token') {
    console.log('Admin token detected');
    req.user = { id: 1, role: 'admin' };
  } else if (token === 'user-token') {
    console.log('User token detected');
    req.user = { id: 2, role: 'user' };
  } else {
    console.log('Invalid token');
    return res.status(401).json({ message: 'Invalid token' });
  }
  
  next();
};

// 管理者権限チェック用のルート
app.get('/api/audit-logs/export', mockAuth, (req, res) => {
  console.log('Export route called, user:', req.user);
  
  // 管理者権限チェック
  if (req.user.role !== 'admin') {
    console.log('Access denied - not admin');
    return res.status(403).json({ message: 'Access denied - admin required' });
  }
  
  console.log('Admin access granted');
  res.json({ message: 'Export successful', user: req.user });
});

// 一般ユーザー用のルート
app.get('/api/audit-logs', mockAuth, (req, res) => {
  console.log('General audit logs route called, user:', req.user);
  
  // 一般ユーザーは自分のログのみ
  if (req.user.role !== 'admin') {
    console.log('User access - showing own logs only');
    return res.json({ message: 'User logs', userId: req.user.id });
  }
  
  console.log('Admin access - showing all logs');
  res.json({ message: 'All logs', user: req.user });
});

// 404エラーハンドラー
app.use((req, res, next) => {
  console.log('404 Not Found:', req.originalUrl);
  res.status(404).json({ message: `Not Found: ${req.originalUrl}` });
});

// エラーハンドラー
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);
  res.status(500).json({ message: 'Internal Server Error', error: err.message });
});

const PORT = 9002;
app.listen(PORT, () => {
  console.log(`Simple test server running on port ${PORT}`);
  console.log('Ready for testing...');
});