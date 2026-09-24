'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Performersテーブルのインデックス
    await queryInterface.addIndex('Performers', ['external_id'], {
      name: 'idx_performers_external_id',
      unique: true,
      concurrently: true,
      where: {
        external_id: {
          [Sequelize.Op.ne]: null
        }
      }
    });

    // 複合インデックス: status + kycStatus（頻繁に一緒にフィルターされる）
    await queryInterface.addIndex('Performers', ['status', 'kycStatus'], {
      name: 'idx_performers_status_kyc_status',
      concurrently: true
    });

    // 複合インデックス: userId + status（ユーザー別のパフォーマー検索用）
    await queryInterface.addIndex('Performers', ['userId', 'status'], {
      name: 'idx_performers_user_id_status',
      concurrently: true
    });

    // 部分インデックス: activeなパフォーマーのみ（頻繁にアクセスされる）
    await queryInterface.addIndex('Performers', ['id'], {
      name: 'idx_performers_active_only',
      concurrently: true,
      where: {
        status: 'active'
      }
    });

    // 作成日時と更新日時のインデックス（ソート用）
    await queryInterface.addIndex('Performers', ['createdAt'], {
      name: 'idx_performers_created_at',
      concurrently: true
    });

    await queryInterface.addIndex('Performers', ['updatedAt'], {
      name: 'idx_performers_updated_at',
      concurrently: true
    });

    // 2. AuditLogsテーブルのインデックス
    await queryInterface.addIndex('AuditLogs', ['userId', 'action'], {
      name: 'idx_audit_logs_user_action',
      concurrently: true
    });

    await queryInterface.addIndex('AuditLogs', ['resourceType', 'resourceId'], {
      name: 'idx_audit_logs_resource',
      concurrently: true
    });

    await queryInterface.addIndex('AuditLogs', ['createdAt'], {
      name: 'idx_audit_logs_created_at',
      concurrently: true
    });

    // 部分インデックス: 最近30日のログのみ（頻繁にアクセスされる）
    await queryInterface.addIndex('AuditLogs', ['userId', 'createdAt'], {
      name: 'idx_audit_logs_recent_user_activity',
      concurrently: true,
      where: {
        createdAt: {
          [Sequelize.Op.gte]: Sequelize.literal("CURRENT_DATE - INTERVAL '30 days'")
        }
      }
    });

    // 3. ApiLogsテーブルのインデックス
    await queryInterface.addIndex('ApiLogs', ['method', 'path'], {
      name: 'idx_api_logs_method_path',
      concurrently: true
    });

    await queryInterface.addIndex('ApiLogs', ['responseStatus'], {
      name: 'idx_api_logs_response_status',
      concurrently: true
    });

    await queryInterface.addIndex('ApiLogs', ['createdAt'], {
      name: 'idx_api_logs_created_at',
      concurrently: true
    });

    // 部分インデックス: エラーログのみ（トラブルシューティング用）
    await queryInterface.addIndex('ApiLogs', ['createdAt', 'path'], {
      name: 'idx_api_logs_errors_only',
      concurrently: true,
      where: {
        responseStatus: {
          [Sequelize.Op.gte]: 400
        }
      }
    });

    // 4. SharegramIntegrationsテーブルのインデックス
    await queryInterface.addIndex('SharegramIntegrations', ['userId', 'integrationType'], {
      name: 'idx_sharegram_integrations_user_type',
      concurrently: true
    });

    await queryInterface.addIndex('SharegramIntegrations', ['isActive'], {
      name: 'idx_sharegram_integrations_active',
      concurrently: true,
      where: {
        isActive: true
      }
    });

    // 5. KycDocumentsテーブルのインデックス
    await queryInterface.addIndex('KycDocuments', ['performerId', 'documentType'], {
      name: 'idx_kyc_documents_performer_type',
      unique: true,
      concurrently: true
    });

    await queryInterface.addIndex('KycDocuments', ['verificationStatus'], {
      name: 'idx_kyc_documents_verification_status',
      concurrently: true
    });

    // 複合インデックス: performerId + verificationStatus（検証状況の確認用）
    await queryInterface.addIndex('KycDocuments', ['performerId', 'verificationStatus'], {
      name: 'idx_kyc_documents_performer_verification',
      concurrently: true
    });

    // 6. テキスト検索用のGINインデックス（PostgreSQL専用）
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      // パフォーマー名の全文検索用
      await queryInterface.sequelize.query(`
        CREATE INDEX CONCURRENTLY idx_performers_fulltext_name 
        ON "Performers" 
        USING gin (
          to_tsvector('simple', 
            COALESCE("lastName", '') || ' ' || 
            COALESCE("firstName", '') || ' ' || 
            COALESCE("lastNameRoman", '') || ' ' || 
            COALESCE("firstNameRoman", '')
          )
        );
      `);

      // JSONフィールドのインデックス（documents, kycMetadata）
      await queryInterface.sequelize.query(`
        CREATE INDEX CONCURRENTLY idx_performers_documents_gin 
        ON "Performers" 
        USING gin (documents);
      `);

      await queryInterface.sequelize.query(`
        CREATE INDEX CONCURRENTLY idx_performers_kyc_metadata_gin 
        ON "Performers" 
        USING gin ("kycMetadata");
      `);
    }

    console.log('パフォーマンス最適化インデックスの追加が完了しました');
  },

  down: async (queryInterface, Sequelize) => {
    // インデックスの削除（逆順）
    const dialect = queryInterface.sequelize.getDialect();
    
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_performers_fulltext_name;');
      await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_performers_documents_gin;');
      await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_performers_kyc_metadata_gin;');
    }

    // KycDocuments
    await queryInterface.removeIndex('KycDocuments', 'idx_kyc_documents_performer_verification');
    await queryInterface.removeIndex('KycDocuments', 'idx_kyc_documents_verification_status');
    await queryInterface.removeIndex('KycDocuments', 'idx_kyc_documents_performer_type');

    // SharegramIntegrations
    await queryInterface.removeIndex('SharegramIntegrations', 'idx_sharegram_integrations_active');
    await queryInterface.removeIndex('SharegramIntegrations', 'idx_sharegram_integrations_user_type');

    // ApiLogs
    await queryInterface.removeIndex('ApiLogs', 'idx_api_logs_errors_only');
    await queryInterface.removeIndex('ApiLogs', 'idx_api_logs_created_at');
    await queryInterface.removeIndex('ApiLogs', 'idx_api_logs_response_status');
    await queryInterface.removeIndex('ApiLogs', 'idx_api_logs_method_path');

    // AuditLogs
    await queryInterface.removeIndex('AuditLogs', 'idx_audit_logs_recent_user_activity');
    await queryInterface.removeIndex('AuditLogs', 'idx_audit_logs_created_at');
    await queryInterface.removeIndex('AuditLogs', 'idx_audit_logs_resource');
    await queryInterface.removeIndex('AuditLogs', 'idx_audit_logs_user_action');

    // Performers
    await queryInterface.removeIndex('Performers', 'idx_performers_updated_at');
    await queryInterface.removeIndex('Performers', 'idx_performers_created_at');
    await queryInterface.removeIndex('Performers', 'idx_performers_active_only');
    await queryInterface.removeIndex('Performers', 'idx_performers_user_id_status');
    await queryInterface.removeIndex('Performers', 'idx_performers_status_kyc_status');
    await queryInterface.removeIndex('Performers', 'idx_performers_external_id');

    console.log('パフォーマンス最適化インデックスの削除が完了しました');
  }
};