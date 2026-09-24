const express = require('express');
const app = express();
const auth = require('./middleware/auth');

// JSONパース用
app.use(express.json());

// デバッグ用リクエストログ
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  console.log('Headers:', req.headers);
  next();
});

// 認証ミドルウェアのテスト
app.get('/test-auth', auth, (req, res) => {
  console.log('Auth middleware passed, user:', req.user);
  res.json({ message: 'Auth successful', user: req.user });
});

// auditLogsルートを読み込み
const auditLogsRouter = require('./routes/auditLogs');
app.use('/api/audit-logs', auditLogsRouter);

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

const PORT = 9001;
app.listen(PORT, () => {
  console.log(`Debug server running on port ${PORT}`);
  console.log('Testing audit logs route...');
});