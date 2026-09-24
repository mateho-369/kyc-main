import * as Sentry from '@sentry/react';
import { BrowserTracing } from '@sentry/tracing';

/**
 * Sentry初期化設定
 * エラー監視とパフォーマンス監視の設定
 */
export const initSentry = () => {
  // 本番環境またはステージング環境でのみ有効化
  if (process.env.NODE_ENV === 'production' || process.env.REACT_APP_ENVIRONMENT === 'staging') {
    Sentry.init({
      dsn: process.env.REACT_APP_SENTRY_DSN,
      
      // 環境設定
      environment: process.env.REACT_APP_ENVIRONMENT || process.env.NODE_ENV,
      
      // リリース情報
      release: process.env.REACT_APP_VERSION || 'unknown',
      
      // インテグレーション
      integrations: [
        new BrowserTracing({
          // ルーティングのトレース
          routingInstrumentation: Sentry.reactRouterV6Instrumentation(
            React.useEffect,
            useLocation,
            useNavigationType,
            createRoutesFromChildren,
            matchRoutes
          ),
          
          // トレースの開始場所
          tracingOrigins: [
            'localhost',
            process.env.REACT_APP_API_URL,
            /^\//
          ],
        }),
        
        // Reactエラーバウンダリー統合
        new Sentry.Replay({
          // セッションリプレイ設定
          maskAllText: true,
          maskAllInputs: true,
          blockAllMedia: true,
          
          // プライバシー保護
          privacy: {
            maskTextContent: true,
            maskInputOptions: {
              password: true,
              email: true,
              tel: true
            }
          }
        })
      ],
      
      // パフォーマンス監視
      tracesSampleRate: process.env.REACT_APP_ENVIRONMENT === 'production' ? 0.1 : 1.0,
      
      // セッションリプレイ
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
      
      // エラーフィルタリング
      beforeSend(event, hint) {
        // 開発環境のエラーを除外
        if (event.environment === 'development') {
          return null;
        }
        
        // 特定のエラーを除外
        const error = hint.originalException;
        
        // ネットワークエラーの除外（一時的な接続エラー）
        if (error && error.message && error.message.includes('Network Error')) {
          return null;
        }
        
        // キャンセルされたリクエストの除外
        if (error && error.name === 'AbortError') {
          return null;
        }
        
        // ブラウザ拡張機能由来のエラーを除外
        if (event.exception?.values?.[0]?.stacktrace?.frames?.some(
          frame => frame.filename?.includes('extension://')
        )) {
          return null;
        }
        
        // 機密情報のマスキング
        if (event.request?.cookies) {
          delete event.request.cookies;
        }
        
        if (event.request?.headers) {
          // Authorizationヘッダーのマスキング
          if (event.request.headers['Authorization']) {
            event.request.headers['Authorization'] = '[REDACTED]';
          }
        }
        
        return event;
      },
      
      // ブレッドクラムの設定
      beforeBreadcrumb(breadcrumb) {
        // console.logのブレッドクラムを除外
        if (breadcrumb.category === 'console') {
          return null;
        }
        
        // 機密URLのマスキング
        if (breadcrumb.category === 'navigation' || breadcrumb.category === 'xhr') {
          if (breadcrumb.data?.url?.includes('/api/auth')) {
            breadcrumb.data.url = breadcrumb.data.url.replace(/\/auth\/.*/, '/auth/[REDACTED]');
          }
        }
        
        return breadcrumb;
      },
      
      // ユーザーコンテキスト設定
      initialScope: {
        tags: {
          component: 'frontend',
          version: process.env.REACT_APP_VERSION
        }
      }
    });
  }
};

/**
 * ユーザー情報の設定
 */
export const setSentryUser = (user) => {
  if (user) {
    Sentry.setUser({
      id: user.uid || user.id,
      email: user.email,
      username: user.displayName
    });
  } else {
    Sentry.setUser(null);
  }
};

/**
 * カスタムエラー報告
 */
export const reportError = (error, context = {}) => {
  console.error('Error reported:', error);
  
  Sentry.withScope((scope) => {
    // コンテキスト情報の追加
    Object.keys(context).forEach(key => {
      scope.setContext(key, context[key]);
    });
    
    // エラーレベルの設定
    if (error.severity) {
      scope.setLevel(error.severity);
    }
    
    // エラーの送信
    Sentry.captureException(error);
  });
};

/**
 * カスタムイベントの追跡
 */
export const trackEvent = (eventName, data = {}) => {
  Sentry.addBreadcrumb({
    message: eventName,
    category: 'custom',
    level: 'info',
    data
  });
};

/**
 * パフォーマンス計測
 */
export const measurePerformance = (transactionName, callback) => {
  const transaction = Sentry.startTransaction({
    name: transactionName,
    op: 'custom'
  });
  
  Sentry.getCurrentHub().configureScope(scope => scope.setSpan(transaction));
  
  try {
    const result = callback();
    
    if (result instanceof Promise) {
      return result.finally(() => {
        transaction.finish();
      });
    }
    
    transaction.finish();
    return result;
  } catch (error) {
    transaction.setStatus('internal_error');
    transaction.finish();
    throw error;
  }
};

/**
 * Reactエラーバウンダリー
 */
export const SentryErrorBoundary = Sentry.ErrorBoundary;

/**
 * 高次コンポーネント（HOC）でのエラー処理
 */
export const withSentryErrorBoundary = (Component, fallback) => {
  return Sentry.withErrorBoundary(Component, {
    fallback,
    showDialog: process.env.REACT_APP_ENVIRONMENT !== 'production'
  });
};