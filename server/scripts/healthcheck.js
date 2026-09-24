#!/usr/bin/env node

/**
 * SafeVideo Health Check Script
 * Used by Docker containers for health monitoring
 */

const http = require('http');
const fs = require('fs');

// Configuration
const PORT = process.env.PORT || 5000;
const HEALTH_ENDPOINT = '/api/health';
const TIMEOUT = 5000; // 5 seconds

// Exit codes
const EXIT_HEALTHY = 0;
const EXIT_UNHEALTHY = 1;

/**
 * Perform HTTP health check
 */
function performHealthCheck() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: PORT,
            path: HEALTH_ENDPOINT,
            method: 'GET',
            timeout: TIMEOUT,
            headers: {
                'User-Agent': 'Docker-HealthCheck/1.0'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    if (res.statusCode === 200) {
                        const response = data.includes('ok') ? { status: 'ok' } : JSON.parse(data);
                        resolve({
                            healthy: true,
                            statusCode: res.statusCode,
                            response: response,
                            timestamp: new Date().toISOString()
                        });
                    } else {
                        reject(new Error(`Health check failed: ${res.statusCode} - ${data}`));
                    }
                } catch (error) {
                    // If not JSON, check for simple "ok" response
                    if (res.statusCode === 200 && data.includes('ok')) {
                        resolve({
                            healthy: true,
                            statusCode: res.statusCode,
                            response: { status: 'ok' },
                            timestamp: new Date().toISOString()
                        });
                    } else {
                        reject(new Error(`Invalid response: ${data}`));
                    }
                }
            });
        });

        req.on('error', (error) => {
            reject(new Error(`Request failed: ${error.message}`));
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Health check timeout after ${TIMEOUT}ms`));
        });

        req.setTimeout(TIMEOUT);
        req.end();
    });
}

/**
 * Check basic system health
 */
function checkSystemHealth() {
    try {
        // Check if app directory is accessible
        const stats = fs.statSync('/app');
        
        // Check memory usage
        const memUsage = process.memoryUsage();
        const maxMemory = 1024 * 1024 * 1024; // 1GB limit
        const memoryUsagePercent = (memUsage.rss / maxMemory) * 100;
        
        if (memoryUsagePercent > 95) {
            throw new Error(`Critical memory usage: ${memoryUsagePercent.toFixed(2)}%`);
        }
        
        return {
            system: 'healthy',
            appPath: '/app',
            accessible: true,
            memory: {
                rss: memUsage.rss,
                heapTotal: memUsage.heapTotal,
                heapUsed: memUsage.heapUsed,
                usagePercent: memoryUsagePercent.toFixed(2)
            }
        };
    } catch (error) {
        throw new Error(`System check failed: ${error.message}`);
    }
}

/**
 * Main health check function
 */
async function healthCheck() {
    console.log('Starting SafeVideo health check...');
    
    try {
        // Perform health checks
        const httpCheck = await performHealthCheck();
        const systemCheck = checkSystemHealth();
        
        console.log('✓ All health checks passed');
        console.log(JSON.stringify({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            checks: {
                http: httpCheck,
                system: systemCheck
            },
            environment: process.env.DEPLOYMENT_ENVIRONMENT || 'unknown',
            version: process.env.VERSION || 'unknown'
        }, null, 2));
        
        process.exit(EXIT_HEALTHY);
        
    } catch (error) {
        console.error('✗ Health check failed:', error.message);
        console.error(JSON.stringify({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: error.message,
            environment: process.env.DEPLOYMENT_ENVIRONMENT || 'unknown',
            version: process.env.VERSION || 'unknown'
        }, null, 2));
        
        process.exit(EXIT_UNHEALTHY);
    }
}

// Handle signals
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, exiting...');
    process.exit(EXIT_UNHEALTHY);
});

process.on('SIGINT', () => {
    console.log('Received SIGINT, exiting...');
    process.exit(EXIT_UNHEALTHY);
});

// Run health check
healthCheck();