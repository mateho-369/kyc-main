// Response Formatter - 仕様書準拠レスポンス形式統一ユーティリティ

/**
 * 統合API仕様書準拠の標準レスポンス形式
 * {
 *   "success": true|false,
 *   "data": {...},
 *   "error": {
 *     "code": "ERROR_CODE",
 *     "message": "エラーメッセージ"
 *   }
 * }
 */

/**
 * 成功レスポンスを仕様書準拠形式に統一
 * @param {any} data - レスポンスデータ
 * @param {string} message - 成功メッセージ（オプション）
 * @returns {Object} 仕様書準拠形式の成功レスポンス
 */
export const formatSuccessResponse = (data, message = null) => {
  const response = {
    success: true,
    data: data || {},
    error: null
  };
  
  // メッセージがある場合は data 内に含める
  if (message) {
    response.data = {
      ...response.data,
      message
    };
  }
  
  return response;
};

/**
 * エラーレスポンスを仕様書準拠形式に統一
 * @param {string} code - エラーコード
 * @param {string} message - エラーメッセージ
 * @param {any} details - エラー詳細（オプション）
 * @returns {Object} 仕様書準拠形式のエラーレスポンス
 */
export const formatErrorResponse = (code, message, details = null) => {
  const response = {
    success: false,
    data: null,
    error: {
      code,
      message
    }
  };
  
  // エラー詳細がある場合は追加
  if (details) {
    response.error.details = details;
  }
  
  return response;
};

/**
 * 既存のレスポンスを仕様書準拠形式に変換
 * @param {any} response - 既存のレスポンス
 * @param {boolean} isError - エラーレスポンスかどうか
 * @returns {Object} 仕様書準拠形式のレスポンス
 */
export const normalizeResponse = (response, isError = false) => {
  // 既に仕様書準拠形式の場合はそのまま返す
  if (response && typeof response === 'object' && 'success' in response) {
    return response;
  }
  
  if (isError) {
    // エラーレスポンスの場合
    if (response && response.code && response.message) {
      return formatErrorResponse(response.code, response.message, response.details);
    } else {
      return formatErrorResponse(
        'UNKNOWN_ERROR',
        response?.message || 'エラーが発生しました',
        response
      );
    }
  } else {
    // 成功レスポンスの場合
    return formatSuccessResponse(response);
  }
};

/**
 * Axiosレスポンスを仕様書準拠形式に変換
 * @param {Object} axiosResponse - Axiosレスポンスオブジェクト
 * @returns {Object} 仕様書準拠形式のレスポンス
 */
export const formatAxiosResponse = (axiosResponse) => {
  if (axiosResponse && axiosResponse.data) {
    // レスポンスデータが既に仕様書準拠形式かチェック
    if (typeof axiosResponse.data === 'object' && 'success' in axiosResponse.data) {
      return axiosResponse.data;
    } else {
      // 標準形式に変換
      return formatSuccessResponse(axiosResponse.data);
    }
  }
  
  return formatErrorResponse('INVALID_RESPONSE', 'レスポンスが不正です');
};

/**
 * Axiosエラーを仕様書準拠形式に変換
 * @param {Object} axiosError - Axiosエラーオブジェクト
 * @returns {Object} 仕様書準拠形式のエラーレスポンス
 */
export const formatAxiosError = (axiosError) => {
  if (axiosError.response) {
    // サーバーからのエラーレスポンス
    const errorData = axiosError.response.data;
    
    if (errorData && typeof errorData === 'object') {
      if ('success' in errorData && errorData.success === false) {
        // 既に仕様書準拠形式
        return errorData;
      } else if (errorData.code && errorData.message) {
        // エラーコード・メッセージ形式
        return formatErrorResponse(errorData.code, errorData.message, errorData.details);
      } else if (errorData.message) {
        // メッセージのみ
        return formatErrorResponse(
          getErrorCodeFromStatus(axiosError.response.status),
          errorData.message,
          errorData
        );
      }
    }
    
    // HTTPステータスコードに基づくエラー
    return formatErrorResponse(
      getErrorCodeFromStatus(axiosError.response.status),
      getErrorMessageFromStatus(axiosError.response.status),
      {
        status: axiosError.response.status,
        statusText: axiosError.response.statusText
      }
    );
  } else if (axiosError.request) {
    // ネットワークエラー
    return formatErrorResponse(
      'NETWORK_ERROR',
      'ネットワークエラーが発生しました',
      {
        timeout: axiosError.code === 'ECONNABORTED'
      }
    );
  } else {
    // その他のエラー
    return formatErrorResponse(
      'CLIENT_ERROR',
      axiosError.message || 'クライアントエラーが発生しました',
      {
        originalError: axiosError.toString()
      }
    );
  }
};

/**
 * HTTPステータスコードからエラーコードを取得
 * @param {number} status - HTTPステータスコード
 * @returns {string} エラーコード
 */
const getErrorCodeFromStatus = (status) => {
  const statusCodeMap = {
    400: 'VALIDATION_ERROR',
    401: 'AUTH_INVALID_TOKEN',
    403: 'AUTH_INSUFFICIENT_PRIVILEGES',
    404: 'RESOURCE_NOT_FOUND',
    409: 'DUPLICATE_RECORD',
    413: 'PAYLOAD_TOO_LARGE',
    429: 'RATE_LIMIT_EXCEEDED',
    500: 'SERVER_ERROR',
    502: 'BAD_GATEWAY',
    503: 'SERVICE_UNAVAILABLE',
    504: 'GATEWAY_TIMEOUT'
  };
  
  return statusCodeMap[status] || 'HTTP_ERROR';
};

/**
 * HTTPステータスコードからエラーメッセージを取得
 * @param {number} status - HTTPステータスコード
 * @returns {string} エラーメッセージ
 */
const getErrorMessageFromStatus = (status) => {
  const statusMessageMap = {
    400: 'リクエスト内容が不正です',
    401: '認証が必要です',
    403: 'アクセス権限がありません',
    404: 'リソースが見つかりません',
    409: '既に存在するリソースです',
    413: 'リクエストサイズが大きすぎます',
    429: 'リクエスト数が制限を超えました',
    500: 'サーバー内部エラーが発生しました',
    502: 'サーバーゲートウェイエラーです',
    503: 'サービスが一時的に利用できません',
    504: 'サーバータイムアウトです'
  };
  
  return statusMessageMap[status] || `HTTPエラー: ${status}`;
};

/**
 * 複数のレスポンスを統合（バッチ処理用）
 * @param {Array} responses - レスポンス配列
 * @returns {Object} 統合されたレスポンス
 */
export const mergeBatchResponses = (responses) => {
  const successResponses = responses.filter(r => r.success);
  const errorResponses = responses.filter(r => !r.success);
  
  return {
    success: errorResponses.length === 0,
    data: {
      total: responses.length,
      successful: successResponses.length,
      failed: errorResponses.length,
      results: responses
    },
    error: errorResponses.length > 0 ? {
      code: 'BATCH_PARTIAL_FAILURE',
      message: `${errorResponses.length}件の処理が失敗しました`,
      details: errorResponses
    } : null
  };
};

/**
 * ページネーション付きレスポンスの統一
 * @param {Array} items - アイテム配列
 * @param {Object} pagination - ページネーション情報
 * @returns {Object} ページネーション付き統一レスポンス
 */
export const formatPaginatedResponse = (items, pagination) => {
  return formatSuccessResponse({
    items: items || [],
    pagination: {
      total: pagination.total || 0,
      page: pagination.page || 1,
      limit: pagination.limit || 20,
      pages: Math.ceil((pagination.total || 0) / (pagination.limit || 20))
    }
  });
};

// ユーティリティ関数のエクスポート
export default {
  formatSuccessResponse,
  formatErrorResponse,
  normalizeResponse,
  formatAxiosResponse,
  formatAxiosError,
  mergeBatchResponses,
  formatPaginatedResponse
};