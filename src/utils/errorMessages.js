/**
 * エラーメッセージユーティリティ
 * HTTPステータスコードやエラータイプに基づいて、ユーザーフレンドリーなメッセージを返す
 */

export const getErrorMessage = (error) => {
  // ネットワークエラー
  if (!navigator.onLine) {
    return {
      title: 'ネットワークエラー',
      message: 'インターネット接続を確認してください。',
      actions: ['retry']
    };
  }

  // HTTPステータスコードに基づくメッセージ
  if (error.response) {
    const status = error.response.status;
    const data = error.response.data;

    switch (status) {
      case 400:
        return {
          title: 'リクエストエラー',
          message: data?.error?.message || '入力内容に誤りがあります。確認してください。',
          actions: ['retry']
        };

      case 401:
        return {
          title: '認証エラー',
          message: 'セッションの有効期限が切れました。再度ログインしてください。',
          actions: ['login']
        };

      case 403:
        return {
          title: 'アクセス拒否',
          message: 'このリソースへのアクセス権限がありません。',
          actions: ['home']
        };

      case 404:
        return {
          title: 'ページが見つかりません',
          message: '要求されたリソースが見つかりませんでした。',
          actions: ['home', 'retry']
        };

      case 429:
        return {
          title: 'リクエスト制限',
          message: 'リクエストが多すぎます。しばらくしてから再度お試しください。',
          actions: ['wait']
        };

      case 500:
      case 502:
      case 503:
      case 504:
        return {
          title: 'サーバーエラー',
          message: 'サーバーに問題が発生しています。しばらくしてから再度お試しください。',
          actions: ['retry', 'support']
        };

      default:
        return {
          title: 'エラー',
          message: data?.error?.message || `エラーが発生しました (コード: ${status})`,
          actions: ['retry']
        };
    }
  }

  // タイムアウトエラー
  if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
    return {
      title: 'タイムアウトエラー',
      message: '接続がタイムアウトしました。ネットワークを確認してください。',
      actions: ['retry']
    };
  }

  // その他のエラー
  return {
    title: 'エラー',
    message: error.message || '予期しないエラーが発生しました。',
    actions: ['retry', 'home']
  };
};

/**
 * エラーアクションの定義
 */
export const errorActions = {
  retry: {
    label: '再試行',
    type: 'primary'
  },
  login: {
    label: 'ログインページへ',
    type: 'secondary',
    href: '/login'
  },
  home: {
    label: 'ホームへ戻る',
    type: 'secondary',
    href: '/'
  },
  support: {
    label: 'サポートに連絡',
    type: 'secondary',
    href: 'mailto:support@example.com'
  },
  wait: {
    label: 'しばらく待つ',
    type: 'disabled'
  }
};

/**
 * エラーのログレベルを判定
 */
export const getErrorLogLevel = (error) => {
  if (!error.response) return 'error'; // ネットワークエラー
  
  const status = error.response.status;
  
  if (status >= 500) return 'error';     // サーバーエラー
  if (status === 401) return 'info';     // 認証エラー（通常のフロー）
  if (status === 403) return 'warn';     // アクセス拒否
  if (status === 404) return 'info';     // Not Found
  if (status === 429) return 'warn';     // レート制限
  
  return 'warn';
};