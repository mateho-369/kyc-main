/* eslint-disable no-restricted-globals */

// Service Worker Version
const CACHE_VERSION = 'v1.0.0';
const CACHE_NAME = `kyc-id-manager-${CACHE_VERSION}`;
const OFFLINE_CACHE = `kyc-offline-${CACHE_VERSION}`;

// キャッシュ戦略の定義
const CACHE_STRATEGIES = {
  // 静的アセット（スタイルシート、スクリプト、画像）
  STATIC_ASSETS: [
    '/',
    '/index.html',
    '/manifest.json',
    '/favicon.ico',
    '/offline.html'
  ],
  
  // APIエンドポイントのパターン
  API_PATTERNS: [
    /\/api\//
  ],
  
  // キャッシュしないパターン
  NO_CACHE_PATTERNS: [
    /\/auth\//,
    /\/sharegram\/gateway/,
    /\/logout/
  ]
};

// インストールイベント
self.addEventListener('install', (event) => {
  console.log('[Service Worker] インストール中...');
  
  event.waitUntil(
    Promise.all([
      // 静的アセットをプリキャッシュ
      caches.open(CACHE_NAME).then((cache) => {
        console.log('[Service Worker] 静的アセットをキャッシング');
        return cache.addAll(CACHE_STRATEGIES.STATIC_ASSETS);
      }),
      // オフラインページを別キャッシュに保存
      caches.open(OFFLINE_CACHE).then((cache) => {
        return fetch('/offline.html').then((response) => {
          return cache.put('/offline.html', response);
        }).catch(() => {
          // オフラインページがまだない場合は、後で作成
          console.log('[Service Worker] オフラインページは後で追加されます');
        });
      })
    ]).then(() => {
      // すぐにアクティベート
      self.skipWaiting();
    })
  );
});

// アクティベートイベント
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] アクティベート中...');
  
  event.waitUntil(
    // 古いキャッシュをクリーンアップ
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== OFFLINE_CACHE) {
            console.log('[Service Worker] 古いキャッシュを削除:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // すべてのクライアントを制御
      return self.clients.claim();
    })
  );
});

// フェッチイベント（キャッシュ戦略の実装）
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 同一オリジンのリクエストのみ処理
  if (url.origin !== self.location.origin) {
    return;
  }

  // キャッシュしないパターンのチェック
  const shouldNotCache = CACHE_STRATEGIES.NO_CACHE_PATTERNS.some(pattern => 
    pattern.test(url.pathname)
  );
  
  if (shouldNotCache) {
    // 認証関連はネットワークのみ
    event.respondWith(
      fetch(request).catch(() => {
        // 認証エラー時は特別な処理なし
        return new Response('Network error', { status: 503 });
      })
    );
    return;
  }

  // APIリクエストの処理（Network First戦略）
  const isApiRequest = CACHE_STRATEGIES.API_PATTERNS.some(pattern => 
    pattern.test(url.pathname)
  );
  
  if (isApiRequest) {
    event.respondWith(
      networkFirstStrategy(request)
    );
    return;
  }

  // 静的アセットの処理（Cache First戦略）
  event.respondWith(
    cacheFirstStrategy(request)
  );
});

// Cache First戦略
async function cacheFirstStrategy(request) {
  try {
    // キャッシュから探す
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
      // バックグラウンドで更新
      updateCacheInBackground(request);
      return cachedResponse;
    }

    // キャッシュになければネットワークから取得
    const networkResponse = await fetch(request);
    
    // 成功レスポンスをキャッシュ
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // オフラインページを返す
    return getOfflinePage();
  }
}

// Network First戦略
async function networkFirstStrategy(request) {
  try {
    // ネットワークから取得を試みる
    const networkResponse = await fetch(request);
    
    // 成功レスポンスをキャッシュ
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // ネットワークエラー時はキャッシュから
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // APIエラーレスポンス
    return new Response(
      JSON.stringify({
        error: 'オフライン',
        message: 'ネットワーク接続がありません。オンラインになってから再試行してください。'
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// バックグラウンドでキャッシュを更新
function updateCacheInBackground(request) {
  fetch(request).then((response) => {
    if (response.ok) {
      caches.open(CACHE_NAME).then((cache) => {
        cache.put(request, response);
      });
    }
  }).catch(() => {
    // バックグラウンド更新の失敗は無視
  });
}

// オフラインページを取得
async function getOfflinePage() {
  try {
    const cache = await caches.open(OFFLINE_CACHE);
    const offlinePage = await cache.match('/offline.html');
    
    if (offlinePage) {
      return offlinePage;
    }
  } catch (error) {
    console.error('[Service Worker] オフラインページの取得に失敗:', error);
  }
  
  // フォールバック
  return new Response(
    `<!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>オフライン - Id Manager</title>
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
          background: #f5f5f5;
          color: #333;
        }
        .offline-container {
          text-align: center;
          padding: 2rem;
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          max-width: 400px;
        }
        .offline-icon {
          font-size: 4rem;
          margin-bottom: 1rem;
        }
        h1 { color: #2c3e50; margin-bottom: 1rem; }
        p { color: #666; line-height: 1.6; }
        button {
          margin-top: 1.5rem;
          padding: 0.75rem 1.5rem;
          background: #3498db;
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 1rem;
          cursor: pointer;
        }
        button:hover { background: #2980b9; }
      </style>
    </head>
    <body>
      <div class="offline-container">
        <div class="offline-icon">📡</div>
        <h1>オフラインです</h1>
        <p>インターネット接続がありません。<br>接続を確認してから再度お試しください。</p>
        <button onclick="window.location.reload()">再読み込み</button>
      </div>
    </body>
    </html>`,
    {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    }
  );
}

// メッセージイベント（キャッシュ制御）
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((cacheNames) => {
      Promise.all(
        cacheNames.map((cacheName) => caches.delete(cacheName))
      ).then(() => {
        event.ports[0].postMessage({ type: 'CACHE_CLEARED' });
      });
    });
  }
});

console.log('[Service Worker] 読み込み完了');