// E2Eテストのグローバル後処理
async function globalTeardown() {
  console.log('🧹 E2Eテストのグローバル後処理を開始...');

  // テストデータのクリーンアップ
  await cleanupTestData();

  // テスト用リソースのクリーンアップ
  await cleanupTestResources();

  console.log('✅ E2Eテストのグローバル後処理が完了しました');
}

async function cleanupTestData() {
  console.log('🗑️ テストデータのクリーンアップを開始...');

  try {
    // Firebase Emulator のデータクリア
    const clearAuthResponse = await fetch('http://localhost:9099/emulator/v1/projects/demo-project/accounts', {
      method: 'DELETE'
    });

    if (clearAuthResponse.ok) {
      console.log('✅ Firebase Auth Emulator のデータがクリアされました');
    } else {
      console.log('⚠️ Firebase Auth Emulator のデータクリアに失敗しました');
    }

    // Firestore Emulator のデータクリア
    const clearFirestoreResponse = await fetch('http://localhost:8080/emulator/v1/projects/demo-project/databases/(default)/documents', {
      method: 'DELETE'
    });

    if (clearFirestoreResponse.ok) {
      console.log('✅ Firestore Emulator のデータがクリアされました');
    } else {
      console.log('⚠️ Firestore Emulator のデータクリアに失敗しました');
    }

    // バックエンドのテストデータクリア
    try {
      const response = await fetch('http://localhost:3001/api/test/cleanup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'cleanup-test-data'
        })
      });

      if (response.ok) {
        console.log('✅ バックエンドテストデータのクリーンアップが完了');
      } else {
        console.log('⚠️ バックエンドテストデータのクリーンアップに失敗');
      }
    } catch (error) {
      console.log('⚠️ バックエンドテストデータクリーンアップエラー:', error.message);
    }

  } catch (error) {
    console.log('❌ テストデータクリーンアップ中にエラーが発生:', error.message);
  }

  console.log('✅ テストデータのクリーンアップが完了しました');
}

async function cleanupTestResources() {
  console.log('🧽 テスト用リソースのクリーンアップを開始...');

  try {
    // 一時ファイルの削除
    const fs = require('fs').promises;
    const path = require('path');

    const tempDirs = [
      './test-results',
      './screenshots',
      './videos',
      './traces'
    ];

    for (const dir of tempDirs) {
      try {
        const fullPath = path.resolve(dir);
        await fs.rmdir(fullPath, { recursive: true });
        console.log(`✅ 一時ディレクトリを削除: ${dir}`);
      } catch (error) {
        // ディレクトリが存在しない場合は無視
        if (error.code !== 'ENOENT') {
          console.log(`⚠️ ディレクトリ削除失敗: ${dir} - ${error.message}`);
        }
      }
    }

    // ブラウザプロセスの終了確認
    console.log('🔍 ブラウザプロセスの終了確認...');

    // プロセスリストからPlaywrightブラウザを確認
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);

    try {
      const { stdout } = await execPromise('ps aux | grep -E "(chromium|firefox|webkit)" | grep -v grep');
      if (stdout.trim()) {
        console.log('⚠️ 残存するブラウザプロセスが検出されました');
        console.log('手動でプロセスを終了することを検討してください');
      } else {
        console.log('✅ ブラウザプロセスは正常に終了しています');
      }
    } catch (error) {
      // プロセスが見つからない場合（正常）
      console.log('✅ ブラウザプロセスは正常に終了しています');
    }

  } catch (error) {
    console.log('❌ リソースクリーンアップ中にエラーが発生:', error.message);
  }

  console.log('✅ テスト用リソースのクリーンアップが完了しました');
}

// テスト実行統計の出力
function outputTestStatistics() {
  console.log('📊 テスト実行統計:');
  
  // 環境情報
  console.log(`  Node.js バージョン: ${process.version}`);
  console.log(`  プラットフォーム: ${process.platform}`);
  console.log(`  アーキテクチャ: ${process.arch}`);
  
  // メモリ使用量
  const memoryUsage = process.memoryUsage();
  console.log(`  メモリ使用量:`);
  console.log(`    RSS: ${Math.round(memoryUsage.rss / 1024 / 1024)} MB`);
  console.log(`    Heap Used: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`);
  console.log(`    Heap Total: ${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`);
  
  // 実行時間
  const uptime = process.uptime();
  console.log(`  実行時間: ${Math.round(uptime)} 秒`);
}

// 異常終了時の処理
process.on('SIGINT', async () => {
  console.log('\n⚠️ テストが中断されました。クリーンアップを実行中...');
  await globalTeardown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n⚠️ テストが終了されました。クリーンアップを実行中...');
  await globalTeardown();
  process.exit(0);
});

module.exports = globalTeardown;