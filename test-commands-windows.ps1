# 統合テストコマンド集（Windows PowerShell用）

Write-Host "================================" -ForegroundColor Yellow
Write-Host "KYC-Sharegram統合テスト" -ForegroundColor Yellow
Write-Host "================================" -ForegroundColor Yellow

# APIキーとURL
$API_KEY = "sharegram-api-key-test-2025"
$BASE_URL = "https://stg.id-manager.com"

Write-Host "`n1. ヘルスチェック" -ForegroundColor Yellow
Write-Host "実行中..."
try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/api/v1/integration/health" -Method GET
    Write-Host "レスポンス: $($response | ConvertTo-Json -Compress)"
    if ($response.data.status -eq "healthy") {
        Write-Host "✓ ヘルスチェック成功" -ForegroundColor Green
    } else {
        Write-Host "✗ ヘルスチェック失敗" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ エラー: $_" -ForegroundColor Red
}

Write-Host "`n2. API認証テスト" -ForegroundColor Yellow
Write-Host "実行中..."
$headers = @{
    "Authorization" = "Bearer $API_KEY"
    "X-API-Client" = "sharegram"
}
try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/api/v1/integration/status" -Headers $headers -Method GET
    Write-Host "レスポンス: $($response | ConvertTo-Json -Compress)"
    Write-Host "✓ API認証成功" -ForegroundColor Green
} catch {
    Write-Host "✗ API認証失敗: $_" -ForegroundColor Red
}

Write-Host "`n3. 出演者同期テスト" -ForegroundColor Yellow
Write-Host "テストデータを送信中..."

# 現在時刻をIDに使用（重複を避けるため）
$timestamp = Get-Date -Format "yyyyMMddHHmmss"
$performer_data = @{
    performer = @{
        external_id = "manual_test_$timestamp"
        lastName = "手動"
        firstName = "テスト$timestamp"
        lastNameRoman = "Manual"
        firstNameRoman = "Test$timestamp"
        user_id = "manual_user_$timestamp"
    }
} | ConvertTo-Json

$headers = @{
    "Authorization" = "Bearer $API_KEY"
    "X-API-Client" = "sharegram"
    "Content-Type" = "application/json"
}

try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/api/v1/performers/sync" `
        -Method POST -Headers $headers -Body $performer_data
    Write-Host "レスポンス: $($response | ConvertTo-Json -Compress)"
    Write-Host "✓ 出演者同期成功" -ForegroundColor Green
    Write-Host "作成されたexternal_id: manual_test_$timestamp"
    
    Write-Host "`n4. メタデータ取得テスト" -ForegroundColor Yellow
    Write-Host "実行中..."
    $headers = @{
        "Authorization" = "Bearer $API_KEY"
        "X-API-Client" = "sharegram"
    }
    try {
        $metadata_response = Invoke-RestMethod -Uri "$BASE_URL/api/v1/performers/manual_test_$timestamp/documents/metadata?external_id=true" `
            -Headers $headers -Method GET
        Write-Host "レスポンス: $($metadata_response | ConvertTo-Json -Compress)"
    } catch {
        Write-Host "メタデータ取得エラー: $_" -ForegroundColor Yellow
    }
} catch {
    Write-Host "✗ 出演者同期失敗: $_" -ForegroundColor Red
}

Write-Host "`n================================" -ForegroundColor Yellow
Write-Host "テスト完了" -ForegroundColor Yellow
Write-Host "================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "次のステップ："
Write-Host "1. ブラウザで $BASE_URL にアクセス"
Write-Host "2. 出演者一覧で新しく追加された出演者を確認"
Write-Host "3. 書類をアップロードしてメタデータ取得を再テスト"