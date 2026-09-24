const puppeteer = require('puppeteer');

(async () => {
  console.log('Starting Firebase login page test...');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    // コンソールログを収集
    const consoleMessages = [];
    page.on('console', msg => {
      consoleMessages.push({
        type: msg.type(),
        text: msg.text()
      });
    });
    
    // エラーを収集
    const pageErrors = [];
    page.on('error', err => {
      pageErrors.push(err.message);
    });
    
    page.on('pageerror', err => {
      pageErrors.push(err.message);
    });
    
    // Firebase loginページにアクセス
    console.log('Navigating to Firebase login page...');
    await page.goto('http://localhost:3001/firebase-login', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // ページタイトルを取得
    const title = await page.title();
    console.log('Page title:', title);
    
    // ページコンテンツを確認
    const hasFirebaseLogin = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Firebase') || text.includes('Google') || text.includes('ログイン');
    });
    
    console.log('Firebase login elements found:', hasFirebaseLogin);
    
    // tokenResponse関連のエラーを探す
    const tokenResponseError = consoleMessages.find(msg => 
      msg.text.includes('tokenResponse') || 
      msg.text.includes('\\\\!') ||
      msg.text.includes('SyntaxError')
    );
    
    // 結果を報告
    console.log('\n=== Test Results ===');
    console.log('Page loaded successfully:', title !== '');
    console.log('Firebase login page detected:', hasFirebaseLogin);
    console.log('Console messages:', consoleMessages.length);
    console.log('Page errors:', pageErrors.length);
    
    if (tokenResponseError) {
      console.log('\n⚠️  TokenResponse Error Found:');
      console.log(tokenResponseError);
    }
    
    if (pageErrors.length > 0) {
      console.log('\n❌ Page Errors:');
      pageErrors.forEach(err => console.log(' -', err));
    }
    
    if (consoleMessages.length > 0) {
      console.log('\n📋 Console Messages:');
      consoleMessages.forEach(msg => {
        if (msg.type === 'error' || msg.text.includes('Error')) {
          console.log(` ❌ [${msg.type}]`, msg.text);
        } else if (msg.type === 'warning') {
          console.log(` ⚠️  [${msg.type}]`, msg.text);
        } else {
          console.log(` ✓ [${msg.type}]`, msg.text);
        }
      });
    }
    
    // スクリーンショット保存
    await page.screenshot({ path: 'firebase-login-test.png', fullPage: true });
    console.log('\n📸 Screenshot saved as firebase-login-test.png');
    
  } catch (error) {
    console.error('Test failed:', error.message);
  } finally {
    await browser.close();
    console.log('\nTest completed.');
  }
})();