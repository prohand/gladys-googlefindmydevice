// -----------------------------------------------------------------------------
// HTTPS POST helper, on `node:https` rather than the global `fetch`.
//
// Google's account endpoint (android.clients.google.com/auth) answers
// "403 BadAuthentication" to TLS clients that offer ALPN, which undici (the
// engine of `fetch`) always does. `node:https` offers none, like the gpsoauth
// library the reference tools rely on, so every Google call goes through here.
// -----------------------------------------------------------------------------

import https from 'node:https';

/**
 * POST `body` to `url`.
 * @param {string} url
 * @param {{ headers?: Record<string, string>, body: Buffer | string, timeoutMs?: number }} options
 * @returns {Promise<{ status: number, body: Buffer }>}
 */
export function httpsPost(url, { headers = {}, body, timeoutMs = 30_000 }) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const request = https.request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': payload.length },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }),
        );
        response.on('error', reject);
      },
    );
    request.on('timeout', () =>
      request.destroy(new Error(`Request to ${new URL(url).host} timed out`)),
    );
    request.on('error', reject);
    request.end(payload);
  });
}
