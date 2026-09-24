// Cypress E2E サポートファイル
import './commands';

// 未処理のプロミス拒否を無視（開発中のAPI不安定性対応）
Cypress.on('uncaught:exception', (err, runnable) => {
  // 開発中のAPI接続エラーなどを無視
  if (err.message.includes('Network Error') || 
      err.message.includes('fetch')) {
    return false;
  }
  
  // その他のエラーは通常通り処理
  return true;
});

// テスト前の共通セットアップ
beforeEach(() => {
  // ローカルストレージクリア
  cy.clearLocalStorage();
  
  // セッションストレージクリア
  cy.clearCookies();
  
  // インターセプト設定（API監視）
  cy.intercept('POST', '/api/auth/login').as('login');
  cy.intercept('GET', '/api/auth/me').as('getMe');
  cy.intercept('POST', '/api/auth/logout').as('logout');
  cy.intercept('GET', '/api/v1/**').as('apiGet');
  cy.intercept('POST', '/api/v1/**').as('apiPost');
  cy.intercept('PUT', '/api/v1/**').as('apiPut');
  cy.intercept('DELETE', '/api/v1/**').as('apiDelete');
});

// テスト後のクリーンアップ
afterEach(() => {
  // エラー時のスクリーンショット自動取得
  if (Cypress.currentTest.state === 'failed') {
    cy.screenshot(`failed-${Cypress.currentTest.title}`);
  }
});

// カスタムコマンドのTypeScript型定義（JSDoc形式）
/**
 * @namespace Cypress
 * @type {Cypress.Chainable}
 */

// ビューポートプリセット
const viewports = {
  mobile: [375, 667],
  tablet: [768, 1024],
  desktop: [1280, 720],
  wide: [1920, 1080]
};

// レスポンシブテスト用ヘルパー
Cypress.Commands.add('testOnViewports', (viewportNames, testFn) => {
  viewportNames.forEach(name => {
    const [width, height] = viewports[name];
    cy.viewport(width, height);
    cy.log(`Testing on ${name} viewport: ${width}x${height}`);
    testFn(name);
  });
});

// API レスポンス検証ヘルパー
Cypress.Commands.add('verifyApiResponse', (alias, expectedStatus = 200) => {
  cy.wait(alias).then((interception) => {
    expect(interception.response.statusCode).to.equal(expectedStatus);
    
    if (expectedStatus >= 400) {
      expect(interception.response.body).to.have.property('error');
      expect(interception.response.body.error).to.have.property('code');
      expect(interception.response.body.error).to.have.property('message');
    }
  });
});

// 非同期操作の待機ヘルパー
Cypress.Commands.add('waitForApi', (timeout = 10000) => {
  cy.intercept('GET', '/api/v1/batch/jobs/**').as('jobStatus');
  
  function checkJobStatus() {
    cy.wait('@jobStatus', { timeout }).then((interception) => {
      const status = interception.response.body.status;
      
      if (status === 'processing' || status === 'pending') {
        cy.wait(1000);
        cy.reload();
        checkJobStatus();
      } else {
        cy.log(`Job completed with status: ${status}`);
      }
    });
  }
  
  checkJobStatus();
});

// アクセシビリティチェック（axe-core統合）
Cypress.Commands.add('checkA11y', (context, options) => {
  cy.injectAxe();
  cy.checkA11y(context, options, (violations) => {
    violations.forEach(violation => {
      cy.log(`A11y violation: ${violation.description}`);
      violation.nodes.forEach(node => {
        cy.log(`Element: ${node.target}`);
        cy.log(`Impact: ${node.impact}`);
      });
    });
  });
});

// パフォーマンス測定
Cypress.Commands.add('measurePerformance', (operationName) => {
  const startTime = Date.now();
  
  return cy.wrap(null).then(() => {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    cy.log(`Performance: ${operationName} took ${duration}ms`);
    
    // パフォーマンス閾値チェック
    if (duration > 5000) {
      cy.log(`⚠️ Slow operation detected: ${operationName} (${duration}ms)`);
    }
    
    return duration;
  });
});

// ファイルアップロードヘルパー
Cypress.Commands.add('uploadFile', (selector, filePath, fileName) => {
  cy.get(selector).attachFile({
    filePath,
    fileName,
    mimeType: 'text/csv'
  });
});

// テーブルデータ検証ヘルパー
Cypress.Commands.add('verifyTableData', (tableSelector, expectedData) => {
  cy.get(tableSelector).within(() => {
    expectedData.forEach((rowData, index) => {
      cy.get('tbody tr').eq(index).within(() => {
        Object.values(rowData).forEach((cellValue, cellIndex) => {
          cy.get('td').eq(cellIndex).should('contain.text', cellValue);
        });
      });
    });
  });
});

// モーダル操作ヘルパー
Cypress.Commands.add('openModal', (triggerSelector) => {
  cy.get(triggerSelector).click();
  cy.get('[data-testid="modal"]').should('be.visible');
});

Cypress.Commands.add('closeModal', () => {
  cy.get('[data-testid="modal-close"]').click();
  cy.get('[data-testid="modal"]').should('not.exist');
});

// フォーム検証ヘルパー
Cypress.Commands.add('submitForm', (formSelector, shouldSucceed = true) => {
  cy.get(formSelector).within(() => {
    cy.get('[type="submit"]').click();
  });
  
  if (shouldSucceed) {
    cy.get('.error-message').should('not.exist');
  } else {
    cy.get('.error-message').should('be.visible');
  }
});

// 通知確認ヘルパー
Cypress.Commands.add('verifyNotification', (message, type = 'success') => {
  cy.get(`[data-testid="notification-${type}"]`)
    .should('be.visible')
    .and('contain.text', message);
});

// ページロード完了待機
Cypress.Commands.add('waitForPageLoad', () => {
  cy.get('[data-testid="loading"]').should('not.exist');
  cy.get('body').should('be.visible');
});

// 検索機能テストヘルパー
Cypress.Commands.add('performSearch', (query, expectedResults) => {
  cy.get('[data-testid="search-input"]').clear().type(query);
  cy.get('[data-testid="search-button"]').click();
  cy.wait('@apiPost');
  
  if (expectedResults > 0) {
    cy.get('[data-testid="search-results"]')
      .should('be.visible')
      .find('[data-testid="result-item"]')
      .should('have.length.at.least', 1);
  } else {
    cy.get('[data-testid="no-results"]').should('be.visible');
  }
});

// データ編集フローヘルパー
Cypress.Commands.add('editRecord', (recordId, newData) => {
  cy.get(`[data-testid="edit-${recordId}"]`).click();
  
  Object.entries(newData).forEach(([field, value]) => {
    cy.get(`[data-testid="field-${field}"]`).clear().type(value);
  });
  
  cy.get('[data-testid="save-button"]').click();
  cy.wait('@apiPut');
  cy.verifyNotification('保存しました');
});

// ブラウザコンソールエラー監視
Cypress.Commands.add('checkConsoleErrors', () => {
  cy.window().then((win) => {
    const logs = [];
    const originalError = win.console.error;
    
    win.console.error = (...args) => {
      logs.push(args.join(' '));
      originalError.apply(win.console, args);
    };
    
    cy.wrap(logs).as('consoleLogs');
  });
});

// カスタムアサーション
chai.use(function (chai, utils) {
  chai.Assertion.addMethod('validEmail', function () {
    const email = this._obj;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    this.assert(
      emailRegex.test(email),
      `expected #{this} to be a valid email address`,
      `expected #{this} not to be a valid email address`
    );
  });
  
  chai.Assertion.addMethod('validDate', function () {
    const date = this._obj;
    const isValidDate = !isNaN(Date.parse(date));
    
    this.assert(
      isValidDate,
      `expected #{this} to be a valid date`,
      `expected #{this} not to be a valid date`
    );
  });
});