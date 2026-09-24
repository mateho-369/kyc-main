const express = require('express');
const router = express.Router();
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');

// Swagger定義読み込み
const swaggerDocument = YAML.load(path.join(__dirname, '../../../docs/swagger/swagger.yaml'));

// Swagger UI設定
const swaggerOptions = {
  customCss: `
    .swagger-ui .topbar { display: none }
    .swagger-ui .info { margin: 50px 0 }
    .swagger-ui .scheme-container { background: #fafafa; padding: 20px; border-radius: 5px; }
  `,
  customSiteTitle: 'SafeVideo KYC API Documentation',
  customfavIcon: '/favicon.ico',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
    requestInterceptor: (req) => {
      // APIキーやトークンの自動追加
      if (req.url.includes('/api/v1/')) {
        const token = localStorage.getItem('apiToken');
        if (token) {
          req.headers['Authorization'] = `Bearer ${token}`;
        }
      }
      return req;
    }
  }
};

// API仕様のJSON出力
router.get('/json', (req, res) => {
  res.json(swaggerDocument);
});

// OpenAPI仕様のYAML出力
router.get('/yaml', (req, res) => {
  res.set('Content-Type', 'text/yaml');
  res.send(YAML.stringify(swaggerDocument, 4));
});

// Swagger UI
router.use('/', swaggerUi.serve);
router.get('/', swaggerUi.setup(swaggerDocument, swaggerOptions));

// Redoc版ドキュメント
router.get('/redoc', (req, res) => {
  const html = `
<!DOCTYPE html>
<html>
  <head>
    <title>SafeVideo KYC API Documentation</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
    <style>
      body { margin: 0; padding: 0; }
    </style>
  </head>
  <body>
    <redoc spec-url='${req.protocol}://${req.get('host')}/api/v1/docs/json'></redoc>
    <script src="https://cdn.jsdelivr.net/npm/redoc@2.0.0/bundles/redoc.standalone.js"></script>
  </body>
</html>
  `;
  res.send(html);
});

// APIコレクション（Postman用）
router.get('/postman', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}/api/v1`;
  
  const postmanCollection = {
    info: {
      name: 'SafeVideo KYC API',
      description: swaggerDocument.info.description,
      version: swaggerDocument.info.version,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    auth: {
      type: 'bearer',
      bearer: [
        {
          key: 'token',
          value: '{{authToken}}',
          type: 'string'
        }
      ]
    },
    variable: [
      {
        key: 'baseUrl',
        value: baseUrl,
        type: 'string'
      },
      {
        key: 'authToken',
        value: '',
        type: 'string'
      }
    ],
    item: generatePostmanItems(swaggerDocument, baseUrl)
  };

  res.json(postmanCollection);
});

// cURL例出力
router.get('/curl/:endpoint(*)', (req, res) => {
  const endpoint = req.params.endpoint;
  const baseUrl = `${req.protocol}://${req.get('host')}/api/v1`;
  
  const curlExamples = generateCurlExamples(swaggerDocument, baseUrl, endpoint);
  
  res.json({
    endpoint: `/${endpoint}`,
    examples: curlExamples
  });
});

// API統計情報
router.get('/stats', (req, res) => {
  const stats = {
    apiVersion: swaggerDocument.info.version,
    totalEndpoints: countEndpoints(swaggerDocument),
    endpointsByTag: getEndpointsByTag(swaggerDocument),
    securitySchemes: Object.keys(swaggerDocument.components?.securitySchemes || {}),
    lastUpdated: new Date().toISOString()
  };
  
  res.json(stats);
});

// ヘルスチェック用のAPI情報
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: swaggerDocument.info.version,
    documentation: {
      swagger: `${req.protocol}://${req.get('host')}/api/v1/docs`,
      redoc: `${req.protocol}://${req.get('host')}/api/v1/docs/redoc`,
      json: `${req.protocol}://${req.get('host')}/api/v1/docs/json`,
      yaml: `${req.protocol}://${req.get('host')}/api/v1/docs/yaml`
    }
  });
});

/**
 * Postmanコレクションアイテム生成
 */
function generatePostmanItems(spec, baseUrl) {
  const items = [];
  
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!operation.tags) continue;
      
      const item = {
        name: operation.summary || `${method.toUpperCase()} ${path}`,
        request: {
          method: method.toUpperCase(),
          header: [],
          url: {
            raw: `{{baseUrl}}${path}`,
            host: ['{{baseUrl}}'],
            path: path.split('/').filter(p => p)
          }
        }
      };
      
      // パラメータ処理
      if (operation.parameters) {
        const queryParams = operation.parameters.filter(p => p.in === 'query');
        if (queryParams.length > 0) {
          item.request.url.query = queryParams.map(p => ({
            key: p.name,
            value: p.example || `{{${p.name}}}`,
            disabled: !p.required
          }));
        }
      }
      
      // リクエストボディ処理
      if (operation.requestBody) {
        const content = operation.requestBody.content;
        if (content['application/json']) {
          item.request.header.push({
            key: 'Content-Type',
            value: 'application/json'
          });
          
          const schema = content['application/json'].schema;
          if (schema.example) {
            item.request.body = {
              mode: 'raw',
              raw: JSON.stringify(schema.example, null, 2)
            };
          }
        }
      }
      
      items.push(item);
    }
  }
  
  return items;
}

/**
 * cURL例生成
 */
function generateCurlExamples(spec, baseUrl, endpoint) {
  const examples = [];
  const path = `/${endpoint}`;
  
  if (!spec.paths[path]) {
    return examples;
  }
  
  for (const [method, operation] of Object.entries(spec.paths[path])) {
    const curl = [`curl -X ${method.toUpperCase()}`];
    curl.push(`"${baseUrl}${path}"`);
    curl.push('-H "Authorization: Bearer YOUR_TOKEN"');
    curl.push('-H "Content-Type: application/json"');
    
    if (operation.requestBody?.content?.['application/json']?.schema?.example) {
      const body = JSON.stringify(operation.requestBody.content['application/json'].schema.example);
      curl.push(`-d '${body}'`);
    }
    
    examples.push({
      method: method.toUpperCase(),
      summary: operation.summary,
      curl: curl.join(' \\\n  ')
    });
  }
  
  return examples;
}

/**
 * エンドポイント数カウント
 */
function countEndpoints(spec) {
  let count = 0;
  for (const methods of Object.values(spec.paths || {})) {
    count += Object.keys(methods).length;
  }
  return count;
}

/**
 * タグ別エンドポイント集計
 */
function getEndpointsByTag(spec) {
  const tagCount = {};
  
  for (const methods of Object.values(spec.paths || {})) {
    for (const operation of Object.values(methods)) {
      if (operation.tags) {
        for (const tag of operation.tags) {
          tagCount[tag] = (tagCount[tag] || 0) + 1;
        }
      }
    }
  }
  
  return tagCount;
}

module.exports = router;