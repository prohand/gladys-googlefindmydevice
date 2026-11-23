// -----------------------------------------------------------------------------
// Find My Device API ("Nova", android.googleapis.com/nova).
//
// Two endpoints, protobuf in and out:
//   - nbe_list_devices    the devices of the account (and, often, their last
//                         known reports);
//   - nbe_execute_action  locate / ring / stop ringing. The HTTP answer only
//                         acknowledges the order: a location comes back later
//                         through the FCM push channel (see fcm.js), tagged
//                         with the request UUID.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { httpsPost } from './http.js';
import {
  decodeDevicesList,
  encodeDevicesListRequest,
  encodeLocateRequest,
  encodeSoundRequest,
} from './messages.js';

const NOVA_URL = 'https://android.googleapis.com/nova/';

/** An answer of the API other than 200. */
export class NovaError extends Error {
  constructor(scope, status) {
    super(`Find My Device API ${scope} answered HTTP ${status}`);
    this.status = status;
  }
}

/**
 * @param {{ getToken: () => Promise<string>, invalidate: () => void }} tokens
 * @param {string} fcmToken where Google pushes the answers of the actions
 * @param {{ post?: typeof httpsPost, uuid?: () => string }} [deps]
 */
export function createNovaClient(tokens, fcmToken, { post = httpsPost, uuid = randomUUID } = {}) {
  // Identifies this client in the action requests, stable for the session.
  const clientUuid = uuid();

  async function request(scope, body, retry = true) {
    const token = await tokens.getToken();
    const response = await post(NOVA_URL + scope, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Authorization: `Bearer ${token}`,
        'Accept-Language': 'en-US',
        'User-Agent': 'fmd/20006320; gzip',
      },
      body,
    });
    if (response.status === 401 && retry) {
      // The cached token was revoked before its expiry: get a new one once.
      tokens.invalidate();
      return request(scope, body, false);
    }
    if (response.status !== 200) {
      throw new NovaError(scope, response.status);
    }
    return response.body;
  }

  async function action(encode, canonicId, requestUuid, extra = {}) {
    const body = encode({ canonicId, requestUuid, clientUuid, fcmToken, ...extra });
    await request('nbe_execute_action', body);
    return requestUuid;
  }

  return {
    /** The devices of the account, decoded (see messages.decodeDeviceMetadata). */
    async listDevices() {
      return decodeDevicesList(await request('nbe_list_devices', encodeDevicesListRequest(uuid())));
    },
    /**
     * Send a locate order. The push answer carries `requestUuid`: the caller
     * picks it, so it can wait for it BEFORE the order leaves (a fast answer
     * could otherwise arrive before this call resolves).
     */
    locate(canonicId, requestUuid = uuid()) {
      return action(encodeLocateRequest, canonicId, requestUuid);
    },
    /** Make the device ring (`start: true`) or stop (`start: false`). */
    sound(canonicId, start) {
      return action(encodeSoundRequest, canonicId, uuid(), { start });
    },
  };
}
