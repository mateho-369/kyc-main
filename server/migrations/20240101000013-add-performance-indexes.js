'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { makeSafe, isSkippable } = require('../utils/migrationGuard');
    // sync({alter:true}) が先に作っている場合があるので「既存」はスキップする
    queryInterface = makeSafe(queryInterface, '13-add-performance-indexes');
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
    // 【修正】元の定義は 'path' を参照していたが、ApiLogs にその列は無い
    // （migrations/20240101000004-create-api-logs.js と models/ApiLog.js の
    //  どちらでも列名は 'endpoint'）。そのためこのマイグレーションは
    //    ERROR: Key column 'path' doesn't exist in table
    //  で空振りし、以降のインデックスまで未適用になっていた。
    await queryInterface.addIndex('ApiLogs', ['method', 'endpoint'], {
      name: 'idx_api_logs_method_endpoint',
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
    // 【修正】'path' → 'responseStatus'。
    //   ・'path' は実在しない列（endpoint の誤り）
    //   ・where の responseStatus を引き算したいので、被る列を索引に含める方が
    //     MySQL では実用的（MySQL は where 付き部分インデックスに非対応で、
    //     options.where は無視される。PostgreSQL では引き続き部分インデックスになる）
    await queryInterface.addIndex('ApiLogs', ['createdAt', 'responseStatus'], {
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
    // 【修正】KycDocuments に performerId は無い（親は kycRequestId、
    //  migrations/20240101000008-create-kyc-documents.js / models/KYCDocument.js 参照）。
    //  パフォーマー単位で引きたい場合は KycRequests 経由（performerId はそちらにある）。
    await queryInterface.addIndex('KycDocuments', ['kycRequestId', 'documentType'], {
      name: 'idx_kyc_documents_request_type',
      unique: true,
      concurrently: true
    });

    await queryInterface.addIndex('KycDocuments', ['verificationStatus'], {
      name: 'idx_kyc_documents_verification_status',
      concurrently: true
    });

    // 複合インデックス: kycRequestId + verificationStatus（検証状況の確認用）
    await queryInterface.addIndex('KycDocuments', ['kycRequestId', 'verificationStatus'], {
      name: 'idx_kyc_documents_request_verification',
      concurrently: true
    });

    // 6. テキスト検索用のGINインデックス（PostgreSQL専用）
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      try {
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
      } catch (indexError) {
        // raw SQL は makeSafe の対象外なので、ここで「既存」だけを許容する
        if (!isSkippable(indexError)) throw indexError;
        console.log(
          `[migrate:13-add-performance-indexes] SKIP postgres GIN index \u2014 ${String(indexError.message).split(/[\r\n]+/)[0]}`
        );
      }
    }

    console.log('パフォーマンス最適化インデックスの追加が完了しました');
  },

  down: async (queryInterface, Sequelize) => {
    const { makeSafe } = require('../utils/migrationGuard');
    // sync({alter:true}) が先に作っている場合があるので「既存」はスキップする
    queryInterface = makeSafe(queryInterface, '13-add-performance-indexes');
    // インデックスの削除（逆順）
    const dialect = queryInterface.sequelize.getDialect();
    
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_performers_fulltext_name;');
      await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_performers_documents_gin;');
      await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_performers_kyc_metadata_gin;');
    }

    // KycDocuments
    await queryInterface.removeIndex('KycDocuments', 'idx_kyc_documents_request_verification');
    await queryInterface.removeIndex('KycDocuments', 'idx_kyc_documents_verification_status');
    await queryInterface.removeIndex('KycDocuments', 'idx_kyc_documents_request_type');

    // SharegramIntegrations
    await queryInterface.removeIndex('SharegramIntegrations', 'idx_sharegram_integrations_active');
    await queryInterface.removeIndex('SharegramIntegrations', 'idx_sharegram_integrations_user_type');

    // ApiLogs
    await queryInterface.removeIndex('ApiLogs', 'idx_api_logs_errors_only');
    await queryInterface.removeIndex('ApiLogs', 'idx_api_logs_created_at');
    await queryInterface.removeIndex('ApiLogs', 'idx_api_logs_response_status');
    await queryInterface.removeIndex('ApiLogs', 'idx_api_logs_method_endpoint');

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