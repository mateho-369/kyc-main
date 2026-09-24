/**
 * パフォーマンス監視設定
 * Web Vitalsとカスタムメトリクスの収集
 */

import { getCLS, getFID, getFCP, getLCP, getTTFB } from 'web-vitals';

// パフォーマンスデータの送信先
const ANALYTICS_ENDPOINT = process.env.REACT_APP_ANALYTICS_ENDPOINT || '/api/analytics';

/**
 * Web Vitalsメトリクスの収集と送信
 */
export const initPerformanceMonitoring = () => {
  // Cumulative Layout Shift (CLS)
  getCLS(sendToAnalytics);
  
  // First Input Delay (FID)
  getFID(sendToAnalytics);
  
  // First Contentful Paint (FCP)
  getFCP(sendToAnalytics);
  
  // Largest Contentful Paint (LCP)
  getLCP(sendToAnalytics);
  
  // Time to First Byte (TTFB)
  getTTFB(sendToAnalytics);
  
  // カスタムメトリクスの収集
  collectCustomMetrics();
  
  // リソースタイミングの監視
  observeResourceTiming();
  
  // 長時間タスクの監視
  observeLongTasks();
};

/**
 * メトリクスデータの送信
 */
function sendToAnalytics(metric) {
  const data = {
    name: metric.name,
    value: metric.value,
    delta: metric.delta,
    id: metric.id,
    rating: metric.rating || getRating(metric.name, metric.value),
    navigationType: getNavigationType(),
    timestamp: Date.now(),
    url: window.location.href,
    userAgent: navigator.userAgent,
    connection: getConnectionInfo()
  };
  
  // バッチ送信のためのキューに追加
  metricsQueue.push(data);
  
  // デバウンスして送信
  scheduleBatchSend();
  
  // 開発環境ではコンソールにも出力
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Performance] ${metric.name}:`, metric.value, metric.rating || getRating(metric.name, metric.value));
  }
}

// メトリクスのキュー
const metricsQueue = [];
let batchTimeout = null;

/**
 * バッチ送信のスケジューリング
 */
function scheduleBatchSend() {
  if (batchTimeout) {
    clearTimeout(batchTimeout);
  }
  
  batchTimeout = setTimeout(() => {
    if (metricsQueue.length > 0) {
      sendBatch([...metricsQueue]);
      metricsQueue.length = 0;
    }
  }, 5000); // 5秒後に送信
}

/**
 * バッチデータの送信
 */
async function sendBatch(metrics) {
  try {
    // Beacon APIを優先的に使用（ページ離脱時も送信可能）
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify({ metrics })], {
        type: 'application/json'
      });
      navigator.sendBeacon(ANALYTICS_ENDPOINT, blob);
    } else {
      // フォールバック
      await fetch(ANALYTICS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ metrics }),
        keepalive: true
      });
    }
  } catch (error) {
    console.error('Failed to send metrics:', error);
  }
}

/**
 * メトリクスの評価
 */
function getRating(name, value) {
  // Web Vitalsの推奨しきい値に基づく評価
  const thresholds = {
    CLS: { good: 0.1, poor: 0.25 },
    FID: { good: 100, poor: 300 },
    FCP: { good: 1800, poor: 3000 },
    LCP: { good: 2500, poor: 4000 },
    TTFB: { good: 800, poor: 1800 }
  };
  
  const threshold = thresholds[name];
  if (!threshold) return 'unknown';
  
  if (value <= threshold.good) return 'good';
  if (value <= threshold.poor) return 'needs-improvement';
  return 'poor';
}

/**
 * ナビゲーションタイプの取得
 */
function getNavigationType() {
  if (performance.getEntriesByType) {
    const navigation = performance.getEntriesByType('navigation')[0];
    if (navigation) {
      return navigation.type; // navigate, reload, back_forward, prerender
    }
  }
  return 'unknown';
}

/**
 * 接続情報の取得
 */
function getConnectionInfo() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  
  if (connection) {
    return {
      effectiveType: connection.effectiveType,
      downlink: connection.downlink,
      rtt: connection.rtt,
      saveData: connection.saveData
    };
  }
  
  return null;
}

/**
 * カスタムメトリクスの収集
 */
function collectCustomMetrics() {
  // React コンポーネントのレンダリング時間
  if (window.performance && window.performance.measure) {
    // マーク設定例（コンポーネント側で設定）
    // performance.mark('myComponent-start');
    // performance.mark('myComponent-end');
    // performance.measure('myComponent', 'myComponent-start', 'myComponent-end');
    
    const perfObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        if (entry.entryType === 'measure' && entry.name.includes('Component')) {
          sendToAnalytics({
            name: 'component-render',
            value: entry.duration,
            componentName: entry.name
          });
        }
      }
    });
    
    perfObserver.observe({ entryTypes: ['measure'] });
  }
  
  // メモリ使用量の監視
  if (performance.memory) {
    setInterval(() => {
      const memoryInfo = {
        name: 'memory-usage',
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        usage: performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit
      };
      
      if (memoryInfo.usage > 0.9) {
        console.warn('High memory usage detected:', memoryInfo.usage);
        sendToAnalytics({
          name: 'high-memory-usage',
          value: memoryInfo.usage,
          ...memoryInfo
        });
      }
    }, 30000); // 30秒ごと
  }
}

/**
 * リソースタイミングの監視
 */
function observeResourceTiming() {
  if ('PerformanceObserver' in window) {
    const resourceObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        // 遅いリソースの検出
        if (entry.duration > 1000) {
          sendToAnalytics({
            name: 'slow-resource',
            value: entry.duration,
            resourceName: entry.name,
            resourceType: entry.initiatorType,
            transferSize: entry.transferSize,
            encodedBodySize: entry.encodedBodySize
          });
        }
      }
    });
    
    resourceObserver.observe({ entryTypes: ['resource'] });
  }
}

/**
 * 長時間タスクの監視
 */
function observeLongTasks() {
  if ('PerformanceObserver' in window && 'PerformanceLongTaskTiming' in window) {
    const longTaskObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        sendToAnalytics({
          name: 'long-task',
          value: entry.duration,
          startTime: entry.startTime,
          attribution: entry.attribution
        });
        
        // 開発環境では警告
        if (process.env.NODE_ENV === 'development') {
          console.warn('Long task detected:', entry.duration, 'ms');
        }
      }
    });
    
    longTaskObserver.observe({ entryTypes: ['longtask'] });
  }
}

/**
 * ユーザーインタラクションの追跡
 */
export const trackInteraction = (interactionType, target, metadata = {}) => {
  const interactionData = {
    name: 'user-interaction',
    type: interactionType,
    target: target,
    timestamp: Date.now(),
    ...metadata
  };
  
  sendToAnalytics(interactionData);
};

/**
 * APIレスポンスタイムの計測
 */
export const measureApiCall = async (apiCall, endpoint) => {
  const startTime = performance.now();
  
  try {
    const result = await apiCall();
    const duration = performance.now() - startTime;
    
    sendToAnalytics({
      name: 'api-response-time',
      value: duration,
      endpoint: endpoint,
      status: 'success'
    });
    
    return result;
  } catch (error) {
    const duration = performance.now() - startTime;
    
    sendToAnalytics({
      name: 'api-response-time',
      value: duration,
      endpoint: endpoint,
      status: 'error',
      error: error.message
    });
    
    throw error;
  }
};

/**
 * ページ離脱時のメトリクス送信
 */
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && metricsQueue.length > 0) {
    sendBatch([...metricsQueue]);
    metricsQueue.length = 0;
  }
});

// ページアンロード時の送信
window.addEventListener('pagehide', () => {
  if (metricsQueue.length > 0) {
    sendBatch([...metricsQueue]);
    metricsQueue.length = 0;
  }
});