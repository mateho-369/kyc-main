/**
 * ユーザーマッピングモデル
 * 異なる認証システム間のユーザーマッピングを管理
 */

module.exports = (sequelize, DataTypes) => {
  const UserMapping = sequelize.define('UserMapping', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    
    // ローカルシステムのユーザーID
    localUserId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Users',
        key: 'id'
      }
    },
    
    // 外部システムの識別子
    externalSystemId: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'External system identifier (e.g., firebase, sharegram)'
    },
    
    // 外部システムでのユーザーID
    externalUserId: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'User ID in the external system'
    },
    
    // マッピングタイプ
    mappingType: {
      type: DataTypes.ENUM('primary', 'secondary', 'alias'),
      defaultValue: 'primary',
      comment: 'Type of mapping relationship'
    },
    
    // 外部システムでのメールアドレス
    externalEmail: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isEmail: true
      }
    },
    
    // 外部システムでの表示名
    externalDisplayName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    
    // マッピング状態
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'pending', 'suspended'),
      defaultValue: 'active'
    },
    
    // 同期設定
    syncEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: 'Whether to sync data between systems'
    },
    
    // 同期方向
    syncDirection: {
      type: DataTypes.ENUM('bidirectional', 'local_to_external', 'external_to_local', 'none'),
      defaultValue: 'bidirectional'
    },
    
    // 最終同期日時
    lastSyncAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // 同期エラー
    lastSyncError: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    
    // メタデータ
    metadata: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Additional metadata about the mapping'
    },
    
    // 権限マッピング
    permissionMapping: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Maps external system permissions to local permissions'
    },
    
    // 認証プロバイダー情報
    authProvider: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Authentication provider used (e.g., google, facebook, email)'
    },
    
    // アクセストークン（暗号化して保存）
    encryptedAccessToken: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Encrypted access token for the external system'
    },
    
    // リフレッシュトークン（暗号化して保存）
    encryptedRefreshToken: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Encrypted refresh token for the external system'
    },
    
    // トークン有効期限
    tokenExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // 検証フラグ
    isVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Whether this mapping has been verified'
    },
    
    // 検証日時
    verifiedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // 検証者
    verifiedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'Users',
        key: 'id'
      }
    },
    
    // 作成者
    createdBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'Users',
        key: 'id'
      }
    },
    
    // 更新者
    updatedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'Users',
        key: 'id'
      }
    },
    
    // 削除フラグ（ソフトデリート）
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'user_mappings',
    timestamps: true,
    paranoid: true,
    indexes: [
      {
        unique: true,
        fields: ['externalSystemId', 'externalUserId']
      },
      {
        fields: ['localUserId']
      },
      {
        fields: ['status']
      },
      {
        fields: ['externalEmail']
      },
      {
        fields: ['lastSyncAt']
      }
    ],
    hooks: {
      beforeCreate: async (mapping) => {
        // 重複チェック
        const existing = await UserMapping.findOne({
          where: {
            externalSystemId: mapping.externalSystemId,
            externalUserId: mapping.externalUserId,
            deletedAt: null
          }
        });
        
        if (existing) {
          throw new Error('User mapping already exists for this external user');
        }
      },
      
      beforeUpdate: async (mapping) => {
        // 更新時のバリデーション
        if (mapping.changed('externalSystemId') || mapping.changed('externalUserId')) {
          const existing = await UserMapping.findOne({
            where: {
              externalSystemId: mapping.externalSystemId,
              externalUserId: mapping.externalUserId,
              id: { [sequelize.Sequelize.Op.ne]: mapping.id },
              deletedAt: null
            }
          });
          
          if (existing) {
            throw new Error('User mapping already exists for this external user');
          }
        }
      }
    }
  });

  // アソシエーション
  UserMapping.associate = (models) => {
    UserMapping.belongsTo(models.User, {
      foreignKey: 'localUserId',
      as: 'localUser'
    });
    
    UserMapping.belongsTo(models.User, {
      foreignKey: 'createdBy',
      as: 'creator'
    });
    
    UserMapping.belongsTo(models.User, {
      foreignKey: 'updatedBy',
      as: 'updater'
    });
    
    UserMapping.belongsTo(models.User, {
      foreignKey: 'verifiedBy',
      as: 'verifier'
    });
  };

  // インスタンスメソッド
  UserMapping.prototype.isActive = function() {
    return this.status === 'active' && !this.deletedAt;
  };

  UserMapping.prototype.needsSync = function() {
    if (!this.syncEnabled || this.syncDirection === 'none') {
      return false;
    }
    
    if (!this.lastSyncAt) {
      return true;
    }
    
    // 24時間以上経過していたら同期が必要
    const hoursSinceSync = (Date.now() - this.lastSyncAt.getTime()) / (1000 * 60 * 60);
    return hoursSinceSync > 24;
  };

  UserMapping.prototype.canSyncToExternal = function() {
    return this.syncEnabled && 
           (this.syncDirection === 'bidirectional' || this.syncDirection === 'local_to_external');
  };

  UserMapping.prototype.canSyncFromExternal = function() {
    return this.syncEnabled && 
           (this.syncDirection === 'bidirectional' || this.syncDirection === 'external_to_local');
  };

  // クラスメソッド
  UserMapping.findByExternalUser = function(systemId, userId) {
    return this.findOne({
      where: {
        externalSystemId: systemId,
        externalUserId: userId,
        status: 'active',
        deletedAt: null
      },
      include: [{
        model: sequelize.models.User,
        as: 'localUser'
      }]
    });
  };

  UserMapping.findByLocalUser = function(userId, systemId = null) {
    const where = {
      localUserId: userId,
      status: 'active',
      deletedAt: null
    };
    
    if (systemId) {
      where.externalSystemId = systemId;
    }
    
    return this.findAll({
      where,
      include: [{
        model: sequelize.models.User,
        as: 'localUser'
      }]
    });
  };

  UserMapping.createMapping = async function(data) {
    const transaction = await sequelize.transaction();
    
    try {
      // マッピングを作成
      const mapping = await this.create(data, { transaction });
      
      // 初回同期を実行
      if (mapping.syncEnabled) {
        // 同期ロジックを実行（実装が必要）
        // await syncService.syncUserMapping(mapping);
      }
      
      await transaction.commit();
      return mapping;
      
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  };

  return UserMapping;
};