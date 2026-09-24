import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// カスタムメトリクス定義
export const errorRate = new Rate('errors');
export const responseTime = new Trend('response_time');
export const requestCount = new Counter('requests');

// テスト設定
export const options = {
  stages: [
    { duration: '30s', target: 10 },   // 0→10ユーザーまで30秒で増加
    { duration: '1m', target: 10 },    // 10ユーザーで1分間維持
    { duration: '30s', target: 50 },   // 10→50ユーザーまで30秒で増加
    { duration: '2m', target: 50 },    // 50ユーザーで2分間維持
    { duration: '30s', target: 100 },  // 50→100ユーザーまで30秒で増加
    { duration: '2m', target: 100 },   // 100ユーザーで2分間維持
    { duration: '30s', target: 0 },    // 100→0ユーザーまで30秒で減少
  ],
  
  thresholds: {
    // レスポンス時間の閾値
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    
    // エラー率の閾値
    errors: ['rate<0.05'], // 5%未満
    
    // 成功率の閾値
    http_req_failed: ['rate<0.05'],
    
    // リクエスト数の閾値
    requests: ['count>1000'],
    
    // レスポンス時間詳細
    response_time: ['p(95)<500', 'p(99)<1000'],
  },
  
  // テスト環境設定
  noConnectionReuse: false,
  userAgent: 'K6-LoadTest/1.0',
};

// 環境変数
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_BASE = `${BASE_URL}/api`;

// テストデータ
const TEST_USERS = [
  { email: 'load-test-user1@example.com', password: 'LoadTest123!' },
  { email: 'load-test-user2@example.com', password: 'LoadTest123!' },
  { email: 'admin@example.com', password: 'AdminPassword123!' },
];

const PERFORMER_SAMPLES = [
  {
    lastName: 'Load',
    firstName: 'Test1',
    lastNameRoman: 'Load',
    firstNameRoman: 'Test1',
    email: `loadtest1-${__VU}-${__ITER}@example.com`,
    phone: '090-0000-0001'
  },
  {
    lastName: 'Load',
    firstName: 'Test2',
    lastNameRoman: 'Load',
    firstNameRoman: 'Test2',
    email: `loadtest2-${__VU}-${__ITER}@example.com`,
    phone: '090-0000-0002'
  }
];

// 認証トークン取得
function getAuthToken(userCredentials) {
  const loginResponse = http.post(`${API_BASE}/auth/login`, JSON.stringify(userCredentials), {
    headers: { 'Content-Type': 'application/json' },
  });
  
  if (loginResponse.status !== 200) {
    console.error(`Login failed for ${userCredentials.email}: ${loginResponse.status}`);
    return null;
  }
  
  const loginData = JSON.parse(loginResponse.body);
  return loginData.token;
}

// 認証ヘッダー生成
function getAuthHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

// セットアップ関数
export function setup() {
  console.log('🚀 負荷テスト開始準備');
  
  // 管理者認証
  const adminToken = getAuthToken(TEST_USERS[2]);
  if (!adminToken) {
    throw new Error('管理者認証に失敗しました');
  }
  
  console.log('✅ セットアップ完了');
  return { adminToken };
}

// メインテスト関数
export default function(data) {
  const { adminToken } = data;
  
  // ユーザー選択（ランダム）
  const userIndex = Math.floor(Math.random() * TEST_USERS.length);
  const user = TEST_USERS[userIndex];
  
  group('認証フロー', function() {
    // ログインテスト
    const loginResponse = http.post(`${API_BASE}/auth/login`, JSON.stringify(user), {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'auth/login' },
    });
    
    requestCount.add(1);
    responseTime.add(loginResponse.timings.duration);
    
    const loginSuccess = check(loginResponse, {
      'ログインステータス200': (r) => r.status === 200,
      'レスポンス時間 < 500ms': (r) => r.timings.duration < 500,
      'トークンが含まれる': (r) => {
        try {
          const data = JSON.parse(r.body);
          return data.token !== undefined;
        } catch {
          return false;
        }
      },
    });
    
    if (!loginSuccess) {
      errorRate.add(1);
      return;
    }
    
    const token = JSON.parse(loginResponse.body).token;
    const headers = getAuthHeaders(token);
    
    // プロフィール取得テスト
    const profileResponse = http.get(`${API_BASE}/auth/me`, {
      headers,
      tags: { endpoint: 'auth/me' },
    });
    
    requestCount.add(1);
    responseTime.add(profileResponse.timings.duration);
    
    check(profileResponse, {
      'プロフィール取得成功': (r) => r.status === 200,
      'ユーザー情報が含まれる': (r) => {
        try {
          const data = JSON.parse(r.body);
          return data.email !== undefined;
        } catch {
          return false;
        }
      },
    });
    
    sleep(0.5);
  });
  
  // 管理者のみの操作
  if (user === TEST_USERS[2]) {
    performAdminOperations(adminToken);
  } else {
    performUserOperations(getAuthHeaders(getAuthToken(user)));
  }
}

// 管理者操作
function performAdminOperations(token) {
  const headers = getAuthHeaders(token);
  
  group('パフォーマー管理操作', function() {
    // パフォーマー一覧取得
    const listResponse = http.get(`${API_BASE}/v1/performers?page=1&limit=20`, {
      headers,
      tags: { endpoint: 'performers/list' },
    });
    
    requestCount.add(1);
    responseTime.add(listResponse.timings.duration);
    
    check(listResponse, {
      'パフォーマー一覧取得成功': (r) => r.status === 200,
      'データが配列': (r) => {
        try {
          const data = JSON.parse(r.body);
          return Array.isArray(data.results);
        } catch {
          return false;
        }
      },
    });
    
    // 新規パフォーマー作成
    const performerData = PERFORMER_SAMPLES[Math.floor(Math.random() * PERFORMER_SAMPLES.length)];
    const createResponse = http.post(`${API_BASE}/v1/performers`, JSON.stringify(performerData), {
      headers,
      tags: { endpoint: 'performers/create' },
    });
    
    requestCount.add(1);
    responseTime.add(createResponse.timings.duration);
    
    const createSuccess = check(createResponse, {
      'パフォーマー作成成功': (r) => r.status === 201,
      'IDが返される': (r) => {
        try {
          const data = JSON.parse(r.body);
          return data.id !== undefined;
        } catch {
          return false;
        }
      },
    });
    
    if (createSuccess) {
      const createdPerformer = JSON.parse(createResponse.body);
      
      // 作成したパフォーマーの詳細取得
      const detailResponse = http.get(`${API_BASE}/v1/performers/${createdPerformer.id}`, {
        headers,
        tags: { endpoint: 'performers/detail' },
      });
      
      requestCount.add(1);
      responseTime.add(detailResponse.timings.duration);
      
      check(detailResponse, {
        'パフォーマー詳細取得成功': (r) => r.status === 200,
        '正しいIDが返される': (r) => {
          try {
            const data = JSON.parse(r.body);
            return data.id === createdPerformer.id;
          } catch {
            return false;
          }
        },
      });
    }
    
    sleep(1);
  });
  
  group('バッチ操作', function() {
    // バッチジョブ一覧取得
    const batchListResponse = http.get(`${API_BASE}/v1/batch/jobs?page=1&limit=10`, {
      headers,
      tags: { endpoint: 'batch/jobs/list' },
    });
    
    requestCount.add(1);
    responseTime.add(batchListResponse.timings.duration);
    
    check(batchListResponse, {
      'バッチジョブ一覧取得成功': (r) => r.status === 200,
    });
    
    sleep(0.5);
  });
  
  group('統計情報取得', function() {
    // システム統計取得
    const statsResponse = http.get(`${API_BASE}/v1/analytics/stats?period=week`, {
      headers,
      tags: { endpoint: 'analytics/stats' },
    });
    
    requestCount.add(1);
    responseTime.add(statsResponse.timings.duration);
    
    check(statsResponse, {
      '統計情報取得成功': (r) => r.status === 200,
      '統計データが含まれる': (r) => {
        try {
          const data = JSON.parse(r.body);
          return data.users !== undefined && data.performers !== undefined;
        } catch {
          return false;
        }
      },
    });
    
    // パフォーマンス統計取得
    const perfResponse = http.get(`${API_BASE}/v1/analytics/performance`, {
      headers,
      tags: { endpoint: 'analytics/performance' },
    });
    
    requestCount.add(1);
    responseTime.add(perfResponse.timings.duration);
    
    check(perfResponse, {
      'パフォーマンス統計取得成功': (r) => r.status === 200,
    });
    
    sleep(0.5);
  });
}

// 一般ユーザー操作
function performUserOperations(headers) {
  group('一般ユーザー操作', function() {
    // パフォーマー検索
    const searchData = {
      query: 'test',
      filters: { status: ['active'] },
      pagination: { page: 1, limit: 10 }
    };
    
    const searchResponse = http.post(`${API_BASE}/v1/search/advanced`, JSON.stringify(searchData), {
      headers,
      tags: { endpoint: 'search/advanced' },
    });
    
    requestCount.add(1);
    responseTime.add(searchResponse.timings.duration);
    
    check(searchResponse, {
      '検索実行成功': (r) => r.status === 200,
      '検索結果が含まれる': (r) => {
        try {
          const data = JSON.parse(r.body);
          return data.results !== undefined;
        } catch {
          return false;
        }
      },
    });
    
    // 検索候補取得
    const suggestionsResponse = http.get(`${API_BASE}/v1/search/suggestions?q=te&limit=5`, {
      headers,
      tags: { endpoint: 'search/suggestions' },
    });
    
    requestCount.add(1);
    responseTime.add(suggestionsResponse.timings.duration);
    
    check(suggestionsResponse, {
      '検索候補取得成功': (r) => r.status === 200,
    });
    
    sleep(1);
  });
}

// クリーンアップ関数
export function teardown(data) {
  console.log('🧹 負荷テスト終了処理');
  
  // テスト結果サマリー出力
  console.log(`📊 テスト結果:`);
  console.log(`- 総リクエスト数: ${requestCount.count}`);
  console.log(`- エラー率: ${(errorRate.rate * 100).toFixed(2)}%`);
  console.log(`- 平均レスポンス時間: ${responseTime.avg.toFixed(2)}ms`);
  console.log(`- 95%ile レスポンス時間: ${responseTime.p95.toFixed(2)}ms`);
  console.log(`- 99%ile レスポンス時間: ${responseTime.p99.toFixed(2)}ms`);
  
  console.log('✅ 負荷テスト完了');
}