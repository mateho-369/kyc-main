describe('パフォーマー管理 E2E テスト', () => {
  beforeEach(() => {
    cy.setupTestData();
    cy.login(null, null, 'admin');
  });

  describe('パフォーマー一覧表示', () => {
    it('パフォーマー一覧が正常に表示される', () => {
      cy.visit('/performers');
      cy.waitForPageLoad();
      
      // テーブル要素の確認
      cy.get('[data-testid="performers-table"]').should('be.visible');
      cy.get('[data-testid="table-header"]').should('contain', '姓');
      cy.get('[data-testid="table-header"]').should('contain', '名');
      cy.get('[data-testid="table-header"]').should('contain', 'ステータス');
      
      // データ行の確認
      cy.get('[data-testid="performer-row"]').should('have.length.at.least', 1);
    });

    it('ページネーションが正常に機能する', () => {
      cy.visit('/performers');
      cy.waitForPageLoad();
      
      // 2ページ目に移動
      cy.navigateToPage(2);
      cy.url().should('include', 'page=2');
      
      // ページサイズ変更
      cy.changePageSize(50);
      cy.url().should('include', 'limit=50');
    });

    it('ソート機能が正常に動作する', () => {
      cy.visit('/performers');
      cy.waitForPageLoad();
      
      // 名前でソート（昇順）
      cy.sortByColumn('lastName', 'asc');
      
      // ソート結果の確認
      cy.get('[data-testid="performer-row"]').first()
        .should('contain', 'A')
        .or('contain', 'あ');
      
      // 名前でソート（降順）
      cy.sortByColumn('lastName', 'desc');
      
      cy.get('[data-testid="performer-row"]').first()
        .should('contain', 'Z')
        .or('contain', 'ん');
    });
  });

  describe('パフォーマー検索・フィルタ', () => {
    it('名前による検索が機能する', () => {
      cy.visit('/performers');
      
      cy.performSearch('田中', 1);
      
      // 検索結果の確認
      cy.get('[data-testid="search-results"]')
        .should('be.visible')
        .find('[data-testid="performer-row"]')
        .should('contain', '田中');
    });

    it('ステータスフィルターが機能する', () => {
      cy.visit('/performers');
      
      cy.searchAndFilter('', { status: 'active' });
      
      // フィルター結果確認
      cy.get('[data-testid="performer-row"]').each(($row) => {
        cy.wrap($row).find('[data-testid="status-badge"]')
          .should('contain', 'アクティブ');
      });
    });

    it('高度検索が機能する', () => {
      cy.visit('/performers');
      
      // 高度検索を開く
      cy.get('[data-testid="advanced-search-toggle"]').click();
      cy.get('[data-testid="advanced-search-panel"]').should('be.visible');
      
      // 複数条件での検索
      cy.get('[data-testid="nationality-filter"]').select('Japan');
      cy.get('[data-testid="age-range-min"]').type('20');
      cy.get('[data-testid="age-range-max"]').type('30');
      cy.get('[data-testid="registration-date-from"]').type('2024-01-01');
      
      cy.get('[data-testid="advanced-search-button"]').click();
      cy.wait('@apiPost');
      
      // 結果確認
      cy.get('[data-testid="search-results"]').should('be.visible');
      cy.get('[data-testid="applied-filters"]')
        .should('contain', '国籍: Japan')
        .and('contain', '年齢: 20-30');
    });

    it('検索結果のエクスポートが機能する', () => {
      cy.visit('/performers');
      
      cy.performSearch('', 10);
      
      // エクスポートボタンクリック
      cy.get('[data-testid="export-button"]').click();
      cy.get('[data-testid="export-menu"]').should('be.visible');
      
      // CSV エクスポート
      cy.get('[data-testid="export-csv"]').click();
      
      // ダウンロード確認（実際のファイルダウンロードはE2Eテストでは困難なため、リクエスト確認）
      cy.wait('@apiPost').then((interception) => {
        expect(interception.request.body).to.have.property('format', 'csv');
      });
      
      cy.verifyNotification('エクスポートを開始しました');
    });
  });

  describe('パフォーマー詳細・編集', () => {
    it('パフォーマー詳細ページが正常に表示される', () => {
      cy.visit('/performers');
      cy.waitForPageLoad();
      
      // 最初のパフォーマーの詳細を表示
      cy.get('[data-testid="performer-row"]').first()
        .find('[data-testid="view-button"]').click();
      
      cy.url().should('include', '/performers/');
      
      // 詳細情報の確認
      cy.get('[data-testid="performer-details"]').should('be.visible');
      cy.get('[data-testid="performer-name"]').should('be.visible');
      cy.get('[data-testid="performer-email"]').should('be.visible');
      cy.get('[data-testid="performer-status"]').should('be.visible');
      
      // タブ切り替え
      cy.get('[data-testid="tab-basic-info"]').should('have.class', 'active');
      cy.get('[data-testid="tab-documents"]').click();
      cy.get('[data-testid="documents-panel"]').should('be.visible');
      
      cy.get('[data-testid="tab-history"]').click();
      cy.get('[data-testid="history-panel"]').should('be.visible');
    });

    it('パフォーマー情報の編集が正常に動作する', () => {
      cy.visit('/performers');
      cy.waitForPageLoad();
      
      cy.get('[data-testid="performer-row"]').first().within(() => {
        cy.get('[data-testid="performer-id"]').invoke('text').as('performerId');
      });
      
      cy.get('@performerId').then((performerId) => {
        cy.editRecord(performerId, {
          phone: '090-9999-8888',
          address: '東京都渋谷区テスト1-2-3',
          notes: 'E2Eテストで更新'
        });
      });
      
      // 更新確認
      cy.get('[data-testid="performer-details"]')
        .should('contain', '090-9999-8888')
        .and('contain', '東京都渋谷区テスト1-2-3');
    });

    it('必須フィールドのバリデーションが機能する', () => {
      cy.visit('/performers/1/edit');
      
      cy.testFormValidation({
        lastName: '',
        firstName: '',
        email: 'invalid-email',
        phone: '123'
      }, ['lastName', 'firstName', 'email', 'phone']);
    });

    it('ステータス変更とコメント機能', () => {
      cy.visit('/performers/1');
      
      // ステータス変更
      cy.get('[data-testid="status-change-button"]').click();
      cy.get('[data-testid="status-modal"]').should('be.visible');
      
      cy.get('[data-testid="new-status-select"]').select('approved');
      cy.get('[data-testid="status-comment"]').type('承認完了');
      cy.get('[data-testid="confirm-status-change"]').click();
      
      cy.wait('@apiPut');
      cy.verifyNotification('ステータスを更新しました');
      
      // ステータス履歴の確認
      cy.get('[data-testid="tab-history"]').click();
      cy.get('[data-testid="status-history"]')
        .should('contain', 'approved')
        .and('contain', '承認完了');
    });
  });

  describe('新規パフォーマー作成', () => {
    it('新規パフォーマー作成が正常に完了する', () => {
      const newPerformer = {
        lastName: 'テスト',
        firstName: '太郎',
        lastNameRoman: 'Test',
        firstNameRoman: 'Taro',
        email: `test${Date.now()}@example.com`,
        phone: '090-1234-5678',
        birthDate: '1995-05-15',
        nationality: 'Japan',
        address: '東京都新宿区テスト1-1-1'
      };
      
      cy.createPerformer(newPerformer);
      
      // 一覧で確認
      cy.performSearch(newPerformer.lastName, 1);
      cy.get('[data-testid="search-results"]')
        .should('contain', newPerformer.lastName)
        .and('contain', newPerformer.firstName);
    });

    it('重複チェックが機能する', () => {
      cy.visit('/performers/new');
      
      // 既存のメールアドレスで登録試行
      cy.get('[data-testid="field-lastName"]').type('重複');
      cy.get('[data-testid="field-firstName"]').type('テスト');
      cy.get('[data-testid="field-email"]').type('admin@example.com'); // 既存メール
      
      cy.get('[data-testid="submit-button"]').click();
      
      cy.get('[data-testid="error-message"]')
        .should('be.visible')
        .and('contain', 'このメールアドレスは既に使用されています');
    });
  });

  describe('一括操作', () => {
    it('複数パフォーマーの一括承認が機能する', () => {
      cy.visit('/performers');
      cy.waitForPageLoad();
      
      // pending ステータスのパフォーマーをフィルター
      cy.searchAndFilter('', { status: 'pending' });
      
      // 最初の3つを選択
      cy.selectTableRows([0, 1, 2]);
      
      // 一括承認実行
      cy.performBulkAction('approve');
      
      // 結果確認
      cy.get('[data-testid="selected-rows"]').each(($row) => {
        cy.wrap($row).find('[data-testid="status-badge"]')
          .should('contain', '承認済み');
      });
    });

    it('一括削除機能が正常に動作する', () => {
      cy.visit('/performers');
      cy.waitForPageLoad();
      
      const initialCount = cy.get('[data-testid="performer-row"]').its('length');
      
      // 2つのパフォーマーを選択
      cy.selectTableRows([0, 1]);
      
      // 一括削除実行
      cy.performBulkAction('delete');
      
      // 確認ダイアログ
      cy.get('[data-testid="confirm-dialog"]')
        .should('be.visible')
        .and('contain', '2件のパフォーマーを削除します');
      
      cy.get('[data-testid="confirm-button"]').click();
      cy.wait('@apiDelete');
      
      // 件数減少確認
      cy.get('[data-testid="performer-row"]').should('have.length.lessThan', initialCount);
    });

    it('一括エクスポート機能', () => {
      cy.visit('/performers');
      cy.waitForPageLoad();
      
      // 全て選択
      cy.get('[data-testid="select-all-checkbox"]').check();
      
      // エクスポート実行
      cy.get('[data-testid="bulk-export-button"]').click();
      cy.get('[data-testid="export-format-modal"]').should('be.visible');
      
      cy.get('[data-testid="format-xlsx"]').click();
      cy.get('[data-testid="confirm-export"]').click();
      
      cy.wait('@apiPost');
      cy.verifyNotification('エクスポート処理を開始しました');
    });
  });

  describe('ドキュメント管理', () => {
    beforeEach(() => {
      cy.visit('/performers/1');
      cy.get('[data-testid="tab-documents"]').click();
    });

    it('ドキュメントアップロードが機能する', () => {
      // ファイルアップロード
      cy.get('[data-testid="upload-button"]').click();
      cy.get('[data-testid="upload-modal"]').should('be.visible');
      
      cy.get('[data-testid="document-type"]').select('ID');
      cy.get('[data-testid="file-input"]').attachFile('sample-id.pdf');
      cy.get('[data-testid="upload-confirm"]').click();
      
      cy.wait('@apiPost');
      cy.verifyNotification('ドキュメントをアップロードしました');
      
      // アップロード結果確認
      cy.get('[data-testid="documents-list"]')
        .should('contain', 'sample-id.pdf')
        .and('contain', 'ID');
    });

    it('ドキュメントプレビューが機能する', () => {
      cy.get('[data-testid="document-item"]').first()
        .find('[data-testid="preview-button"]').click();
      
      cy.get('[data-testid="document-preview"]').should('be.visible');
      cy.get('[data-testid="preview-content"]').should('be.visible');
      
      // プレビューを閉じる
      cy.get('[data-testid="close-preview"]').click();
      cy.get('[data-testid="document-preview"]').should('not.exist');
    });

    it('ドキュメント削除が機能する', () => {
      cy.get('[data-testid="document-item"]').first().within(() => {
        cy.get('[data-testid="delete-button"]').click();
      });
      
      cy.get('[data-testid="confirm-dialog"]')
        .should('be.visible')
        .and('contain', 'ドキュメントを削除します');
      
      cy.get('[data-testid="confirm-button"]').click();
      cy.wait('@apiDelete');
      
      cy.verifyNotification('ドキュメントを削除しました');
    });
  });

  describe('レスポンシブ対応', () => {
    it('モバイル画面でのパフォーマー一覧表示', () => {
      cy.testResponsiveDesign((viewport) => {
        cy.visit('/performers');
        
        if (viewport === 'mobile') {
          // モバイル専用レイアウト確認
          cy.get('[data-testid="mobile-card-view"]').should('be.visible');
          cy.get('[data-testid="desktop-table-view"]').should('not.be.visible');
          
          // カードタップでの詳細表示
          cy.get('[data-testid="performer-card"]').first().click();
          cy.get('[data-testid="performer-details"]').should('be.visible');
        } else {
          // デスクトップレイアウト確認
          cy.get('[data-testid="performers-table"]').should('be.visible');
        }
      });
    });
  });

  describe('パフォーマンステスト', () => {
    it('大量データでの一覧表示パフォーマンス', () => {
      // 大量データ作成
      cy.apiRequest('POST', '/v1/test-data/performers', { count: 1000 }, 'admin');
      
      cy.measurePageLoadTime('/performers');
      
      // 初期表示確認
      cy.get('[data-testid="performers-table"]').should('be.visible');
      cy.get('[data-testid="loading"]').should('not.exist');
    });

    it('検索レスポンス時間測定', () => {
      cy.visit('/performers');
      
      cy.measurePerformance('search-operation').then(() => {
        cy.performSearch('test', 5);
      });
    });
  });

  describe('アクセシビリティテスト', () => {
    it('パフォーマー一覧のアクセシビリティ確認', () => {
      cy.visit('/performers');
      cy.testAccessibility();
      
      // キーボードナビゲーション確認
      cy.get('[data-testid="performers-table"]').focus();
      cy.get('tbody tr').first().should('be.focused');
      
      // スクリーンリーダー対応確認
      cy.get('[data-testid="performers-table"]')
        .should('have.attr', 'role', 'table');
      cy.get('th').each(($header) => {
        cy.wrap($header).should('have.attr', 'scope', 'col');
      });
    });
  });
});