/**
 * APIエラーハンドリングユーティリティ
 * フォールバック機能とユーザーフレンドリーなエラー表示
 */

export const handleApiError = (error, fallbackMessage = 'エラーが発生しました') => {
  console.error('API Error:', error);
  
  // ネットワークエラー
  if (!error.response) {
    return {
      message: 'ネットワーク接続エラーが発生しました。インターネット接続を確認してください。',
      code: 'NETWORK_ERROR',
      isRetryable: true
    };
  }
  
  // HTTPステータスコードに基づくエラー処理
  const status = error.response.status;
  
  switch (status) {
    case 400:
      return {
        message: error.response.data?.message || '入力内容に誤りがあります',
        code: 'BAD_REQUEST',
        isRetryable: false
      };
      
    case 401:
      return {
        message: '認証が必要です。再度ログインしてください。',
        code: 'UNAUTHORIZED',
        isRetryable: false
      };
      
    case 403:
      return {
        message: 'このアクションを実行する権限がありません',
        code: 'FORBIDDEN',
        isRetryable: false
      };
      
    case 404:
      return {
        message: '要求されたリソースが見つかりません',
        code: 'NOT_FOUND',
        isRetryable: false
      };
      
    case 429:
      return {
        message: 'リクエスト数が制限を超えました。しばらく待ってから再試行してください。',
        code: 'RATE_LIMIT',
        isRetryable: true,
        retryAfter: error.response.headers['retry-after']
      };
      
    case 500:
    case 502:
    case 503:
    case 504:
      return {
        message: 'サーバーエラーが発生しました。しばらく待ってから再試行してください。',
        code: 'SERVER_ERROR',
        isRetryable: true
      };
      
    default:
      return {
        message: error.response.data?.message || fallbackMessage,
        code: 'UNKNOWN_ERROR',
        isRetryable: false
      };
  }
};

/**
 * 自動リトライ機能付きAPIコール
 */
export const callWithRetry = async (apiCall, maxRetries = 3, delay = 1000) => {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await apiCall();
    } catch (error) {
      lastError = error;
      const errorInfo = handleApiError(error);
      
      // リトライ不可能なエラーの場合は即座に終了
      if (!errorInfo.isRetryable) {
        throw error;
      }
      
      // 最後の試行でない場合は待機
      if (i < maxRetries - 1) {
        console.log(`Retry attempt ${i + 1}/${maxRetries - 1} after ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        // 指数バックオフ
        delay *= 2;
      }
    }
  }
  
  throw lastError;
};

/**
 * ユーザー向けエラー通知
 */
export const showErrorNotification = (error, defaultMessage = 'エラーが発生しました') => {
  const errorInfo = handleApiError(error, defaultMessage);
  
  // カスタムイベントを発火（UI側でキャッチして表示）
  window.dispatchEvent(new CustomEvent('app:error', {
    detail: {
      message: errorInfo.message,
      code: errorInfo.code,
      isRetryable: errorInfo.isRetryable
    }
  }));
  
  return errorInfo;
};