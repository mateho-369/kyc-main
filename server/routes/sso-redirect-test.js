const express = require('express');
const router = express.Router();

// SSO redirect test endpoint
router.get('/sso', (req, res) => {
  const { token, redirect_target } = req.query;
  
  // Default redirect target
  const finalRedirect = redirect_target || '/';
  
  // Validate token (mock)
  if (!token) {
    return res.status(400).json({
      error: 'Token required',
      redirect_target: finalRedirect
    });
  }
  
  // Mock SSO success page with redirect info
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>KYC SSO Test</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; }
    .success { color: #28a745; }
    .info { background: #e7f3ff; padding: 15px; border-radius: 4px; margin: 15px 0; }
    .redirect-btn { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="container">
    <h1 class="success">✅ KYC SSO Authentication Success</h1>
    
    <div class="info">
      <h3>🔍 Token & Redirect Analysis</h3>
      <p><strong>Token:</strong> ${token.substring(0, 20)}...</p>
      <p><strong>Redirect Target:</strong> ${finalRedirect}</p>
      <p><strong>Token Type:</strong> Firebase Custom Token</p>
    </div>
    
    <button class="redirect-btn" onclick="window.location.href='${finalRedirect}'">
      Continue to: ${finalRedirect}
    </button>
    
    <div class="info">
      <h4>📋 Test Results</h4>
      <p>✅ Token parameter received</p>
      <p>✅ Redirect target ${redirect_target ? 'specified' : 'defaulted to "/"'}</p>
      <p>✅ SSO flow completed successfully</p>
    </div>
  </div>
</body>
</html>`;
  
  res.send(html);
});

module.exports = router;