/**
 * Test stand-in for the Sharegram webhook receiver.
 *
 * Verifies each request exactly like the Laravel controller documented in
 * docs/sharegram-kyc-webhook.md: HMAC-SHA256 over `${X-KYC-Timestamp}.${raw body}`.
 */
const http = require('http');
const crypto = require('crypto');

const expectedSignature = (secret, timestamp, rawBody) =>
  `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;

/**
 * @param {string} secret - shared KYC_WEBHOOK_SECRET
 * @param {(entry: object, count: number) => number} [respond] - HTTP status per request
 */
const startSharegramReceiver = (secret, respond = () => 200) =>
  new Promise((resolve) => {
    const received = [];
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const expected = expectedSignature(secret, req.headers['x-kyc-timestamp'], rawBody);
        const signature = String(req.headers['x-kyc-signature'] || '');
        const signatureValid =
          signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

        const entry = { method: req.method, headers: req.headers, rawBody, body: JSON.parse(rawBody), signatureValid };
        received.push(entry);

        const status = respond(entry, received.length);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: status < 300 }));
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        received,
        url: `http://127.0.0.1:${port}/v2/kyc/webhook`,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });

const waitFor = async (predicate, timeoutMs = 3000) => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for the webhook');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

module.exports = { startSharegramReceiver, waitFor };
