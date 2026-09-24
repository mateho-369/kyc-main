import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

// ストレステスト専用メトリクス
export const stressErrorRate = new Rate('stress_errors');
export const stressResponseTime = new Trend('stress_response_time');
export const concurrentUsers = new Gauge('concurrent_users');
export const throughput = new Rate('requests_per_second');

// ストレステスト設定（限界まで負荷をかける）
export const options = {
  stages: [
    { duration: '1m', target: 50 },    // ウォームアップ
    { duration: '2m', target: 100 },   // 通常負荷
    { duration: '2m', target: 200 },   // 高負荷
    { duration: '2m', target: 400 },   // 極高負荷
    { duration: '2m', target: 600 },   // 限界負荷
    { duration: '3m', target: 800 },   // ストレス負荷
    { duration: '2m', target: 1000 },  // 最大負荷
    { duration: '1m', target: 0 },     // クールダウン
  ],
  
  thresholds: {
    // ストレステストではより緩い閾値
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    stress_errors: ['rate<0.1'], // 10%未満
    http_req_failed: ['rate<0.1'],
    stress_response_time: ['p(95)<2000'],
  },
  
  // 高負荷設定
  batch: 20,
  batchPerHost: 10,
  noConnectionReuse: false,
  
  // システムリソース設定
  systemTags: ['method', 'status', 'error', 'check', 'error_code', 'tls_version'],
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_BASE = `${BASE_URL}/api`;

// ストレステスト用データセット
const STRESS_TEST_USERS = Array.from({ length: 50 }, (_, i) => ({
  email: `stress-user-${i + 1}@example.com`,
  password: 'StressTest123!'
}));

const BULK_PERFORMER_DATA = Array.from({ length: 100 }, (_, i) => ({
  lastName: `Stress${i}`,
  firstName: `Test${i}`,
  lastNameRoman: `Stress${i}`,
  firstNameRoman: `Test${i}`,
  email: `stress-performer-${i}-${__VU}-${__ITER}@example.com`,
  phone: `090-${String(i).padStart(4, '0')}-${String(__VU).padStart(4, '0')}`,
  birthDate: '1990-01-01',
  nationality: 'Japan'
}));

// 認証トークン管理
let authTokens = new Map();

function getRandomUser() {
  return STRESS_TEST_USERS[Math.floor(Math.random() * STRESS_TEST_USERS.length)];
}

function getCachedToken(userEmail) {
  if (authTokens.has(userEmail)) {
    return authTokens.get(userEmail);
  }
  
  const user = STRESS_TEST_USERS.find(u => u.email === userEmail);
  if (!user) return null;
  
  const loginResponse = http.post(`${API_BASE}/auth/login`, JSON.stringify(user), {
    headers: { 'Content-Type': 'application/json' },
  });
  
  if (loginResponse.status === 200) {
    const token = JSON.parse(loginResponse.body).token;
    authTokens.set(userEmail, token);
    return token;
  }
  
  return null;
}

export function setup() {
  console.log('🔥 ストレステスト開始準備');
  
  // 管理者トークン取得
  const adminResponse = http.post(`${API_BASE}/auth/login`, JSON.stringify({
    email: 'admin@example.com',
    password: 'AdminPassword123!'
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
  
  let adminToken = null;
  if (adminResponse.status === 200) {
    adminToken = JSON.parse(adminResponse.body).token;
  }
  
  console.log('✅ ストレステスト準備完了');
  return { adminToken };
}

export default function(data) {
  concurrentUsers.add(__VU);
  
  const user = getRandomUser();
  const token = getCachedToken(user.email);
  
  if (!token) {
    stressErrorRate.add(1);
    return;
  }
  
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
  
  // 並行してAPIを叩く
  group('高負荷認証テスト', function() {
    const authRequests = [
      ['GET', `${API_BASE}/auth/me`, null],
      ['POST', `${API_BASE}/auth/refresh`, JSON.stringify({ refreshToken: token })],
    ];
    
    const responses = http.batch(authRequests.map(([method, url, body]) => ({
      method,
      url,
      body,
      params: { headers, tags: { endpoint: url.split('/').pop() } }
    })));
    
    responses.forEach((response, index) => {
      throughput.add(1);
      stressResponseTime.add(response.timings.duration);
      
      const isSuccess = check(response, {
        [`認証API ${index + 1} 成功`]: (r) => r.status < 400,
        [`認証API ${index + 1} レスポンス時間 < 2s`]: (r) => r.timings.duration < 2000,
      });
      
      if (!isSuccess) {
        stressErrorRate.add(1);
      }
    });
    
    sleep(0.1);
  });
  
  group('高負荷データ操作テスト', function() {
    // 複数のAPIを同時実行
    const dataRequests = [
      ['GET', `${API_BASE}/v1/performers?page=${Math.floor(Math.random() * 10) + 1}&limit=20`],
      ['POST', `${API_BASE}/v1/search/advanced`, JSON.stringify({
        query: `stress-test-${Math.random().toString(36).substring(7)}`,
        pagination: { page: 1, limit: 10 }
      })],
      ['GET', `${API_BASE}/v1/search/suggestions?q=stress&limit=5`],
    ];
    
    // 管理者の場合は追加で負荷の高い操作
    if (user.email === 'admin@example.com') {
      dataRequests.push(
        ['GET', `${API_BASE}/v1/analytics/stats?period=month`],
        ['GET', `${API_BASE}/v1/analytics/performance`]
      );
    }
    
    const responses = http.batch(dataRequests.map(([method, url, body]) => ({
      method,
      url,
      body,
      params: { headers, tags: { endpoint: url.split('/').slice(-2).join('/') } }
    })));
    
    responses.forEach((response, index) => {
      throughput.add(1);
      stressResponseTime.add(response.timings.duration);
      
      const isSuccess = check(response, {
        [`データAPI ${index + 1} 成功`]: (r) => r.status < 400,
        [`データAPI ${index + 1} レスポンス時間 < 3s`]: (r) => r.timings.duration < 3000,
      });
      
      if (!isSuccess) {
        stressErrorRate.add(1);
      }
    });
    
    sleep(0.2);
  });
  
  // 高負荷時のバッチ処理テスト（管理者のみ）
  if (user.email === 'admin@example.com' && Math.random() < 0.1) {
    group('高負荷バッチ処理テスト', function() {
      const batchData = {
        performers: BULK_PERFORMER_DATA.slice(0, 10), // 10件ずつ
        dryRun: true,
        skipDuplicates: true
      };
      
      const batchResponse = http.post(`${API_BASE}/v1/batch/performers`, JSON.stringify(batchData), {
        headers,
        tags: { endpoint: 'batch/performers' }
      });
      
      throughput.add(1);
      stressResponseTime.add(batchResponse.timings.duration);
      
      const batchSuccess = check(batchResponse, {
        'バッチ処理開始成功': (r) => r.status === 202,
        'ジョブIDが返される': (r) => {
          try {
            const data = JSON.parse(r.body);
            return data.jobId !== undefined;
          } catch {
            return false;
          }
        },
      });
      
      if (!batchSuccess) {
        stressErrorRate.add(1);
      }
      
      sleep(1);
    });
  }
  
  // ランダムな待機時間（実際のユーザー行動をシミュレート）
  sleep(Math.random() * 2);
}

// ストレステスト固有のチェック関数
export function handleSummary(data) {
  console.log('🔥 ストレステスト結果サマリー');
  
  const summary = {
    'ストレステスト結果': {
      '最大同時ユーザー数': data.metrics.concurrent_users.values.max,
      '総リクエスト数': data.metrics.http_reqs.values.count,
      'スループット（req/s）': data.metrics.http_reqs.values.rate,
      'エラー率': `${(data.metrics.stress_errors.values.rate * 100).toFixed(2)}%`,
      '平均レスポンス時間': `${data.metrics.stress_response_time.values.avg.toFixed(2)}ms`,
      '95%ileレスポンス時間': `${data.metrics.stress_response_time.values.p95.toFixed(2)}ms`,
      '99%ileレスポンス時間': `${data.metrics.stress_response_time.values.p99.toFixed(2)}ms`,
      '最大レスポンス時間': `${data.metrics.stress_response_time.values.max.toFixed(2)}ms`,
    },
    'システム負荷評価': {
      '正常動作範囲': data.metrics.stress_errors.values.rate < 0.05 ? '✅' : '❌',
      '許容範囲': data.metrics.stress_errors.values.rate < 0.1 ? '✅' : '❌',
      'レスポンス時間': data.metrics.stress_response_time.values.p95 < 2000 ? '✅' : '❌',
    },
    'パフォーマンス詳細': {
      'HTTPエラー率': `${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)}%`,
      'データ転送量': `${(data.metrics.data_received.values.count / 1024 / 1024).toFixed(2)}MB受信`,
      '接続時間': `${data.metrics.http_req_connecting.values.avg.toFixed(2)}ms`,
      'TLS時間': `${data.metrics.http_req_tls_handshaking.values.avg.toFixed(2)}ms`,
    }
  };
  
  console.log(JSON.stringify(summary, null, 2));
  
  // JSON形式でファイル出力
  return {
    'tests/performance/reports/stress-test-results.json': JSON.stringify(summary, null, 2),
    'tests/performance/reports/stress-test-raw.json': JSON.stringify(data, null, 2),
  };
}

export function teardown(data) {
  console.log('🧹 ストレステスト終了処理');
  
  // メモリクリーンアップ
  authTokens.clear();
  
  console.log('✅ ストレステスト完了');
}