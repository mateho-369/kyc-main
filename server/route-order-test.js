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

// 実際のserver.jsと同様のルート順序をテスト
// 1. 最初にキャッチオールルート（問題の原因となりうる）
app.get('/api/audit-logs/*', (req, res, next) => {
  console.log('Catch-all route hit:', req.originalUrl);
  res.json({ message: 'Catch-all route without auth', path: req.originalUrl });
});

// 2. 具体的なルート（これが実行されない可能性）
app.get('/api/audit-logs/export', mockAuth, (req, res) => {
  console.log('Export route called, user:', req.user);
  
  if (req.user.role !== 'admin') {
    console.log('Access denied - not admin');
    return res.status(403).json({ message: 'Access denied - admin required' });
  }
  
  console.log('Admin access granted');
  res.json({ message: 'Export successful', user: req.user });
});

// 3. 一般ルート
app.get('/api/audit-logs', mockAuth, (req, res) => {
  console.log('General audit logs route called, user:', req.user);
  res.json({ message: 'General logs', user: req.user });
});

const PORT = 9003;
app.listen(PORT, () => {
  console.log(`Route order test server running on port ${PORT}`);
  console.log('Testing route order issues...');
});