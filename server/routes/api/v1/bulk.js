const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { authHybrid, requireAdmin } = require('../../../middleware/auth-hybrid');
const { Performer, AuditLog, sequelize } = require('../../../models');
const { Op } = require('sequelize');

/**
 * @route   PUT /api/v1/bulk/update
 * @desc    複数のリソースを一括更新
 * @access  Private (Admin only)
 */
router.put('/update',
  authHybrid,
  requireAdmin,
  [
    body('resourceType').isIn(['performers', 'users']).withMessage('無効なリソースタイプです'),
    body('ids').isArray({ min: 1 }).withMessage('IDの配列が必要です'),
    body('ids.*').isInt().withMessage('IDは整数である必要があります'),
    body('updates').isObject().withMessage('更新内容はオブジェクトである必要があります'),
    body('options.validate').optional().isBoolean(),
    body('options.transaction').optional().isBoolean(),
    body('options.skipAudit').optional().isBoolean()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { resourceType, ids, updates, options = {} } = req.body;
    const { validate = true, transaction: useTransaction = true, skipAudit = false } = options;

    // トランザクション設定
    const t = useTransaction ? await sequelize.transaction() : null;

    try {
      let Model;
      let allowedFields;
      
      // リソースタイプに応じたモデルと許可フィールドの設定
      switch (resourceType) {
        case 'performers':
          Model = Performer;
          allowedFields = ['status', 'notes', 'documents'];
          break;
        case 'users':
          // ユーザーの一括更新は将来実装
          return res.status(501).json({ 
            error: 'ユーザーの一括更新は未実装です' 
          });
        default:
          return res.status(400).json({ 
            error: '無効なリソースタイプです' 
          });
      }

      // 許可されたフィールドのみを抽出
      const filteredUpdates = {};
      Object.keys(updates).forEach(key => {
        if (allowedFields.includes(key)) {
          filteredUpdates[key] = updates[key];
        }
      });

      if (Object.keys(filteredUpdates).length === 0) {
        return res.status(400).json({ 
          error: '更新可能なフィールドが含まれていません',
          allowedFields 
        });
      }

      // 特殊な更新処理
      if (filteredUpdates.status && resourceType === 'performers') {
        // ステータス更新時の追加処理
        filteredUpdates.updatedAt = new Date();
        
        // 承認/却下時の処理
        if (filteredUpdates.status === 'active' || filteredUpdates.status === 'rejected') {
          filteredUpdates.verifiedAt = new Date();
          filteredUpdates.verifiedBy = req.user.id;
        }
      }

      // 更新対象の確認
      const targets = await Model.findAll({
        where: { id: { [Op.in]: ids } },
        transaction: t
      });

      if (targets.length === 0) {
        if (t) await t.rollback();
        return res.status(404).json({ 
          error: '更新対象が見つかりません' 
        });
      }

      const foundIds = targets.map(t => t.id);
      const notFoundIds = ids.filter(id => !foundIds.includes(id));

      // 一括更新実行
      const [affectedRows] = await Model.update(
        filteredUpdates,
        {
          where: { id: { [Op.in]: foundIds } },
          validate,
          transaction: t,
          individualHooks: true // フックを実行
        }
      );

      // 監査ログ記録（スキップしない場合）
      if (!skipAudit) {
        const auditLogs = foundIds.map(id => ({
          action: 'update',
          resourceType: resourceType.slice(0, -1), // 単数形に変換
          resourceId: id,
          userId: req.user.id,
          userEmail: req.user.email,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          metadata: {
            bulkUpdate: true,
            updates: filteredUpdates,
            previousValues: targets.find(t => t.id === id)?.toJSON()
          }
        }));

        await AuditLog.bulkCreate(auditLogs, { transaction: t });
      }

      // 更新後のデータを取得
      const updatedRecords = await Model.findAll({
        where: { id: { [Op.in]: foundIds } },
        transaction: t
      });

      // トランザクションコミット
      if (t) await t.commit();

      // Webhook通知（必要に応じて）
      if (filteredUpdates.status && resourceType === 'performers') {
        const Webhook = require('../../../models/Webhook');
        const eventType = filteredUpdates.status === 'active' ? 'performer.verified' : 
                         filteredUpdates.status === 'rejected' ? 'performer.rejected' : 
                         'performer.updated';
        
        // 各更新に対して通知
        for (const record of updatedRecords) {
          await Webhook.triggerForUser(req.user.id, eventType, {
            performerId: record.id,
            updates: filteredUpdates,
            bulkUpdate: true
          });
        }
      }

      res.json({
        success: true,
        message: `${affectedRows}件のレコードを更新しました`,
        summary: {
          requested: ids.length,
          found: foundIds.length,
          updated: affectedRows,
          notFound: notFoundIds.length
        },
        updatedIds: foundIds,
        notFoundIds,
        updates: filteredUpdates,
        records: updatedRecords
      });

    } catch (error) {
      if (t) await t.rollback();
      
      console.error('一括更新エラー:', error);
      res.status(500).json({ 
        error: '一括更新に失敗しました',
        message: error.message,
        details: error.errors?.map(e => ({
          field: e.path,
          message: e.message
        }))
      });
    }
  }
);

/**
 * @route   DELETE /api/v1/bulk/delete
 * @desc    複数のリソースを一括削除
 * @access  Private (Admin only)
 */
router.delete('/delete',
  authHybrid,
  requireAdmin,
  [
    body('resourceType').isIn(['performers']).withMessage('無効なリソースタイプです'),
    body('ids').isArray({ min: 1 }).withMessage('IDの配列が必要です'),
    body('ids.*').isInt().withMessage('IDは整数である必要があります'),
    body('options.force').optional().isBoolean(),
    body('options.skipAudit').optional().isBoolean()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { resourceType, ids, options = {} } = req.body;
    const { force = false, skipAudit = false } = options;

    const t = await sequelize.transaction();

    try {
      let Model;
      
      switch (resourceType) {
        case 'performers':
          Model = Performer;
          break;
        default:
          return res.status(400).json({ 
            error: '無効なリソースタイプです' 
          });
      }

      // 削除対象の確認
      const targets = await Model.findAll({
        where: { id: { [Op.in]: ids } },
        transaction: t
      });

      if (targets.length === 0) {
        await t.rollback();
        return res.status(404).json({ 
          error: '削除対象が見つかりません' 
        });
      }

      const foundIds = targets.map(t => t.id);
      const notFoundIds = ids.filter(id => !foundIds.includes(id));

      // 削除前の監査ログ記録
      if (!skipAudit) {
        const auditLogs = targets.map(target => ({
          action: 'delete',
          resourceType: resourceType.slice(0, -1),
          resourceId: target.id,
          userId: req.user.id,
          userEmail: req.user.email,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          metadata: {
            bulkDelete: true,
            deletedData: target.toJSON(),
            force
          }
        }));

        await AuditLog.bulkCreate(auditLogs, { transaction: t });
      }

      // 一括削除実行
      const deletedCount = await Model.destroy({
        where: { id: { [Op.in]: foundIds } },
        force, // 物理削除（forceがtrueの場合）
        transaction: t
      });

      await t.commit();

      res.json({
        success: true,
        message: `${deletedCount}件のレコードを削除しました`,
        summary: {
          requested: ids.length,
          found: foundIds.length,
          deleted: deletedCount,
          notFound: notFoundIds.length
        },
        deletedIds: foundIds,
        notFoundIds
      });

    } catch (error) {
      await t.rollback();
      
      console.error('一括削除エラー:', error);
      res.status(500).json({ 
        error: '一括削除に失敗しました',
        message: error.message 
      });
    }
  }
);

/**
 * @route   POST /api/v1/bulk/validate
 * @desc    一括操作の事前検証
 * @access  Private (Admin only)
 */
router.post('/validate',
  authHybrid,
  requireAdmin,
  [
    body('operation').isIn(['update', 'delete']).withMessage('無効な操作です'),
    body('resourceType').isIn(['performers', 'users']).withMessage('無効なリソースタイプです'),
    body('ids').isArray({ min: 1 }).withMessage('IDの配列が必要です'),
    body('updates').optional().isObject()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { operation, resourceType, ids, updates } = req.body;

    try {
      let Model;
      
      switch (resourceType) {
        case 'performers':
          Model = Performer;
          break;
        case 'users':
          const User = require('../../../models/User');
          Model = User;
          break;
        default:
          return res.status(400).json({ 
            error: '無効なリソースタイプです' 
          });
      }

      // 対象レコードの確認
      const targets = await Model.findAll({
        where: { id: { [Op.in]: ids } },
        attributes: ['id', 'status', 'createdAt', 'updatedAt']
      });

      const foundIds = targets.map(t => t.id);
      const notFoundIds = ids.filter(id => !foundIds.includes(id));

      // 操作の影響を分析
      let impact = {};
      
      if (operation === 'update' && updates) {
        // 更新による影響を分析
        if (updates.status) {
          impact.statusChanges = targets.reduce((acc, target) => {
            acc[target.id] = {
              from: target.status,
              to: updates.status
            };
            return acc;
          }, {});
        }
      } else if (operation === 'delete') {
        // 削除による影響を分析
        impact.deleteCount = foundIds.length;
        impact.cannotDelete = []; // 削除できないレコード（将来の実装用）
      }

      res.json({
        valid: foundIds.length > 0,
        operation,
        resourceType,
        summary: {
          requested: ids.length,
          found: foundIds.length,
          notFound: notFoundIds.length
        },
        foundIds,
        notFoundIds,
        impact,
        warnings: notFoundIds.length > 0 ? 
          [`${notFoundIds.length}件のIDが見つかりません`] : []
      });

    } catch (error) {
      console.error('検証エラー:', error);
      res.status(500).json({ 
        error: '検証に失敗しました',
        message: error.message 
      });
    }
  }
);

module.exports = router;