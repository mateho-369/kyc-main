// server/routes/test-file.js という新しいファイルを作成
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

router.get('/test', (req, res) => {
  console.log('File test endpoint called');
  
  // テスト用のファイルパス
  const testFilePath = path.join(__dirname, '..', 'uploads', 'test.txt');
  
  // テストファイルを作成
  fs.writeFileSync(testFilePath, 'This is a test file');
  console.log('Created test file at:', testFilePath);
  
  // 絶対パスを表示
  console.log('Absolute path:', path.resolve(testFilePath));
  
  // ファイルを送信
  res.sendFile(path.resolve(testFilePath), (err) => {
    if (err) {
      console.error('Error sending file:', err);
      if (!res.headersSent) {
        res.status(500).send('Error serving file');
      }
    } else {
      console.log('File sent successfully');
    }
  });
});

module.exports = router;