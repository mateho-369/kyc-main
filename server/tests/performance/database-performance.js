import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// データベース性能専用メトリクス
export const dbQueryTime = new Trend('db_query_time');
export const dbErrorRate = new Rate('db_errors');
export const dbConnectionCount = new Counter('db_connections');
export const complexQueryTime = new Trend('complex_query_time');

// データベース集約的なテスト設定
export const options = {
  stages: [
    { duration: '30s', target: 20 },   // DB接続数を徐々に増加
    { duration: '2m', target: 50 },    // 中程度のDB負荷
    { duration: '3m', target: 100 },   // 高いDB負荷
    { duration: '2m', target: 150 },   // 最大DB負荷
    { duration: '30s', target: 0 },    // クールダウン
  ],
  
  thresholds: {
    // データベース性能閾値
    db_query_time: ['p(95)<1000', 'p(99)<2000'],
    complex_query_time: ['p(95)<3000', 'p(99)<5000'],
    db_errors: ['rate<0.02'], // 2%未満
    http_req_duration: ['p(95)<2000'],
  },
  
  // データベース接続設定
  noConnectionReuse: false,
  userAgent: 'K6-DB-Performance-Test/1.0',
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_BASE = `${BASE_URL}/api`;

// データベース集約的な操作のテストデータ
const DB_INTENSIVE_OPERATIONS = [
  // 複雑な検索クエリ
  {
    name: '複合条件検索',
    endpoint: '/v1/search/advanced',
    method: 'POST',
    data: {
      query: 'test',
      filters: {
        status: ['active', 'pending'],
        dateRange: {
          from: '2024-01-01',
          to: '2024-12-31'
        },
        nationality: ['Japan', 'USA']
      },
      sort: { field: 'createdAt', order: 'desc' },
      pagination: { page: 1, limit: 50 },
      aggregations: ['status', 'nationality', 'age_group']
    }
  },
  // 統計クエリ
  {
    name: 'システム統計',
    endpoint: '/v1/analytics/stats',
    method: 'GET',
    params: 'period=month'
  },
  // パフォーマンス統計
  {
    name: 'パフォーマンス統計',
    endpoint: '/v1/analytics/performance',
    method: 'GET',
    params: ''
  },
  // 大量データ一覧取得
  {
    name: '大量データ一覧',
    endpoint: '/v1/performers',
    method: 'GET',
    params: 'page=1&limit=100'
  },
  // JOIN集約的なクエリ
  {
    name: 'ジョブ履歴取得',
    endpoint: '/v1/batch/jobs',
    method: 'GET',
    params: 'page=1&limit=50&include=user,logs'
  }
];

// 大量データ作成用の操作
const BULK_OPERATIONS = [
  {
    name: 'バッチインポート',
    endpoint: '/v1/batch/performers',
    method: 'POST',
    generateData: () => ({
      performers: Array.from({ length: 50 }, (_, i) => ({
        lastName: `DbTest${i}`,
        firstName: `User${i}`,
        lastNameRoman: `DbTest${i}`,
        firstNameRoman: `User${i}`,
        email: `dbtest${i}-${__VU}-${__ITER}@example.com`,
        phone: `090-${String(__VU).padStart(4, '0')}-${String(i).padStart(4, '0')}`,
        birthDate: '1990-01-01',
        nationality: 'Japan'
      })),
      dryRun: false,
      skipDuplicates: true
    })
  },
  {
    name: '一括更新',
    endpoint: '/v1/bulk/update',
    method: 'PUT',
    generateData: () => {
      // ランダムなIDリストを生成（実際の実装では既存IDを取得）
      const ids = Array.from({ length: 10 }, () => Math.floor(Math.random() * 1000) + 1);
      return {
        resourceType: 'performers',
        ids,
        updates: {
          status: 'active',
          notes: `一括更新テスト - ${new Date().toISOString()}`
        }
      };
    }
  }
];

let adminToken = null;

export function setup() {
  console.log('🗄️ データベース性能テスト開始準備');
  
  // 管理者認証
  const loginResponse = http.post(`${API_BASE}/auth/login`, JSON.stringify({
    email: 'admin@example.com',
    password: 'AdminPassword123!'
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
  
  if (loginResponse.status === 200) {
    adminToken = JSON.parse(loginResponse.body).token;
  }
  
  console.log('✅ データベース性能テスト準備完了');
  return { adminToken };
}

export default function(data) {
  const { adminToken } = data;
  
  if (!adminToken) {
    console.error('認証トークンが取得できませんでした');
    dbErrorRate.add(1);
    return;
  }
  
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${adminToken}`,
  };
  
  dbConnectionCount.add(1);
  
  group('複雑なデータベースクエリテスト', function() {
    DB_INTENSIVE_OPERATIONS.forEach(operation => {
      const startTime = Date.now();
      
      let response;
      const url = `${API_BASE}${operation.endpoint}${operation.params ? `?${operation.params}` : ''}`;
      
      if (operation.method === 'POST') {
        response = http.post(url, JSON.stringify(operation.data), {
          headers,
          tags: { 
            endpoint: operation.endpoint,
            operation: operation.name,
            query_type: 'complex'
          }
        });
      } else {
        response = http.get(url, {
          headers,
          tags: { 
            endpoint: operation.endpoint,
            operation: operation.name,
            query_type: 'read'
          }
        });
      }
      
      const queryTime = Date.now() - startTime;
      dbQueryTime.add(queryTime);
      
      if (operation.name.includes('統計') || operation.name.includes('検索')) {
        complexQueryTime.add(queryTime);
      }
      
      const success = check(response, {
        [`${operation.name} - ステータス成功`]: (r) => r.status < 400,
        [`${operation.name} - レスポンス時間 < 3s`]: (r) => r.timings.duration < 3000,
        [`${operation.name} - データ含有`]: (r) => {
          try {
            const body = JSON.parse(r.body);
            return body !== null && typeof body === 'object';
          } catch {
            return false;
          }
        }
      });
      
      if (!success) {
        dbErrorRate.add(1);
      }
      
      // クエリ間の短い間隔
      sleep(0.1);
    });
  });
  
  group('データベース集約処理テスト', function() {
    // 統計情報の複数同時取得（JOIN多用）
    const aggregationRequests = [
      {
        method: 'GET',
        url: `${API_BASE}/v1/analytics/stats?period=week&breakdown=status`,
        params: { headers, tags: { operation: 'weekly_stats' } }
      },
      {
        method: 'GET', 
        url: `${API_BASE}/v1/analytics/stats?period=month&breakdown=nationality`,
        params: { headers, tags: { operation: 'monthly_stats' } }
      },
      {
        method: 'POST',
        url: `${API_BASE}/v1/search/advanced`,
        body: JSON.stringify({
          aggregations: ['status', 'nationality', 'age_group', 'registration_month'],
          pagination: { page: 1, limit: 1 } // 結果は不要、集約のみ
        }),
        params: { headers, tags: { operation: 'multi_aggregation' } }
      }
    ];
    
    const startTime = Date.now();
    const responses = http.batch(aggregationRequests);
    const batchTime = Date.now() - startTime;
    
    complexQueryTime.add(batchTime);
    
    responses.forEach((response, index) => {
      const success = check(response, {
        [`集約処理 ${index + 1} 成功`]: (r) => r.status < 400,
        [`集約処理 ${index + 1} レスポンス時間 < 5s`]: (r) => r.timings.duration < 5000,
      });
      
      if (!success) {
        dbErrorRate.add(1);
      }
    });
    
    sleep(0.5);
  });
  
  // 高負荷時の書き込み操作テスト（頻度を下げる）
  if (Math.random() < 0.3) {
    group('データベース書き込み性能テスト', function() {
      const operation = BULK_OPERATIONS[Math.floor(Math.random() * BULK_OPERATIONS.length)];
      const requestData = operation.generateData();
      
      const startTime = Date.now();
      const response = http.request(operation.method, `${API_BASE}${operation.endpoint}`, 
        JSON.stringify(requestData), {
        headers,
        tags: { 
          endpoint: operation.endpoint,
          operation: operation.name,
          query_type: 'write'
        }
      });
      
      const writeTime = Date.now() - startTime;
      dbQueryTime.add(writeTime);
      
      const success = check(response, {
        [`${operation.name} - 書き込み成功`]: (r) => r.status === 200 || r.status === 201 || r.status === 202,
        [`${operation.name} - 書き込み時間 < 5s`]: (r) => r.timings.duration < 5000,
      });
      
      if (!success) {
        dbErrorRate.add(1);
      }
      
      sleep(1);
    });
  }
  
  group('データベース接続プール テスト', function() {
    // 短時間で大量の軽いクエリを実行（接続プール負荷）
    const lightQueries = Array.from({ length: 5 }, (_, i) => ({
      method: 'GET',
      url: `${API_BASE}/v1/performers?page=${i + 1}&limit=10`,
      params: { 
        headers, 
        tags: { 
          operation: 'connection_pool_test',
          query_index: i 
        } 
      }
    }));
    
    const poolStartTime = Date.now();
    const poolResponses = http.batch(lightQueries);
    const poolTime = Date.now() - poolStartTime;
    
    dbQueryTime.add(poolTime);
    
    poolResponses.forEach((response, index) => {
      const success = check(response, {
        [`接続プール クエリ ${index + 1} 成功`]: (r) => r.status === 200,
        [`接続プール クエリ ${index + 1} 高速応答`]: (r) => r.timings.duration < 500,
      });
      
      if (!success) {
        dbErrorRate.add(1);
      }
    });
    
    sleep(0.2);
  });
  
  // 実際のユーザー行動をシミュレート
  sleep(Math.random() * 1);
}

export function handleSummary(data) {
  console.log('🗄️ データベース性能テスト結果サマリー');
  
  const summary = {
    'データベース性能結果': {
      'DB接続数': data.metrics.db_connections.values.count,
      'DB平均クエリ時間': `${data.metrics.db_query_time.values.avg.toFixed(2)}ms`,
      'DB複雑クエリ時間': `${data.metrics.complex_query_time.values.avg.toFixed(2)}ms`,
      'DB 95%ileクエリ時間': `${data.metrics.db_query_time.values.p95.toFixed(2)}ms`,
      'DB 99%ileクエリ時間': `${data.metrics.db_query_time.values.p99.toFixed(2)}ms`,
      'DB最大クエリ時間': `${data.metrics.db_query_time.values.max.toFixed(2)}ms`,
      'DBエラー率': `${(data.metrics.db_errors.values.rate * 100).toFixed(2)}%`,
    },
    'データベース健全性評価': {
      'クエリ性能': data.metrics.db_query_time.values.p95 < 1000 ? '✅ 良好' : '⚠️ 要改善',
      '複雑クエリ性能': data.metrics.complex_query_time.values.p95 < 3000 ? '✅ 良好' : '⚠️ 要改善',
      'エラー率': data.metrics.db_errors.values.rate < 0.02 ? '✅ 良好' : '❌ 問題あり',
      '総合評価': (
        data.metrics.db_query_time.values.p95 < 1000 && 
        data.metrics.complex_query_time.values.p95 < 3000 && 
        data.metrics.db_errors.values.rate < 0.02
      ) ? '✅ 良好' : '⚠️ 最適化推奨'
    },
    'パフォーマンス推奨事項': generateRecommendations(data)
  };
  
  console.log(JSON.stringify(summary, null, 2));
  
  return {
    'tests/performance/reports/database-performance.json': JSON.stringify(summary, null, 2),
    'tests/performance/reports/database-raw.json': JSON.stringify(data, null, 2),
  };
}

function generateRecommendations(data) {
  const recommendations = [];
  
  if (data.metrics.db_query_time.values.p95 > 1000) {
    recommendations.push('クエリ最適化: インデックスの見直しが必要');
  }
  
  if (data.metrics.complex_query_time.values.p95 > 3000) {
    recommendations.push('複雑クエリ最適化: JOIN文の見直しやデータベース正規化の検討');
  }
  
  if (data.metrics.db_errors.values.rate > 0.02) {
    recommendations.push('エラー率改善: 接続プール設定やタイムアウト値の調整');
  }
  
  if (data.metrics.db_query_time.values.max > 10000) {
    recommendations.push('異常クエリ調査: 10秒を超えるクエリが存在するため調査が必要');
  }
  
  if (recommendations.length === 0) {
    recommendations.push('データベース性能は良好です');
  }
  
  return recommendations;
}

export function teardown(data) {
  console.log('🧹 データベース性能テスト終了処理');
  console.log('✅ データベース性能テスト完了');
}