// auth-sharegram-sso.js のサンプルルート

const express = require('express');
const router = express.Router();

// SSOコールバックエンドポイント
router.post('/callback', async (req, res) => {
    try {
        const { idToken, userData } = req.body;
        
        // トークン検証とユーザー処理
        console.log('SSO Callback received:', { userData });
        
        res.json({ 
            success: true, 
            message: 'SSO authentication successful',
            user: userData 
        });
    } catch (error) {
        console.error('SSO Callback error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ヘルスチェック
router.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        endpoint: 'auth-sharegram-sso',
        timestamp: new Date() 
    });
});

module.exports = router;
