describe('認証フロー E2E テスト', () => {
  beforeEach(() => {
    cy.setupTestData();
  });

  describe('ユーザー登録フロー', () => {
    it('新規ユーザー登録が正常に完了する', () => {
      cy.visit('/register');
      
      // 登録フォーム入力
      cy.get('[data-testid="name-input"]').type('Test User');
      cy.get('[data-testid="email-input"]').type('newuser@example.com');
      cy.get('[data-testid="password-input"]').type('SecurePassword123!');
      cy.get('[data-testid="confirm-password-input"]').type('SecurePassword123!');
      
      // 利用規約同意
      cy.get('[data-testid="terms-checkbox"]').check();
      
      // 登録実行
      cy.get('[data-testid="register-button"]').click();
      
      // 登録成功確認
      cy.verifyNotification('アカウントが作成されました');
      cy.url().should('include', '/login');
      
      // メール確認リンクの表示確認
      cy.get('[data-testid="email-verification-notice"]').should('be.visible');
    });

    it('登録フォームのバリデーションが機能する', () => {
      cy.visit('/register');
      
      // 無効なデータでバリデーションテスト
      cy.testFormValidation({
        name: '',
        email: 'invalid-email',
        password: '123',
        confirmPassword: 'different'
      }, ['name', 'email', 'password', 'confirmPassword']);
    });

    it('重複メールアドレスで登録エラーとなる', () => {
      cy.visit('/register');
      
      cy.get('[data-testid="name-input"]').type('Test User');
      cy.get('[data-testid="email-input"]').type('admin@example.com'); // 既存ユーザー
      cy.get('[data-testid="password-input"]').type('SecurePassword123!');
      cy.get('[data-testid="confirm-password-input"]').type('SecurePassword123!');
      cy.get('[data-testid="terms-checkbox"]').check();
      
      cy.get('[data-testid="register-button"]').click();
      
      cy.get('[data-testid="error-message"]')
        .should('be.visible')
        .and('contain', 'このメールアドレスは既に使用されています');
    });
  });

  describe('ログインフロー', () => {
    it('正しい認証情報でログインできる', () => {
      cy.login();
      
      // ダッシュボード表示確認
      cy.get('[data-testid="dashboard"]').should('be.visible');
      cy.get('[data-testid="welcome-message"]').should('contain', 'ようこそ');
      
      // ユーザーメニュー確認
      cy.get('[data-testid="user-menu"]').click();
      cy.get('[data-testid="user-info"]').should('be.visible');
    });

    it('間違った認証情報でログインエラーとなる', () => {
      cy.visit('/login');
      
      cy.get('[data-testid="email-input"]').type('wrong@example.com');
      cy.get('[data-testid="password-input"]').type('wrongpassword');
      cy.get('[data-testid="login-button"]').click();
      
      cy.get('[data-testid="error-message"]')
        .should('be.visible')
        .and('contain', 'メールアドレスまたはパスワードが正しくありません');
    });

    it('管理者ユーザーでログインし、管理機能にアクセスできる', () => {
      cy.login(null, null, 'admin');
      
      // 管理者メニューの表示確認
      cy.get('[data-testid="admin-menu"]').should('be.visible');
      cy.get('[data-testid="admin-menu"]').click();
      
      // 管理者機能へのアクセス確認
      cy.get('[data-testid="batch-import-link"]').should('be.visible');
      cy.get('[data-testid="user-management-link"]').should('be.visible');
      cy.get('[data-testid="system-settings-link"]').should('be.visible');
    });

    it('無効化されたユーザーでログインできない', () => {
      // 事前にユーザーを無効化
      cy.apiRequest('PUT', '/v1/users/2', { status: 'inactive' }, 'admin');
      
      cy.visit('/login');
      cy.get('[data-testid="email-input"]').type('user@example.com');
      cy.get('[data-testid="password-input"]').type('TestPassword123!');
      cy.get('[data-testid="login-button"]').click();
      
      cy.get('[data-testid="error-message"]')
        .should('be.visible')
        .and('contain', 'アカウントが無効化されています');
    });
  });

  describe('ログアウトフロー', () => {
    beforeEach(() => {
      cy.login();
    });

    it('ログアウトが正常に完了する', () => {
      cy.logout();
      
      // ログインページ表示確認
      cy.get('[data-testid="login-form"]').should('be.visible');
      
      // 保護されたページへのアクセス確認
      cy.visit('/dashboard');
      cy.url().should('include', '/login');
    });

    it('セッション期限切れで自動ログアウトされる', () => {
      // 期限切れトークンをセット
      cy.window().then((win) => {
        const expiredToken = 'expired.jwt.token';
        win.localStorage.setItem('authToken', expiredToken);
      });
      
      cy.visit('/dashboard');
      
      // ログインページにリダイレクト
      cy.url().should('include', '/login');
      cy.get('[data-testid="session-expired-message"]').should('be.visible');
    });
  });

  describe('パスワード関連フロー', () => {
    it('パスワードリセット要求ができる', () => {
      cy.visit('/login');
      cy.get('[data-testid="forgot-password-link"]').click();
      
      cy.url().should('include', '/forgot-password');
      
      cy.get('[data-testid="email-input"]').type('user@example.com');
      cy.get('[data-testid="reset-button"]').click();
      
      cy.verifyNotification('パスワードリセット用のメールを送信しました');
    });

    it('存在しないメールアドレスでパスワードリセット要求', () => {
      cy.visit('/forgot-password');
      
      cy.get('[data-testid="email-input"]').type('nonexistent@example.com');
      cy.get('[data-testid="reset-button"]').click();
      
      cy.get('[data-testid="error-message"]')
        .should('be.visible')
        .and('contain', 'メールアドレスが見つかりません');
    });
  });

  describe('アクセス制御', () => {
    it('未認証ユーザーは保護されたページにアクセスできない', () => {
      const protectedUrls = [
        '/dashboard',
        '/performers',
        '/batch/import',
        '/settings'
      ];
      
      cy.testUnauthorizedAccess(protectedUrls);
    });

    it('一般ユーザーは管理者専用ページにアクセスできない', () => {
      cy.login(null, null, 'user');
      
      // 管理者専用ページへのアクセス試行
      cy.visit('/admin/users');
      cy.get('[data-testid="access-denied"]').should('be.visible');
      
      cy.visit('/admin/system-settings');
      cy.get('[data-testid="access-denied"]').should('be.visible');
    });

    it('権限に応じたメニュー表示制御', () => {
      // 一般ユーザーでログイン
      cy.login(null, null, 'user');
      cy.get('[data-testid="admin-menu"]').should('not.exist');
      cy.get('[data-testid="batch-import-link"]').should('not.exist');
      
      cy.logout();
      
      // 管理者でログイン
      cy.login(null, null, 'admin');
      cy.get('[data-testid="admin-menu"]').should('be.visible');
      cy.get('[data-testid="user-menu"]').click();
      cy.get('[data-testid="batch-import-link"]').should('be.visible');
    });
  });

  describe('セキュリティ機能', () => {
    it('ログイン試行回数制限が機能する', () => {
      cy.visit('/login');
      
      // 5回連続でログイン失敗
      for (let i = 0; i < 5; i++) {
        cy.get('[data-testid="email-input"]').clear().type('test@example.com');
        cy.get('[data-testid="password-input"]').clear().type('wrongpassword');
        cy.get('[data-testid="login-button"]').click();
        cy.wait(1000);
      }
      
      // 6回目でアカウントロック
      cy.get('[data-testid="email-input"]').clear().type('test@example.com');
      cy.get('[data-testid="password-input"]').clear().type('wrongpassword');
      cy.get('[data-testid="login-button"]').click();
      
      cy.get('[data-testid="error-message"]')
        .should('contain', 'アカウントが一時的にロックされました');
    });

    it('パスワード強度チェックが機能する', () => {
      cy.visit('/register');
      
      const weakPasswords = ['123', 'password', 'abc123'];
      
      weakPasswords.forEach(password => {
        cy.get('[data-testid="password-input"]').clear().type(password);
        cy.get('[data-testid="password-strength"]')
          .should('be.visible')
          .and('contain', '弱い');
      });
      
      // 強いパスワード
      cy.get('[data-testid="password-input"]').clear().type('SecurePassword123!');
      cy.get('[data-testid="password-strength"]')
        .should('contain', '強い');
    });
  });

  describe('レスポンシブ対応', () => {
    it('モバイル画面でのログインフローが正常に動作する', () => {
      cy.testResponsiveDesign((viewport) => {
        cy.visit('/login');
        
        if (viewport === 'mobile') {
          // モバイル専用UI要素の確認
          cy.get('[data-testid="mobile-header"]').should('be.visible');
        }
        
        cy.login();
        cy.get('[data-testid="dashboard"]').should('be.visible');
      });
    });
  });

  describe('アクセシビリティ', () => {
    it('ログインフォームがアクセシブルである', () => {
      cy.visit('/login');
      cy.testAccessibility();
      
      // フォーカス管理の確認
      cy.get('[data-testid="email-input"]').should('be.focused');
      cy.tab();
      cy.get('[data-testid="password-input"]').should('be.focused');
      cy.tab();
      cy.get('[data-testid="login-button"]').should('be.focused');
    });

    it('エラーメッセージがスクリーンリーダーで読み上げ可能', () => {
      cy.visit('/login');
      
      cy.get('[data-testid="login-button"]').click();
      
      cy.get('[data-testid="error-message"]')
        .should('have.attr', 'aria-live', 'polite')
        .and('have.attr', 'role', 'alert');
    });
  });
});