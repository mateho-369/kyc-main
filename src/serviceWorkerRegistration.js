// Service Worker Registration and Management

const isLocalhost = Boolean(
  window.location.hostname === 'localhost' ||
  window.location.hostname === '[::1]' ||
  window.location.hostname.match(
    /^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/
  )
);

export function register(config) {
  if ('serviceWorker' in navigator) {
    // Production環境またはService Worker有効化フラグが立っている場合
    const shouldRegister = process.env.NODE_ENV === 'production' || 
                          process.env.REACT_APP_ENABLE_SERVICE_WORKER === 'true';

    if (shouldRegister) {
      const publicUrl = new URL(process.env.PUBLIC_URL, window.location.href);
      if (publicUrl.origin !== window.location.origin) {
        // PUBLIC_URLが異なるオリジンの場合はService Workerは動作しない
        return;
      }

      window.addEventListener('load', () => {
        const swUrl = `${process.env.PUBLIC_URL}/service-worker.js`;

        if (isLocalhost) {
          // ローカルホストでの開発時の処理
          checkValidServiceWorker(swUrl, config);
          navigator.serviceWorker.ready.then(() => {
            console.log(
              'このWebアプリはService Workerによってキャッシュされています。' +
              '詳細: https://cra.link/PWA'
            );
          });
        } else {
          // 本番環境での登録
          registerValidSW(swUrl, config);
        }
      });
    }
  }
}

function registerValidSW(swUrl, config) {
  navigator.serviceWorker
    .register(swUrl)
    .then((registration) => {
      // 登録成功
      console.log('Service Worker登録成功:', registration);
      
      // 最終オンラインアクセス時刻を記録
      localStorage.setItem('lastOnlineAccess', Date.now().toString());

      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (installingWorker == null) {
          return;
        }

        installingWorker.onstatechange = () => {
          if (installingWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              // 新しいコンテンツが利用可能
              console.log(
                '新しいコンテンツが利用可能です。' +
                'すべてのタブを閉じた後、更新されます。'
              );

              // 更新通知をユーザーに表示
              if (config && config.onUpdate) {
                config.onUpdate(registration);
              }
            } else {
              // コンテンツがオフライン使用のためにキャッシュされました
              console.log('コンテンツがオフライン使用のためにキャッシュされました。');

              if (config && config.onSuccess) {
                config.onSuccess(registration);
              }
            }
          }
        };
      };
    })
    .catch((error) => {
      console.error('Service Worker登録エラー:', error);
    });
}

function checkValidServiceWorker(swUrl, config) {
  // Service Workerが存在するかチェック
  fetch(swUrl, {
    headers: { 'Service-Worker': 'script' },
  })
    .then((response) => {
      const contentType = response.headers.get('content-type');
      if (
        response.status === 404 ||
        (contentType != null && contentType.indexOf('javascript') === -1)
      ) {
        // Service Workerが見つからない場合は登録解除
        navigator.serviceWorker.ready.then((registration) => {
          registration.unregister().then(() => {
            window.location.reload();
          });
        });
      } else {
        // Service Workerが見つかった場合は登録
        registerValidSW(swUrl, config);
      }
    })
    .catch(() => {
      console.log('インターネット接続がありません。オフラインモードで実行中。');
    });
}

export function unregister() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => {
        registration.unregister();
      })
      .catch((error) => {
        console.error(error.message);
      });
  }
}

// Service Workerの更新を促す
export function promptUpdateServiceWorker() {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
  }
}

// キャッシュをクリア
export function clearServiceWorkerCache() {
  return new Promise((resolve, reject) => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      const messageChannel = new MessageChannel();
      
      messageChannel.port1.onmessage = (event) => {
        if (event.data.type === 'CACHE_CLEARED') {
          resolve();
        }
      };

      navigator.serviceWorker.controller.postMessage(
        { type: 'CLEAR_CACHE' },
        [messageChannel.port2]
      );
    } else {
      reject(new Error('Service Workerが利用できません'));
    }
  });
}

// オンライン/オフライン状態の監視
export function setupNetworkStatusListener(callback) {
  const updateOnlineStatus = () => {
    const status = navigator.onLine ? 'online' : 'offline';
    callback(status);
    
    // オンラインに戻った時の処理
    if (status === 'online') {
      localStorage.setItem('lastOnlineAccess', Date.now().toString());
    }
  };

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  // 初期状態を通知
  updateOnlineStatus();

  // クリーンアップ関数を返す
  return () => {
    window.removeEventListener('online', updateOnlineStatus);
    window.removeEventListener('offline', updateOnlineStatus);
  };
}