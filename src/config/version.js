/**
 * APIバージョン管理
 * 既存機能を維持しながら新機能を追加するためのバージョン管理システム
 */

export const API_VERSION = {
  // 現在のデフォルトバージョン（既存API）
  DEFAULT: 'legacy',
  
  // Sharegram統合API
  INTEGRATED: 'v1',
  
  // 機能フラグ
  FEATURES: {
    // Phase 1機能
    FIREBASE_SSO: process.env.REACT_APP_ENABLE_FIREBASE_SSO === 'true',
    PERFORMER_SYNC: process.env.REACT_APP_ENABLE_PERFORMER_SYNC === 'true',
    DOCUMENT_METADATA: process.env.REACT_APP_ENABLE_DOCUMENT_METADATA === 'true',
    
    // Phase 2機能（将来用）
    VERIFICATION_WORKFLOW: false,
    WEBHOOKS: false,
    
    // Phase 3機能（将来用）
    INTEGRATION_STATUS: false
  }
};

/**
 * APIバージョンに基づいてエンドポイントを取得
 */
export const getApiEndpoint = (endpoint, version = API_VERSION.DEFAULT) => {
  if (version === API_VERSION.INTEGRATED) {
    // v1エンドポイントにプレフィックスを追加
    return `/api/v1${endpoint}`;
  }
  // レガシーエンドポイントはそのまま
  return `/api${endpoint}`;
};

/**
 * 現在のAPIバージョンを取得
 */
export const getCurrentApiVersion = () => {
  // URLパラメータまたはローカルストレージから取得
  const urlParams = new URLSearchParams(window.location.search);
  const versionParam = urlParams.get('api_version');
  
  if (versionParam) {
    localStorage.setItem('api_version', versionParam);
    return versionParam;
  }
  
  return localStorage.getItem('api_version') || API_VERSION.DEFAULT;
};

/**
 * APIバージョンを切り替え
 */
export const switchApiVersion = (version) => {
  localStorage.setItem('api_version', version);
  window.location.reload();
};

export default {
  API_VERSION,
  getApiEndpoint,
  getCurrentApiVersion,
  switchApiVersion
};