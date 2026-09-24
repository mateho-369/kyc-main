// 旧api.jsは完全にSecureApiClientに移行済み
import secureApiClient from './SecureApiClient';

// 出演者一覧の取得（ユーザー権限に基づいてフィルタリング）
export const getPerformers = async (filters = {}) => {
  try {
    // クエリパラメータを構築
    const queryParams = new URLSearchParams();
    
    if (filters.status) {
      queryParams.append('status', filters.status);
    }
    
    if (filters.sort) {
      queryParams.append('sort', filters.sort);
    }
    
    if (filters.expiring) {
      queryParams.append('expiring', filters.expiring);
    }
    
    if (filters.search) {
      queryParams.append('search', filters.search);
    }
    
    const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
    const response = await secureApiClient.get(`/performers${query}`);
    // バックエンドのレスポンス形式に対応
    // response.dataが直接配列の場合と、response.data.dataが配列の場合の両方に対応
    if (Array.isArray(response.data)) {
      return response.data;
    } else if (response.data && response.data.data) {
      return response.data.data;
    } else {
      console.error('Unexpected response format:', response.data);
      return [];
    }
  } catch (error) {
    console.error('出演者一覧取得エラー:', error);
    throw error;
  }
};

// 【削除】getAllPerformers: GET /performers/all を叩いていたが、このAPIには
// そのルートが無い（一覧は GET /performers が user_id/role で絞る。admin は全件）。
// 未使用だったため削除。必要なら GET /performers?user_id=... を使うこと。

// 出演者詳細の取得
export const getPerformerById = async (id) => {
  try {
    const response = await secureApiClient.get(`/performers/${id}`);
    // バックエンドのレスポンス形式に対応（data.performer でネストされている場合を処理）
    const data = response.data.data;
    return data.performer || data;
  } catch (error) {
    console.error('出演者詳細取得エラー:', error);
    throw error;
  }
};

// 新規出演者の登録（CSRF保護版）
export const createPerformer = async (performerData) => {
  try {
    const formData = new FormData();

    // 基本情報をFormDataに追加
    formData.append('lastName', performerData.lastName);
    formData.append('firstName', performerData.firstName);
    formData.append('lastNameRoman', performerData.lastNameRoman);
    formData.append('firstNameRoman', performerData.firstNameRoman);

    // Sharegram SSO連携: external_idを追加
    if (performerData.external_id) {
      console.log('Adding external_id:', performerData.external_id);
      formData.append('external_id', performerData.external_id);
    }

    // ファイルをFormDataに追加（デバッグログ追加）
    if (performerData.agreementFile) {
      console.log('Adding agreementFile:', performerData.agreementFile.name, performerData.agreementFile.size);
      formData.append('agreementFile', performerData.agreementFile);
    }
    if (performerData.idFront) {
      console.log('Adding idFront:', performerData.idFront.name, performerData.idFront.size);
      formData.append('idFront', performerData.idFront);
    }
    if (performerData.idBack) {
      console.log('Adding idBack:', performerData.idBack.name, performerData.idBack.size);
      formData.append('idBack', performerData.idBack);
    }
    if (performerData.selfie) {
      console.log('Adding selfie:', performerData.selfie.name, performerData.selfie.size);
      formData.append('selfie', performerData.selfie);
    }
    if (performerData.selfieWithId) {
      console.log('Adding selfieWithId:', performerData.selfieWithId.name, performerData.selfieWithId.size);
      formData.append('selfieWithId', performerData.selfieWithId);
    }
    
    // FormDataの場合は、Content-Typeをブラウザに自動設定させる
    const response = await secureApiClient.post('/performers', formData);
    
    console.log('Create performer response:', response.data);

    // バックエンドのレスポンス形式に対応（直接オブジェクトまたはdata wrappedの両方に対応）
    if (response.data && response.data.data) {
      return response.data.data;
    }
    return response.data;
  } catch (error) {
    console.error('出演者登録エラー:', error);
    throw error;
  }
};

// 出演者情報の更新（CSRF保護版）
export const updatePerformer = async (id, performerData) => {
  try {
    // SecureApiClient使用でCSRF保護＋Firebase認証統合
    const response = await secureApiClient.put(`/performers/${id}`, performerData);
    return response.data;
  } catch (error) {
    console.error('出演者更新エラー:', error);
    throw error;
  }
};

// 出演者の書類を取得
export const getPerformerDocuments = async (performerId) => {
  try {
    const response = await secureApiClient.get(`/performers/${performerId}/documents`);
    // レスポンスデータの形式を確認
    if (response.data && response.data.data) {
      return Array.isArray(response.data.data) ? response.data.data : [];
    }
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    console.error('書類取得エラー:', error);
    // エラーの場合は空配列を返す
    return [];
  }
};

// 出演者の削除（CSRF保護版）
export const deletePerformer = async (performerId) => {
  try {
    // SecureApiClient使用でCSRF保護＋Firebase認証統合
    const response = await secureApiClient.delete(`/performers/${performerId}`);
    return response.data;
  } catch (error) {
    console.error('出演者削除エラー:', error);
    throw error;
  }
};

// 書類のダウンロード
export const downloadDocument = async (performerId, documentType) => {
  try {
    const response = await secureApiClient.get(`/performers/${performerId}/documents/${documentType}`, {
      responseType: 'blob'
    });
    return response.data;
  } catch (error) {
    console.error('書類ダウンロードエラー:', error);
    throw error;
  }
};

// 書類の検証（管理者専用・CSRF保護版）
export const verifyDocument = async (performerId, documentType) => {
  try {
    // SecureApiClient使用でCSRF保護＋Firebase認証統合
    const response = await secureApiClient.put(`/performers/${performerId}/documents/${documentType}/verify`);
    return response.data;
  } catch (error) {
    console.error('書類検証エラー:', error);
    throw error;
  }
};

// ユーザー権限を確認
export const checkUserRole = async () => {
  try {
    const response = await secureApiClient.get('/auth/me');
    return response.data.role;
  } catch (error) {
    console.error('ユーザー権限確認エラー:', error);
    throw error;
  }
};

export default {
  getPerformers,
  getPerformerById,
  createPerformer,
  updatePerformer,
  getPerformerDocuments,
  deletePerformer,
  downloadDocument,
  verifyDocument,
  checkUserRole
};