// ブラウザの開発者コンソールで実行するスクリプト
// https://stg.id-manager.com/performers/add にアクセスして、F12で開発者ツールを開き、
// Consoleタブでこのスクリプトを実行してください

console.log("=== 削除ボタンのデバッグ開始 ===");

// 1. 現在のビルドバージョン確認
const scriptTag = document.querySelector('script[src*="main."]');
console.log("1. 現在のビルドファイル:", scriptTag ? scriptTag.src : "見つかりません");

// 2. ファイル入力要素の確認
const fileInputs = document.querySelectorAll('input[type="file"]');
console.log("2. ファイル入力要素の数:", fileInputs.length);

// 3. 削除ボタンの検索
const deleteButtons = document.querySelectorAll('button[type="button"]');
console.log("3. ボタン要素の数:", deleteButtons.length);

// 4. SVGアイコンの検索（削除ボタンのアイコン）
const svgPaths = document.querySelectorAll('path[d*="M19 7l"]');
console.log("4. 削除アイコンSVGの数:", svgPaths.length);

// 5. プレビュー画像の確認
const previewImages = document.querySelectorAll('img[alt="プレビュー"]');
console.log("5. プレビュー画像の数:", previewImages.length);

// 6. 画像がアップロードされているか確認
fileInputs.forEach((input, index) => {
    console.log(`   ファイル入力${index + 1} (${input.name}):`, input.files.length > 0 ? "ファイルあり" : "ファイルなし");
});

console.log("\n=== 対処法 ===");
console.log("1. まず画像をアップロードしてください");
console.log("2. 画像をアップロードすると、サムネイルの右側に削除ボタンが表示されるはずです");
console.log("3. もし表示されない場合は、Ctrl+Shift+R（Mac: Cmd+Shift+R）でハード再読み込みしてください");

// 7. テスト用：画像アップロード後の状態をシミュレート
console.log("\n=== 動的に削除ボタンを確認 ===");
setTimeout(() => {
    const deleteButtons2 = document.querySelectorAll('button[title="削除"]');
    console.log("削除ボタン（title=\"削除\"）の数:", deleteButtons2.length);
    
    if (deleteButtons2.length === 0) {
        console.warn("⚠️ 削除ボタンが見つかりません。画像をアップロードしてから再度確認してください。");
    } else {
        console.log("✅ 削除ボタンが見つかりました！");
    }
}, 1000);