// カスタムCypressコマンド定義

/**
 * ログインコマンド
 */
Cypress.Commands.add('login', (email, password, role = 'user') => {
  const credentials = email && password ? 
    { email, password } : 
    role === 'admin' ? Cypress.env('adminUser') : Cypress.env('testUser');

  cy.visit('/login');
  
  cy.get('[data-testid="email-input"]')
    .clear()
    .type(credentials.email);
    
  cy.get('[data-testid="password-input"]')
    .clear()
    .type(credentials.password);
    
  cy.get('[data-testid="login-button"]').click();
  
  cy.wait('@login').then((interception) => {
    expect(interception.response.statusCode).to.equal(200);
    expect(interception.response.body).to.have.property('token');
    
    // トークンをローカルストレージに保存
    const token = interception.response.body.token;
    cy.window().then((win) => {
      win.localStorage.setItem('authToken', token);
    });
  });
  
  // ダッシュボードページへリダイレクト確認
  cy.url().should('include', '/dashboard');
  cy.get('[data-testid="user-menu"]').should('be.visible');
});

/**
 * ログアウトコマンド
 */
Cypress.Commands.add('logout', () => {
  cy.get('[data-testid="user-menu"]').click();
  cy.get('[data-testid="logout-button"]').click();
  
  cy.wait('@logout');
  
  // ログインページへリダイレクト確認
  cy.url().should('include', '/login');
  cy.get('[data-testid="login-form"]').should('be.visible');
  
  // ローカルストレージからトークン削除確認
  cy.window().then((win) => {
    expect(win.localStorage.getItem('authToken')).to.be.null;
  });
});

/**
 * 認証済み状態でのページ訪問
 */
Cypress.Commands.add('visitAsAuthenticated', (url, role = 'user') => {
  // APIトークン取得
  const credentials = role === 'admin' ? 
    Cypress.env('adminUser') : 
    Cypress.env('testUser');
    
  cy.task('getAuthToken', credentials).then((token) => {
    cy.window().then((win) => {
      win.localStorage.setItem('authToken', token);
    });
    
    cy.visit(url);
    cy.waitForPageLoad();
  });
});

/**
 * APIリクエスト実行（認証付き）
 */
Cypress.Commands.add('apiRequest', (method, url, body = null, role = 'user') => {
  const credentials = role === 'admin' ? 
    Cypress.env('adminUser') : 
    Cypress.env('testUser');
    
  cy.task('getAuthToken', credentials).then((token) => {
    const options = {
      method,
      url: `${Cypress.env('apiUrl')}${url}`,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };
    
    if (body) {
      options.body = body;
    }
    
    cy.request(options);
  });
});

/**
 * テストデータセットアップ
 */
Cypress.Commands.add('setupTestData', () => {
  cy.task('resetDatabase');
  cy.task('createTestData').then((data) => {
    cy.wrap(data).as('testData');
  });
});

/**
 * パフォーマー作成
 */
Cypress.Commands.add('createPerformer', (performerData = {}) => {
  const defaultData = {
    lastName: 'Test',
    firstName: 'Performer',
    lastNameRoman: 'Test',
    firstNameRoman: 'Performer',
    email: `performer${Date.now()}@example.com`,
    phone: '090-1234-5678',
    birthDate: '1990-01-01',
    nationality: 'Japan',
    address: 'Tokyo, Japan'
  };
  
  const data = { ...defaultData, ...performerData };
  
  cy.visitAsAuthenticated('/performers/new', 'admin');
  
  Object.entries(data).forEach(([field, value]) => {
    cy.get(`[data-testid="field-${field}"]`).clear().type(value);
  });
  
  cy.get('[data-testid="submit-button"]').click();
  cy.wait('@apiPost');
  
  cy.verifyNotification('パフォーマーを作成しました');
  cy.url().should('include', '/performers');
});

/**
 * 一括インポート実行
 */
Cypress.Commands.add('performBatchImport', (csvData, options = {}) => {
  const {
    dryRun = false,
    skipDuplicates = true
  } = options;
  
  cy.visitAsAuthenticated('/batch/import', 'admin');
  
  // CSVファイル作成とアップロード
  const fileName = `test-import-${Date.now()}.csv`;
  cy.writeFile(`tests/e2e/fixtures/${fileName}`, csvData);
  
  cy.get('[data-testid="file-upload"]').attachFile(fileName);
  
  if (dryRun) {
    cy.get('[data-testid="dry-run-checkbox"]').check();
  }
  
  if (skipDuplicates) {
    cy.get('[data-testid="skip-duplicates-checkbox"]').check();
  }
  
  cy.get('[data-testid="import-button"]').click();
  cy.wait('@apiPost');
  
  // インポート完了まで待機
  cy.get('[data-testid="import-status"]').should('contain', 'processing');
  cy.waitForApi();
  cy.get('[data-testid="import-status"]').should('contain', 'completed');
});

/**
 * 検索とフィルタリング
 */
Cypress.Commands.add('searchAndFilter', (searchQuery, filters = {}) => {
  cy.get('[data-testid="search-input"]').clear();
  
  if (searchQuery) {
    cy.get('[data-testid="search-input"]').type(searchQuery);
  }
  
  // フィルター適用
  Object.entries(filters).forEach(([filterType, value]) => {
    cy.get(`[data-testid="filter-${filterType}"]`).select(value);
  });
  
  cy.get('[data-testid="search-button"]').click();
  cy.wait('@apiPost');
  cy.waitForPageLoad();
});

/**
 * データテーブル操作
 */
Cypress.Commands.add('selectTableRows', (rowIndices) => {
  rowIndices.forEach(index => {
    cy.get(`[data-testid="row-checkbox-${index}"]`).check();
  });
});

Cypress.Commands.add('performBulkAction', (action, selectedRows = []) => {
  if (selectedRows.length > 0) {
    cy.selectTableRows(selectedRows);
  }
  
  cy.get('[data-testid="bulk-actions-menu"]').click();
  cy.get(`[data-testid="bulk-action-${action}"]`).click();
  
  // 確認ダイアログがある場合
  cy.get('body').then(($body) => {
    if ($body.find('[data-testid="confirm-dialog"]').length > 0) {
      cy.get('[data-testid="confirm-button"]').click();
    }
  });
  
  cy.wait('@apiPut');
  cy.verifyNotification('一括操作が完了しました');
});

/**
 * ページネーション操作
 */
Cypress.Commands.add('navigateToPage', (pageNumber) => {
  cy.get(`[data-testid="page-${pageNumber}"]`).click();
  cy.wait('@apiGet');
  cy.waitForPageLoad();
});

Cypress.Commands.add('changePageSize', (size) => {
  cy.get('[data-testid="page-size-select"]').select(size.toString());
  cy.wait('@apiGet');
  cy.waitForPageLoad();
});

/**
 * ソート操作
 */
Cypress.Commands.add('sortByColumn', (columnName, direction = 'asc') => {
  cy.get(`[data-testid="sort-${columnName}"]`).click();
  
  if (direction === 'desc') {
    cy.get(`[data-testid="sort-${columnName}"]`).click();
  }
  
  cy.wait('@apiGet');
  cy.waitForPageLoad();
});

/**
 * フォームバリデーションテスト
 */
Cypress.Commands.add('testFormValidation', (formData, expectedErrors) => {
  Object.entries(formData).forEach(([field, value]) => {
    if (value === '') {
      cy.get(`[data-testid="field-${field}"]`).clear();
    } else {
      cy.get(`[data-testid="field-${field}"]`).clear().type(value);
    }
  });
  
  cy.get('[data-testid="submit-button"]').click();
  
  expectedErrors.forEach(errorField => {
    cy.get(`[data-testid="error-${errorField}"]`).should('be.visible');
  });
});

/**
 * レスポンシブデザインテスト
 */
Cypress.Commands.add('testResponsiveDesign', (testFn) => {
  const viewports = ['mobile', 'tablet', 'desktop'];
  
  viewports.forEach(viewport => {
    cy.testOnViewports([viewport], () => {
      testFn(viewport);
    });
  });
});

/**
 * アクセシビリティテスト
 */
Cypress.Commands.add('testAccessibility', (context = null) => {
  cy.injectAxe();
  cy.checkA11y(context, {
    rules: {
      'color-contrast': { enabled: true },
      'keyboard-navigation': { enabled: true },
      'focus-management': { enabled: true }
    }
  });
});

/**
 * エラーシナリオテスト
 */
Cypress.Commands.add('simulateNetworkError', (apiPattern) => {
  cy.intercept(apiPattern, { forceNetworkError: true }).as('networkError');
});

Cypress.Commands.add('simulateServerError', (apiPattern, statusCode = 500) => {
  cy.intercept(apiPattern, {
    statusCode,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'サーバーエラーが発生しました'
      }
    }
  }).as('serverError');
});

/**
 * パフォーマンステスト
 */
Cypress.Commands.add('measurePageLoadTime', (url) => {
  const startTime = Date.now();
  
  cy.visit(url);
  cy.waitForPageLoad();
  
  cy.then(() => {
    const loadTime = Date.now() - startTime;
    cy.log(`Page load time: ${loadTime}ms`);
    
    // パフォーマンス閾値チェック（3秒）
    expect(loadTime).to.be.lessThan(3000);
  });
});

/**
 * セキュリティテスト
 */
Cypress.Commands.add('testUnauthorizedAccess', (protectedUrls) => {
  // ログアウト状態で保護されたページにアクセス
  cy.clearLocalStorage();
  
  protectedUrls.forEach(url => {
    cy.visit(url);
    cy.url().should('include', '/login');
  });
});

/**
 * データ永続性テスト
 */
Cypress.Commands.add('testDataPersistence', (testData) => {
  // データ作成
  cy.createPerformer(testData);
  
  // ページリロード
  cy.reload();
  cy.waitForPageLoad();
  
  // データが残っているか確認
  cy.get('[data-testid="performer-list"]')
    .should('contain', testData.lastName)
    .and('contain', testData.firstName);
});