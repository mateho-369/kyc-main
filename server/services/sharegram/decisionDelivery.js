'use strict';
const axios = require('axios');
const https = require('https');
const dns = require('dns').promises;
const net = require('net');
const { signPayload } = require('./sharegramWebhook');

function config(env = process.env) {
  let url;
  try { url = new URL(env.KYC_DECISION_WEBHOOK_URL); } catch (_) { throw new Error('DECISION_URL_REQUIRED'); }
  const hosts = String(env.KYC_DECISION_WEBHOOK_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search ||
      !hosts.includes(url.hostname.toLowerCase()) || net.isIP(url.hostname)) throw new Error('DECISION_DESTINATION_NOT_ALLOWED');
  const secret = env.KYC_DECISION_WEBHOOK_SECRET;
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) throw new Error('DECISION_SECRET_TOO_SHORT');
  return { url: url.toString(), hostname: url.hostname, secret };
}

// Pin HTTPS connections to a checked public IPv4 address. IPv6-only receivers
// are intentionally unsupported until equivalent address classification exists.
function publicIPv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a,b] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
}
async function send(payload, settings = config()) {
  let agent;
  try {
    const addresses = await dns.lookup(settings.hostname, { all: true, family: 4 });
    if (!addresses.length || addresses.some(x => !publicIPv4(x.address))) return { delivered: false, permanent: true, error: 'UNSAFE_DESTINATION_ADDRESS' };
    const address = addresses[0].address;
    agent = new https.Agent({ lookup: (hostname, options, callback) => {
      if (hostname !== settings.hostname) return callback(new Error('DESTINATION_CHANGED'));
      return options?.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4);
    } });
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await axios.post(settings.url, body, {
      httpsAgent: agent, proxy: false, timeout: 10000, maxRedirects: 0,
      maxContentLength: 65536, maxBodyLength: 65536,
      transformRequest: [x => x], validateStatus: () => true,
      headers: { 'Content-Type': 'application/json', 'X-KYC-Event': payload.eventType,
        'X-KYC-Delivery': payload.eventId, 'X-KYC-Timestamp': timestamp,
        'X-KYC-Signature': signPayload(settings.secret, timestamp, body) }
    });
    return { delivered: response.status >= 200 && response.status < 300,
      permanent: response.status >= 300 && response.status < 500 && response.status !== 429,
      error: `HTTP_${response.status}` };
  } catch (_) {
    // Do not persist axios errors, destination URLs, secrets or response bodies.
    return { delivered: false, permanent: false, error: 'TRANSPORT_ERROR' };
  } finally { agent?.destroy(); }
}
module.exports = { config, publicIPv4, send };
