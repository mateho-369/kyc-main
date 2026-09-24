-- SafeVideo KYC テストデータベース初期化スクリプト

-- 文字セット設定
SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- テスト用データベースの文字セット確認
ALTER DATABASE safevideo_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- テスト用管理者ユーザー作成
INSERT IGNORE INTO users (
  id, 
  email, 
  password, 
  name, 
  role, 
  status, 
  emailVerified, 
  createdAt, 
  updatedAt
) VALUES (
  1,
  'admin@example.com',
  '$2b$10$rQZ7yE6mE1OQ8xKJaP0eOeKGn6mE1OQ8xKJaP0eOeKGn6mE1OQ8xK', -- AdminPassword123!
  'テスト管理者',
  'admin',
  'active',
  1,
  NOW(),
  NOW()
);

-- テスト用一般ユーザー作成
INSERT IGNORE INTO users (
  id,
  email,
  password,
  name,
  role,
  status,
  emailVerified,
  createdAt,
  updatedAt
) VALUES (
  2,
  'user@example.com',
  '$2b$10$rQZ7yE6mE1OQ8xKJaP0eOeKGn6mE1OQ8xKJaP0eOeKGn6mE1OQ8xK', -- TestPassword123!
  'テストユーザー',
  'user',
  'active',
  1,
  NOW(),
  NOW()
);

-- 負荷テスト用ユーザー作成（50名）
INSERT IGNORE INTO users (email, password, name, role, status, emailVerified, createdAt, updatedAt)
SELECT 
  CONCAT('stress-user-', num, '@example.com'),
  '$2b$10$rQZ7yE6mE1OQ8xKJaP0eOeKGn6mE1OQ8xKJaP0eOeKGn6mE1OQ8xK',
  CONCAT('ストレステストユーザー', num),
  'user',
  'active',
  1,
  NOW(),
  NOW()
FROM (
  SELECT 1 as num UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION
  SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10 UNION
  SELECT 11 UNION SELECT 12 UNION SELECT 13 UNION SELECT 14 UNION SELECT 15 UNION
  SELECT 16 UNION SELECT 17 UNION SELECT 18 UNION SELECT 19 UNION SELECT 20 UNION
  SELECT 21 UNION SELECT 22 UNION SELECT 23 UNION SELECT 24 UNION SELECT 25 UNION
  SELECT 26 UNION SELECT 27 UNION SELECT 28 UNION SELECT 29 UNION SELECT 30 UNION
  SELECT 31 UNION SELECT 32 UNION SELECT 33 UNION SELECT 34 UNION SELECT 35 UNION
  SELECT 36 UNION SELECT 37 UNION SELECT 38 UNION SELECT 39 UNION SELECT 40 UNION
  SELECT 41 UNION SELECT 42 UNION SELECT 43 UNION SELECT 44 UNION SELECT 45 UNION
  SELECT 46 UNION SELECT 47 UNION SELECT 48 UNION SELECT 49 UNION SELECT 50
) AS numbers;

-- テスト用パフォーマーデータ作成（100名）
INSERT IGNORE INTO performers (
  lastName,
  firstName,
  lastNameRoman,
  firstNameRoman,
  email,
  phone,
  birthDate,
  nationality,
  address,
  status,
  verificationStatus,
  notes,
  createdAt,
  updatedAt
)
SELECT 
  CONCAT('テスト', LPAD(num, 3, '0')),
  CONCAT('パフォーマー', num),
  CONCAT('Test', LPAD(num, 3, '0')),
  CONCAT('Performer', num),
  CONCAT('test-performer-', num, '@example.com'),
  CONCAT('090-', LPAD(num, 4, '0'), '-', LPAD(num + 1000, 4, '0')),
  DATE_SUB(CURDATE(), INTERVAL (18 + (num % 30)) YEAR),
  CASE (num % 5)
    WHEN 0 THEN 'Japan'
    WHEN 1 THEN 'USA'
    WHEN 2 THEN 'Korea'
    WHEN 3 THEN 'China'
    ELSE 'Other'
  END,
  CONCAT('東京都渋谷区テスト', num, '-1-1'),
  CASE (num % 4)
    WHEN 0 THEN 'pending'
    WHEN 1 THEN 'active'
    WHEN 2 THEN 'inactive'
    ELSE 'rejected'
  END,
  CASE (num % 3)
    WHEN 0 THEN 'pending'
    WHEN 1 THEN 'verified'
    ELSE 'failed'
  END,
  CONCAT('テストデータ ', num, '番目のパフォーマー'),
  NOW(),
  NOW()
FROM (
  SELECT @row := @row + 1 as num 
  FROM (SELECT 0 UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) t1,
       (SELECT 0 UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) t2
  CROSS JOIN (SELECT @row := 0) r
  LIMIT 100
) AS numbers;

-- テスト用バッチジョブデータ作成
INSERT IGNORE INTO batch_jobs (
  id,
  userId,
  jobType,
  status,
  totalItems,
  processedItems,
  successItems,
  failedItems,
  progress,
  result,
  createdAt,
  updatedAt
) VALUES 
(
  UUID(),
  1,
  'performer_import',
  'completed',
  50,
  50,
  48,
  2,
  100,
  JSON_OBJECT('summary', '50件中48件のインポートが成功しました', 'details', 'テストデータインポート完了'),
  DATE_SUB(NOW(), INTERVAL 1 DAY),
  NOW()
),
(
  UUID(),
  1,
  'user_export',
  'completed',
  100,
  100,
  100,
  0,
  100,
  JSON_OBJECT('summary', '100件のエクスポートが完了しました', 'exportPath', '/exports/users-test.csv'),
  DATE_SUB(NOW(), INTERVAL 2 HOUR),
  NOW()
);

-- テスト用APIログデータ作成（最近50件）
INSERT IGNORE INTO api_logs (
  userId,
  method,
  endpoint,
  requestHeaders,
  responseStatus,
  responseTime,
  ipAddress,
  userAgent,
  apiVersion,
  createdAt
)
SELECT 
  CASE (num % 3) WHEN 0 THEN 1 WHEN 1 THEN 2 ELSE NULL END,
  CASE (num % 4) 
    WHEN 0 THEN 'GET'
    WHEN 1 THEN 'POST'
    WHEN 2 THEN 'PUT'
    ELSE 'DELETE'
  END,
  CASE (num % 6)
    WHEN 0 THEN '/api/v1/performers'
    WHEN 1 THEN '/api/v1/users'
    WHEN 2 THEN '/api/v1/batch/performers'
    WHEN 3 THEN '/api/v1/search/advanced'
    WHEN 4 THEN '/api/auth/login'
    ELSE '/api/auth/me'
  END,
  JSON_OBJECT('user-agent', 'Test-Agent/1.0', 'accept', 'application/json'),
  CASE (num % 10) WHEN 9 THEN 500 WHEN 8 THEN 404 WHEN 7 THEN 400 ELSE 200 END,
  50 + (num % 500),
  CONCAT('192.168.1.', (num % 254) + 1),
  'Test-User-Agent/1.0',
  'v1',
  DATE_SUB(NOW(), INTERVAL num MINUTE)
FROM (
  SELECT @row := @row + 1 as num 
  FROM (SELECT 0 UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) t1,
       (SELECT 0 UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4) t2
  CROSS JOIN (SELECT @row := 0) r
  LIMIT 50
) AS numbers;

-- インデックス確認・作成
CREATE INDEX IF NOT EXISTS idx_performers_status ON performers(status);
CREATE INDEX IF NOT EXISTS idx_performers_email ON performers(email);
CREATE INDEX IF NOT EXISTS idx_performers_created ON performers(createdAt);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_api_logs_created ON api_logs(createdAt);
CREATE INDEX IF NOT EXISTS idx_api_logs_endpoint ON api_logs(endpoint);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON batch_jobs(status);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_user ON batch_jobs(userId);

-- 統計情報更新
ANALYZE TABLE users;
ANALYZE TABLE performers;
ANALYZE TABLE api_logs;
ANALYZE TABLE batch_jobs;

-- 初期化完了ログ
INSERT INTO api_logs (
  method,
  endpoint,
  responseStatus,
  responseTime,
  ipAddress,
  userAgent,
  apiVersion,
  createdAt
) VALUES (
  'SYSTEM',
  'database_init',
  200,
  0,
  '127.0.0.1',
  'MySQL-Init-Script/1.0',
  'system',
  NOW()
);

COMMIT;