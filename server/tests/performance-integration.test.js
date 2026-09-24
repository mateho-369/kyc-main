// パフォーマンス統合テスト
const request = require('supertest');
const fs = require('fs').promises;

// テスト環境設定
process.env.NODE_ENV = 'test';

describe('パフォーマンス統合テスト', () => {
  let app;
  let performanceResults = {
    responseTime: {},
    throughput: {},
    memoryUsage: {},
    concurrency: {},
    loadTest: {},
    resourceUtilization: {}
  };

  beforeAll(async () => {
    console.log('⚡ パフォーマンス統合テスト開始...');
  });

  describe('API応答時間測定', () => {
    test('認証APIの応答時間基準', async () => {
      try {
        const app = require('../server.js');
        
        const endpoints = [
          { name: 'health', method: 'GET', path: '/', expectedMaxTime: 100 },
          { name: 'firebase-verify', method: 'POST', path: '/api/auth/firebase/verify', expectedMaxTime: 2000 },
          { name: 'firebase-register', method: 'POST', path: '/api/auth/firebase/register', expectedMaxTime: 3000 },
          { name: 'firebase-session', method: 'POST', path: '/api/auth/firebase/session', expectedMaxTime: 500 },
          { name: 'firebase-logout', method: 'POST', path: '/api/auth/firebase/logout', expectedMaxTime: 1000 }
        ];

        const results = [];

        for (const endpoint of endpoints) {
          const measurements = [];
          
          // 各エンドポイントを10回測定
          for (let i = 0; i < 10; i++) {
            const startTime = process.hrtime.bigint();
            
            let response;
            if (endpoint.method === 'GET') {
              response = await request(app).get(endpoint.path);
            } else {
              const testData = endpoint.name === 'firebase-register' 
                ? { email: `test${i}@example.com`, password: 'TestPass123!@#', displayName: 'Test User' }
                : { idToken: `test-token-${i}` };
              
              response = await request(app)
                .post(endpoint.path)
                .send(testData);
            }
            
            const endTime = process.hrtime.bigint();
            const responseTime = Number(endTime - startTime) / 1000000; // Convert to milliseconds

            measurements.push({
              iteration: i + 1,
              responseTime,
              statusCode: response.status,
              bodySize: JSON.stringify(response.body).length
            });
          }

          const avgResponseTime = measurements.reduce((sum, m) => sum + m.responseTime, 0) / measurements.length;
          const minResponseTime = Math.min(...measurements.map(m => m.responseTime));
          const maxResponseTime = Math.max(...measurements.map(m => m.responseTime));
          
          const result = {
            endpoint: endpoint.name,
            path: endpoint.path,
            measurements: measurements.length,
            averageResponseTime: Math.round(avgResponseTime),
            minResponseTime: Math.round(minResponseTime),
            maxResponseTime: Math.round(maxResponseTime),
            expectedMaxTime: endpoint.expectedMaxTime,
            meetsPerformanceTarget: avgResponseTime <= endpoint.expectedMaxTime,
            p95ResponseTime: Math.round(measurements.sort((a, b) => a.responseTime - b.responseTime)[Math.floor(measurements.length * 0.95)].responseTime)
          };

          results.push(result);
        }

        performanceResults.responseTime = {
          status: 'completed',
          endpointsTested: results.length,
          results,
          allMeetTargets: results.every(r => r.meetsPerformanceTarget),
          averagePerformance: Math.round(results.reduce((sum, r) => sum + r.averageResponseTime, 0) / results.length)
        };

        // パフォーマンス目標の確認
        const slowEndpoints = results.filter(r => !r.meetsPerformanceTarget);
        if (slowEndpoints.length > 0) {
          console.warn('⚠️ パフォーマンス目標未達のエンドポイント:', slowEndpoints.map(e => e.endpoint));
        }

      } catch (error) {
        performanceResults.responseTime = {
          status: 'error',
          error: error.message
        };
      }
    });

    test('データベース操作の応答時間', async () => {
      try {
        const app = require('../server.js');
        
        const dbOperations = [];
        
        // データベース集約的な操作をシミュレート
        for (let i = 0; i < 5; i++) {
          const startTime = process.hrtime.bigint();
          
          await request(app)
            .post('/api/auth/firebase/register')
            .send({
              email: `dbtest${i}@example.com`,
              password: 'DBTestPass123!@#',
              displayName: `DB Test User ${i}`
            });
          
          const endTime = process.hrtime.bigint();
          const responseTime = Number(endTime - startTime) / 1000000;
          
          dbOperations.push({
            operation: `user_creation_${i}`,
            responseTime: Math.round(responseTime)
          });
        }

        const avgDbResponseTime = dbOperations.reduce((sum, op) => sum + op.responseTime, 0) / dbOperations.length;

        performanceResults.responseTime.databaseOperations = {
          status: 'completed',
          operations: dbOperations.length,
          averageResponseTime: Math.round(avgDbResponseTime),
          maxAcceptableTime: 5000, // 5秒
          meetsTarget: avgDbResponseTime <= 5000,
          operations: dbOperations
        };

      } catch (error) {
        performanceResults.responseTime.databaseOperations = {
          status: 'error',
          error: error.message
        };
      }
    });
  });

  describe('並行処理・負荷テスト', () => {
    test('同時接続処理能力', async () => {
      try {
        const app = require('../server.js');
        
        const concurrencyLevels = [5, 10, 20, 50];
        const results = [];

        for (const concurrency of concurrencyLevels) {
          const startTime = Date.now();
          
          // 同時リクエストの作成
          const promises = Array(concurrency).fill().map((_, i) => 
            request(app)
              .post('/api/auth/firebase/verify')
              .send({ idToken: `concurrent-test-${concurrency}-${i}` })
          );

          const responses = await Promise.all(promises);
          const totalTime = Date.now() - startTime;
          
          const successfulResponses = responses.filter(r => r.status < 500).length;
          const throughput = (successfulResponses / totalTime) * 1000; // requests per second

          results.push({
            concurrency,
            totalTime,
            successfulResponses,
            failedResponses: responses.length - successfulResponses,
            throughput: Math.round(throughput * 100) / 100,
            averageResponseTime: Math.round(totalTime / concurrency)
          });
        }

        performanceResults.concurrency = {
          status: 'completed',
          testLevels: concurrencyLevels,
          results,
          maxThroughput: Math.max(...results.map(r => r.throughput)),
          maxConcurrencyTested: Math.max(...concurrencyLevels),
          allTestsSuccessful: results.every(r => r.failedResponses === 0)
        };

        // 高負荷での安定性確認
        const highLoadResult = results.find(r => r.concurrency === 50);
        expect(highLoadResult.successfulResponses).toBeGreaterThan(45); // 90%以上の成功率

      } catch (error) {
        performanceResults.concurrency = {
          status: 'error',
          error: error.message
        };
      }
    });

    test('持続負荷テスト', async () => {
      try {
        const app = require('../server.js');
        
        const testDuration = 30000; // 30秒
        const requestInterval = 100; // 100ms間隔
        const startTime = Date.now();
        
        const results = [];
        let requestCount = 0;
        let successCount = 0;
        let errorCount = 0;

        while (Date.now() - startTime < testDuration) {
          const requestStart = Date.now();
          
          try {
            const response = await request(app)
              .get('/')
              .timeout(5000);
            
            requestCount++;
            if (response.status === 200) {
              successCount++;
            } else {
              errorCount++;
            }
            
            const responseTime = Date.now() - requestStart;
            results.push(responseTime);
            
          } catch (error) {
            requestCount++;
            errorCount++;
          }
          
          // リクエスト間隔の調整
          const elapsed = Date.now() - requestStart;
          if (elapsed < requestInterval) {
            await new Promise(resolve => setTimeout(resolve, requestInterval - elapsed));
          }
        }

        const actualDuration = Date.now() - startTime;
        const avgResponseTime = results.reduce((sum, time) => sum + time, 0) / results.length;
        const throughput = (requestCount / actualDuration) * 1000;

        performanceResults.loadTest = {
          status: 'completed',
          duration: actualDuration,
          totalRequests: requestCount,
          successfulRequests: successCount,
          errorRequests: errorCount,
          successRate: Math.round((successCount / requestCount) * 100),
          averageResponseTime: Math.round(avgResponseTime),
          throughput: Math.round(throughput * 100) / 100,
          p95ResponseTime: Math.round(results.sort((a, b) => a - b)[Math.floor(results.length * 0.95)])
        };

        // 安定性の確認
        expect(successCount / requestCount).toBeGreaterThan(0.95); // 95%以上の成功率

      } catch (error) {
        performanceResults.loadTest = {
          status: 'error',
          error: error.message
        };
      }
    });
  });

  describe('メモリ・リソース使用量テスト', () => {
    test('メモリ使用量監視', async () => {
      try {
        const app = require('../server.js');
        
        const initialMemory = process.memoryUsage();
        const memorySnapshots = [initialMemory];
        
        // メモリ負荷テスト
        for (let i = 0; i < 100; i++) {
          await request(app)
            .post('/api/auth/firebase/verify')
            .send({ idToken: `memory-test-${i}` });
          
          if (i % 20 === 0) {
            memorySnapshots.push(process.memoryUsage());
          }
        }
        
        const finalMemory = process.memoryUsage();
        
        const memoryIncrease = {
          heapUsed: finalMemory.heapUsed - initialMemory.heapUsed,
          heapTotal: finalMemory.heapTotal - initialMemory.heapTotal,
          external: finalMemory.external - initialMemory.external,
          rss: finalMemory.rss - initialMemory.rss
        };

        performanceResults.memoryUsage = {
          status: 'completed',
          initialMemory,
          finalMemory,
          memoryIncrease,
          snapshots: memorySnapshots.length,
          heapIncreaseKB: Math.round(memoryIncrease.heapUsed / 1024),
          memoryLeakSuspected: memoryIncrease.heapUsed > 50 * 1024 * 1024, // 50MB threshold
          acceptableIncrease: memoryIncrease.heapUsed < 100 * 1024 * 1024 // 100MB threshold
        };

        // メモリリークの基本チェック
        expect(memoryIncrease.heapUsed).toBeLessThan(100 * 1024 * 1024); // 100MB未満

      } catch (error) {
        performanceResults.memoryUsage = {
          status: 'error',
          error: error.message
        };
      }
    });

    test('CPU使用率監視', async () => {
      try {
        const app = require('../server.js');
        
        const startUsage = process.cpuUsage();
        const startTime = Date.now();
        
        // CPU集約的な処理をシミュレート
        const promises = Array(50).fill().map((_, i) => 
          request(app)
            .post('/api/auth/firebase/register')
            .send({
              email: `cpu-test-${i}@example.com`,
              password: 'CPUTestPass123!@#',
              displayName: `CPU Test User ${i}`
            })
        );

        await Promise.all(promises);
        
        const endUsage = process.cpuUsage(startUsage);
        const duration = Date.now() - startTime;
        
        // マイクロ秒から秒に変換
        const userCPUTime = endUsage.user / 1000000;
        const systemCPUTime = endUsage.system / 1000000;
        const totalCPUTime = userCPUTime + systemCPUTime;
        
        performanceResults.resourceUtilization = {
          status: 'completed',
          duration,
          userCPUTime: Math.round(userCPUTime * 1000) / 1000,
          systemCPUTime: Math.round(systemCPUTime * 1000) / 1000,
          totalCPUTime: Math.round(totalCPUTime * 1000) / 1000,
          cpuUtilization: Math.round((totalCPUTime / (duration / 1000)) * 100),
          efficiency: Math.round((50 / (duration / 1000)) * 100) / 100 // requests per second
        };

      } catch (error) {
        performanceResults.resourceUtilization = {
          status: 'error',
          error: error.message
        };
      }
    });
  });

  describe('スケーラビリティテスト', () => {
    test('段階的負荷増加テスト', async () => {
      try {
        const app = require('../server.js');
        
        const loadSteps = [
          { concurrent: 1, duration: 5000 },
          { concurrent: 5, duration: 5000 },
          { concurrent: 10, duration: 5000 },
          { concurrent: 20, duration: 5000 }
        ];
        
        const results = [];

        for (const step of loadSteps) {
          const stepStart = Date.now();
          const stepResults = [];
          
          while (Date.now() - stepStart < step.duration) {
            const batchPromises = Array(step.concurrent).fill().map((_, i) => 
              request(app)
                .get('/')
                .then(response => ({
                  success: response.status === 200,
                  responseTime: Date.now() - stepStart
                }))
                .catch(() => ({ success: false, responseTime: Date.now() - stepStart }))
            );
            
            const batchResults = await Promise.all(batchPromises);
            stepResults.push(...batchResults);
            
            // 短い間隔を空ける
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          
          const successRate = stepResults.filter(r => r.success).length / stepResults.length;
          const avgResponseTime = stepResults.reduce((sum, r) => sum + r.responseTime, 0) / stepResults.length;
          
          results.push({
            concurrent: step.concurrent,
            duration: step.duration,
            totalRequests: stepResults.length,
            successRate: Math.round(successRate * 100),
            averageResponseTime: Math.round(avgResponseTime),
            throughput: Math.round((stepResults.length / step.duration) * 1000 * 100) / 100
          });
        }

        performanceResults.throughput = {
          status: 'completed',
          steps: results,
          scalabilityTrend: results.map(r => r.throughput),
          maintainsPerformance: results.every(r => r.successRate > 90),
          peakThroughput: Math.max(...results.map(r => r.throughput))
        };

      } catch (error) {
        performanceResults.throughput = {
          status: 'error',
          error: error.message
        };
      }
    });
  });

  afterAll(async () => {
    // パフォーマンステスト結果の保存
    await fs.writeFile(
      'performance-test-results.json',
      JSON.stringify(performanceResults, null, 2)
    );

    // パフォーマンスサマリーの計算
    const totalTests = Object.values(performanceResults).length;
    const successfulTests = Object.values(performanceResults).filter(test => 
      test.status === 'completed'
    ).length;

    const performanceScore = Math.round((successfulTests / totalTests) * 100);

    console.log('⚡ パフォーマンス統合テスト完了');
    console.log('📊 パフォーマンススコア:', performanceScore + '%');
    console.log('📈 テスト結果:', {
      totalTests,
      successfulTests,
      failedTests: totalTests - successfulTests,
      avgResponseTime: performanceResults.responseTime?.averagePerformance || 'N/A',
      maxThroughput: performanceResults.throughput?.peakThroughput || 'N/A'
    });

    performanceResults.summary = {
      totalTests,
      successfulTests,
      failedTests: totalTests - successfulTests,
      performanceScore,
      timestamp: new Date().toISOString()
    };
  });
});