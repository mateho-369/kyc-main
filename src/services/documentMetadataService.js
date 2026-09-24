// Document Metadata Service - 仕様書100%準拠のための最終1エンドポイント対応
import secureApiClient from './SecureApiClient';

/**
 * 出演者の書類メタデータを取得
 * API仕様書準拠: GET /performers/:performer_id/documents/metadata
 * 
 * @param {string} performerId - 出演者ID
 * @param {boolean} useExternalId - 外部ID検索の場合はtrue
 * @returns {Promise<Object>} 書類メタデータ情報
 */
export const getPerformerDocumentsMetadata = async (performerId, useExternalId = false) => {
  try {
    const queryParams = new URLSearchParams();
    if (useExternalId) {
      queryParams.append('external_id', 'true');
    }
    
    const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
    const response = await secureApiClient.get(`/performers/${performerId}/documents/metadata${query}`);
    
    // 仕様書準拠レスポンス形式確認
    if (response.data && typeof response.data === 'object') {
      if ('success' in response.data && 'data' in response.data) {
        // 既に仕様書準拠形式
        return response.data.data.documents || [];
      } else {
        // 旧形式の場合は配列として返す
        return response.data.documents || response.data || [];
      }
    }
    
    return [];
  } catch (error) {
    console.error('書類メタデータ取得エラー:', error);
    
    // エラー時のフォールバック動作
    if (error.response?.status === 404 || error.code === 'ECONNABORTED') {
      console.warn('メタデータAPIが利用できません。フォールバック動作します。');
      return []; // 空配列を返して基本機能を継続
    }
    
    // ネットワークエラーの場合もフォールバック
    if (!error.response) {
      console.warn('ネットワークエラー: メタデータ取得をスキップします');
      return [];
    }
    
    // その他のエラーは再スロー
    throw error;
  }
};

/**
 * 特定の書類タイプのメタデータを取得
 * 
 * @param {string} performerId - 出演者ID
 * @param {string} documentType - 書類タイプ (agreementFile, idFront, idBack, selfie, selfieWithId)
 * @param {boolean} useExternalId - 外部ID検索の場合はtrue
 * @returns {Promise<Object>} 特定書類のメタデータ
 */
export const getDocumentTypeMetadata = async (performerId, documentType, useExternalId = false) => {
  try {
    const allMetadata = await getPerformerDocumentsMetadata(performerId, useExternalId);
    
    if (allMetadata.success && allMetadata.data.documents) {
      const specificDocument = allMetadata.data.documents.find(doc => doc.type === documentType);
      
      if (specificDocument) {
        return {
          success: true,
          data: {
            document: specificDocument
          },
          error: null
        };
      } else {
        return {
          success: false,
          data: null,
          error: {
            code: 'DOCUMENT_TYPE_NOT_FOUND',
            message: `書類タイプ '${documentType}' が見つかりません`
          }
        };
      }
    }
    
    return allMetadata;
  } catch (error) {
    console.error('特定書類メタデータ取得エラー:', error);
    throw error;
  }
};

/**
 * 書類ステータスの一括確認
 * 
 * @param {string} performerId - 出演者ID
 * @param {boolean} useExternalId - 外部ID検索の場合はtrue
 * @returns {Promise<Object>} 書類ステータス一括情報
 */
export const getDocumentsStatusSummary = async (performerId, useExternalId = false) => {
  try {
    const metadata = await getPerformerDocumentsMetadata(performerId, useExternalId);
    
    if (metadata.success && metadata.data.documents) {
      const summary = {
        totalDocuments: metadata.data.documents.length,
        verifiedCount: metadata.data.documents.filter(doc => doc.status === 'verified').length,
        pendingCount: metadata.data.documents.filter(doc => doc.status === 'pending').length,
        rejectedCount: metadata.data.documents.filter(doc => doc.status === 'rejected').length,
        allVerified: metadata.data.documents.every(doc => doc.status === 'verified'),
        missingDocuments: []
      };
      
      // 必須書類の確認
      const requiredTypes = ['agreementFile', 'idFront', 'selfie'];
      requiredTypes.forEach(type => {
        if (!metadata.data.documents.find(doc => doc.type === type)) {
          summary.missingDocuments.push(type);
        }
      });
      
      return {
        success: true,
        data: {
          performerId,
          summary,
          documents: metadata.data.documents
        },
        error: null
      };
    }
    
    return metadata;
  } catch (error) {
    console.error('書類ステータス一括確認エラー:', error);
    throw error;
  }
};

/**
 * Mock API対応
 */
const mockDocumentsMetadata = {
  documents: [
    {
      type: 'agreementFile',
      name: '出演同意書',
      status: 'verified',
      last_updated: '2025-07-28T12:00:00Z'
    },
    {
      type: 'idFront',
      name: '身分証明書（表面）',
      status: 'pending',
      last_updated: '2025-07-28T10:15:30Z'
    },
    {
      type: 'selfie',
      name: 'セルフィー',
      status: 'verified',
      last_updated: '2025-07-28T11:30:00Z'
    }
  ]
};

/**
 * Mock環境での書類メタデータ取得
 */
export const getMockDocumentsMetadata = async (performerId) => {
  // 300ms遅延でリアルなAPI環境を再現
  await new Promise(resolve => setTimeout(resolve, 300));
  
  return {
    success: true,
    data: mockDocumentsMetadata,
    error: null
  };
};

// サービス関数のエクスポート
export default {
  getPerformerDocumentsMetadata,
  getDocumentTypeMetadata,
  getDocumentsStatusSummary,
  getMockDocumentsMetadata
};