const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = 5003;

// CORS設定（credentials対応）- 開発環境用
app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: '*'  // 開発環境ではすべてのヘッダーを許可
}));
app.use(express.json());

// ヘルスチェックエンドポイント
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'SafeVideo KYC API',
        version: '1.0.0'
    });
});

// 基本的なAPIエンドポイント
app.get('/api/status', (req, res) => {
    res.json({ 
        message: 'SafeVideo KYC API is running',
        database: 'Not connected (test mode)',
        environment: process.env.NODE_ENV || 'development'
    });
});

// セッション初期化エンドポイント
app.post('/api/auth/session/init', (req, res) => {
    console.log('Session init requested:', req.body);
    res.json({
        success: true,
        csrfToken: 'test-csrf-token-' + Date.now(),
        sessionId: 'test-session-' + Date.now()
    });
});

// ログインエンドポイント
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    console.log('Login attempt:', email);
    
    // テストユーザーの検証
    if (email === 'test@example.com' && password === 'password123') {
        res.json({
            success: true,
            user: {
                id: 1,
                email: 'test@example.com',
                name: 'Test User',
                role: 'user'
            },
            token: 'test-jwt-token-' + Date.now()
        });
    } else if (email === 'admin@example.com' && password === 'admin123') {
        res.json({
            success: true,
            user: {
                id: 2,
                email: 'admin@example.com',
                name: 'Admin User',
                role: 'admin'
            },
            token: 'test-jwt-token-' + Date.now()
        });
    } else {
        res.status(401).json({
            success: false,
            message: 'Invalid credentials'
        });
    }
});

// 認証確認エンドポイント
app.get('/api/auth/me', (req, res) => {
    // 簡易的な認証チェック（本来はトークン検証が必要）
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        res.json({
            id: 1,
            email: 'test@example.com',
            name: 'Test User',
            role: 'user'
        });
    } else {
        res.status(401).json({
            success: false,
            message: 'Not authenticated'
        });
    }
});

// ログアウトエンドポイント
app.post('/api/auth/logout', (req, res) => {
    res.json({
        success: true,
        message: 'Logged out successfully'
    });
});

// サーバー起動
app.listen(PORT, () => {
    console.log(`✅ Test Server running on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
    console.log(`📍 API status: http://localhost:${PORT}/api/status`);
});