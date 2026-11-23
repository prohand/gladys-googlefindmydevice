// -----------------------------------------------------------------------------
// Google account tokens.
//
// The master token (`aas_token`) of secrets.json never goes to the Find My
// Device API itself: it is exchanged at android.clients.google.com/auth for a
// short-lived OAuth token of the `android_device_manager` scope, the one the
// Find My Device Android app uses (same app id and signature). The token is
// cached until a minute before its expiry.
// -----------------------------------------------------------------------------

import { httpsPost } from './http.js';

const AUTH_URL = 'https://android.clients.google.com/auth';
const ADM_APP = 'com.google.android.apps.adm';
// SHA-1 of the signing certificate of the Find My Device app.
const ADM_CLIENT_SIG = '38918a453d07199354f8b19af05ec6562ced5788';
const ADM_SCOPE = 'oauth2:https://www.googleapis.com/auth/android_device_manager';

/** Thrown when Google refuses the master token: the user must regenerate it. */
export class AuthError extends Error {
  constructor(reason) {
    super(`Google refused the account token (${reason})`);
    this.reason = reason;
  }
}

/** Parse the `key=value` lines of an auth answer. */
export function parseAuthResponse(text) {
  const result = {};
  for (const line of text.split('\n')) {
    const index = line.indexOf('=');
    if (index > 0) {
      result[line.slice(0, index)] = line.slice(index + 1).trim();
    }
  }
  return result;
}

/**
 * Create the token provider.
 * @param {{ username: string, aasToken: string, androidId: string }} secrets
 * @param {{ post?: typeof httpsPost, now?: () => number }} [deps]
 */
export function createTokenProvider(secrets, { post = httpsPost, now = Date.now } = {}) {
  let cached = null;

  async function requestToken() {
    const form = new URLSearchParams({
      accountType: 'HOSTED_OR_GOOGLE',
      Email: secrets.username,
      has_permission: '1',
      EncryptedPasswd: secrets.aasToken,
      service: ADM_SCOPE,
      source: 'android',
      androidId: secrets.androidId,
      app: ADM_APP,
      client_sig: ADM_CLIENT_SIG,
      device_country: 'us',
      operatorCountry: 'us',
      lang: 'en',
      sdk_version: '17',
      google_play_services_version: '240913000',
    });
    const response = await post(AUTH_URL, {
      headers: {
        'Accept-Encoding': 'identity',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'GoogleAuth/1.4',
      },
      body: form.toString(),
    });
    const fields = parseAuthResponse(response.body.toString('utf8'));
    if (response.status !== 200 || !fields.Auth) {
      // `Error=BadAuthentication`, `NeedsBrowser`... never the token itself.
      throw new AuthError(fields.Error || `HTTP ${response.status}`);
    }
    // `Expiry` is a Unix time in seconds; assume an hour when absent.
    const expiry = Number(fields.Expiry) > 0 ? Number(fields.Expiry) * 1000 : now() + 3600_000;
    return { token: fields.Auth, expiresAt: expiry };
  }

  return {
    /** A valid OAuth token, from the cache when it has at least a minute left. */
    async getToken() {
      if (!cached || cached.expiresAt - 60_000 <= now()) {
        cached = await requestToken();
      }
      return cached.token;
    },
    /** Forget the cached token (after a 401 from the API). */
    invalidate() {
      cached = null;
    },
  };
}
