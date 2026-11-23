import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import * as pb from '../src/google/protobuf.js';
import {
  decodeDevicesList,
  encodeDevicesListRequest,
  encodeLocateRequest,
  encodeSoundRequest,
} from '../src/google/messages.js';
import { decryptAesGcmContent, ecdhFromPrivateKey, fromBase64Url } from '../src/google/ece.js';
import {
  FcmReceiver,
  TAGS,
  createFrameReader,
  encodeLoginRequest,
  frame,
} from '../src/google/fcm.js';
import { createTokenProvider, parseAuthResponse } from '../src/google/auth.js';
import { createNovaClient, NovaError } from '../src/google/nova.js';
import { SecretsError, maskEmail, parseSecrets } from '../src/google/secrets.js';
import { decryptReports, latestPosition } from '../src/google/locations.js';
import { OWNER_KEY, devicesListBuffer, secretsJson } from './helpers/fakeGoogle.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

// --- protobuf ----------------------------------------------------------------

test('protobuf round-trips every kind it writes', () => {
  const buffer = pb.encode([
    [1, 'varint', 300],
    [2, 'string', 'héllo'],
    [3, 'bytes', Buffer.from([1, 2, 3])],
    [4, 'message', pb.encode([[1, 'varint', true]])],
    [5, 'sfixed32', -488566100],
    [6, 'float', 12.5],
    [7, 'varint', -1],
    [8, 'string', undefined],
  ]);
  const fields = pb.decode(buffer);
  assert.equal(pb.uint(fields, 1), 300);
  assert.equal(pb.string(fields, 2), 'héllo');
  assert.deepEqual(pb.bytes(fields, 3), Buffer.from([1, 2, 3]));
  assert.equal(pb.bool(pb.message(fields, 4), 1), true);
  assert.equal(pb.sfixed32(fields, 5), -488566100);
  assert.equal(pb.float(fields, 6), 12.5);
  assert.equal(pb.int32(fields, 7), -1);
  assert.equal(pb.has(fields, 8), false);
  assert.equal(pb.string(fields, 99), '');
});

test('protobuf refuses a truncated message', () => {
  assert.throws(() => pb.decode(Buffer.from([0x12, 0x05, 0x61])), /Truncated/);
  assert.throws(() => pb.decode(Buffer.from([0x08, 0x80])), /Truncated/);
});

test('the locate request carries the device, the request uuid and the FCM token', () => {
  const fields = pb.decode(
    encodeLocateRequest({
      canonicId: 'abc',
      requestUuid: 'r-1',
      clientUuid: 'c-1',
      fcmToken: 'tok',
    }),
  );
  const scope = pb.message(fields, 1);
  assert.equal(pb.uint(scope, 2), 2);
  assert.equal(pb.string(pb.message(pb.message(scope, 3), 1), 1), 'abc');
  const locate = pb.message(pb.message(fields, 2), 30);
  assert.equal(pb.uint(locate, 3), 2);
  const metadata = pb.message(fields, 3);
  assert.equal(pb.string(metadata, 2), 'r-1');
  assert.equal(pb.string(metadata, 3), 'c-1');
  assert.equal(pb.string(pb.message(metadata, 4), 1), 'tok');
  assert.equal(pb.bool(metadata, 6), true);
});

test('ring and stop are the sub-messages 31 and 32, present even empty', () => {
  const options = { canonicId: 'abc', requestUuid: 'r', clientUuid: 'c', fcmToken: 't' };
  const ring = pb.message(pb.decode(encodeSoundRequest({ ...options, start: true })), 2);
  const stop = pb.message(pb.decode(encodeSoundRequest({ ...options, start: false })), 2);
  assert.ok(pb.has(ring, 31) && !pb.has(ring, 32));
  assert.ok(pb.has(stop, 32) && !pb.has(stop, 31));
});

test('the device list request asks for SPOT devices', () => {
  const payload = pb.message(pb.decode(encodeDevicesListRequest('id-1')), 1);
  assert.equal(pb.uint(payload, 1), 2);
  assert.equal(pb.string(payload, 3), 'id-1');
});

test('a device list decodes phones and trackers, reports included', () => {
  const [phone, tag] = decodeDevicesList(
    devicesListBuffer([
      {
        canonicId: 'p1',
        name: 'Phone',
        reports: [
          { latitude: 1.5, longitude: -2.25, accuracy: 8, time: 100 },
          { place: 'Office', time: 200 },
        ],
      },
      { canonicId: 't1', name: 'Keys', android: false, model: 'Tag' },
    ]),
  );
  assert.deepEqual(phone.canonicIds, ['p1']);
  assert.equal(phone.kind, 'phone');
  assert.equal(phone.reports.length, 2);
  assert.deepEqual(tag.canonicIds, ['t1']);
  assert.equal(tag.kind, 'keys');
  assert.equal(tag.model, 'Tag');

  const positions = decryptReports(phone, OWNER_KEY);
  assert.deepEqual(
    positions.map((p) => [p.latitude, p.longitude, p.place]),
    [
      [1.5, -2.25, undefined],
      [undefined, undefined, 'Office'],
    ],
  );
  // The newer semantic report names the place of the newest coordinates.
  assert.equal(latestPosition(positions).place, 'Office');
  assert.equal(latestPosition(positions).latitude, 1.5);
});

// --- Web Push decryption -----------------------------------------------------

// Produced by the reference http_ece library ("aesgcm").
const ECE = {
  private:
    'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgsmQmWNSC29u4h9iOJb7dTJPKzDEBw3FgojTHz6VOYIqhRANCAARC3SkyBakqFA81IkQBYezFuBdd3ONDv1zrpMl1KbUCQMpI7SSfKlAK0x_v465Od8ZUtD8Z3bEXSk0PvLFvemTC',
  secret: 'CK9pW-SOcbS9h-EgsORXsA==',
  cryptoKey:
    'dh=BJL1Z2MdmBog3-q_0LBd2GKOdlMBrfWf7-SlgryNrhFhVqk5zxMiq5PDL2PkdfHMu__AELytA2iHWSlFG45zO0k',
  encryption: 'salt=1qtNKI8tQfLO7PxudsFZkQ',
  raw: 'ecda62a6a1b953485afed86e4da9c2ff66de2aafc71109b12c436eab513e91fd3499b127779cff23133dd71caa0c42a0bf6afc372a6054dfea7121ccc5ceedd0fb9a4e60da5ab6d554585571adef21b0c910cb',
  plaintext: '{"data": {"com.google.android.apps.adm.FCM_PAYLOAD": "CgQSAmlk"}}',
};

test('a Web Push aesgcm message decrypts like http_ece', () => {
  const plain = decryptAesGcmContent({
    ecdh: ecdhFromPrivateKey(ECE.private),
    authSecret: fromBase64Url(ECE.secret),
    senderPublicKey: fromBase64Url(ECE.cryptoKey.slice(3)),
    salt: fromBase64Url(ECE.encryption.slice(5)),
    data: Buffer.from(ECE.raw, 'hex'),
  });
  assert.equal(plain.toString(), ECE.plaintext);
});

// --- MCS ---------------------------------------------------------------------

test('the frame reader copes with messages split across chunks', () => {
  const read = createFrameReader();
  const first = frame(TAGS.LOGIN_RESPONSE, Buffer.from('ab'), true);
  const second = frame(TAGS.HEARTBEAT_PING, Buffer.alloc(0));
  const stream = Buffer.concat([first, second]);
  assert.deepEqual(read(stream.subarray(0, 2)), []);
  const messages = [...read(stream.subarray(2, 5)), ...read(stream.subarray(5))];
  assert.deepEqual(
    messages.map((m) => [m.tag, m.payload.toString()]),
    [
      [TAGS.LOGIN_RESPONSE, 'ab'],
      [TAGS.HEARTBEAT_PING, ''],
    ],
  );
});

test('the login request identifies the push identity', () => {
  const fields = pb.decode(encodeLoginRequest({ androidId: '255', securityToken: 'sec' }, ['p1']));
  assert.equal(pb.string(fields, 3), '255');
  assert.equal(pb.string(fields, 5), 'sec');
  assert.equal(pb.string(fields, 6), 'android-ff');
  assert.deepEqual(pb.strings(fields, 10), ['p1']);
  assert.equal(pb.uint(fields, 16), 2);
});

function fakeSocket() {
  const socket = new PassThrough();
  socket.written = [];
  socket.write = (chunk) => {
    socket.written.push(Buffer.from(chunk));
    return true;
  };
  return socket;
}

test('the receiver logs in, answers pings, acks and decrypts data messages', async () => {
  const socket = fakeSocket();
  const receiver = new FcmReceiver({
    secrets: {
      androidId: '255',
      securityToken: 'sec',
      privateKey: ECE.private,
      authSecret: ECE.secret,
    },
    logger: silent,
    connect: () => socket,
    timers: { setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {} },
  });
  const payloads = [];
  receiver.on('payload', (payload) => payloads.push(payload));
  receiver.start();
  // The first frame carries the protocol version, then the login request.
  assert.equal(socket.written[0][0], 41);
  assert.equal(socket.written[0][1], TAGS.LOGIN_REQUEST);

  const dataMessage = pb.encode([
    [3, 'string', 'google.com/iid'],
    [5, 'string', 'com.google.android.apps.adm'],
    [
      7,
      'message',
      pb.encode([
        [1, 'string', 'crypto-key'],
        [2, 'string', ECE.cryptoKey],
      ]),
    ],
    [
      7,
      'message',
      pb.encode([
        [1, 'string', 'encryption'],
        [2, 'string', ECE.encryption],
      ]),
    ],
    [9, 'string', '0:persistent'],
    [21, 'bytes', Buffer.from(ECE.raw, 'hex')],
  ]);
  socket.emit(
    'data',
    Buffer.concat([
      frame(TAGS.LOGIN_RESPONSE, pb.encode([[1, 'string', 'x']]), true),
      frame(TAGS.HEARTBEAT_PING, Buffer.alloc(0)),
      frame(TAGS.DATA_MESSAGE, dataMessage),
    ]),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(receiver.connected, true);
  assert.deepEqual(payloads, [Buffer.from('CgQSAmlk', 'base64')]);
  const tags = socket.written.slice(1).map((chunk) => chunk[0]);
  assert.deepEqual(tags, [TAGS.HEARTBEAT_ACK, TAGS.IQ_STANZA]);
  receiver.stop();
  assert.equal(receiver.connected, false);
});

test('a refused login reconnects with a backoff instead of crashing', async () => {
  const sockets = [];
  const delays = [];
  const receiver = new FcmReceiver({
    secrets: {
      androidId: '1',
      securityToken: 's',
      privateKey: ECE.private,
      authSecret: ECE.secret,
    },
    logger: silent,
    connect: () => {
      const socket = fakeSocket();
      sockets.push(socket);
      return socket;
    },
    timers: {
      setInterval: () => 0,
      clearInterval() {},
      setTimeout: (fn, ms) => delays.push(ms),
      clearTimeout() {},
    },
  });
  receiver.start();
  sockets[0].emit(
    'data',
    frame(TAGS.LOGIN_RESPONSE, pb.encode([[3, 'message', pb.encode([[1, 'varint', 401]])]]), true),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(receiver.connected, false);
  assert.deepEqual(delays, [5000]);
  receiver.stop();
});

// --- Auth and Nova -----------------------------------------------------------

const SECRETS = { username: 'a@b.c', aasToken: 'aas', androidId: '42' };

test('the token provider exchanges the master token once and caches it', async () => {
  const posts = [];
  let now = 1_000_000;
  const tokens = createTokenProvider(SECRETS, {
    now: () => now,
    post: async (url, { body }) => {
      posts.push({ url, body: new URLSearchParams(body) });
      return {
        status: 200,
        body: Buffer.from(`Auth=tok-${posts.length}\nExpiry=${now / 1000 + 3600}\n`),
      };
    },
  });
  assert.equal(await tokens.getToken(), 'tok-1');
  assert.equal(await tokens.getToken(), 'tok-1');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, 'https://android.clients.google.com/auth');
  assert.equal(posts[0].body.get('EncryptedPasswd'), 'aas');
  assert.equal(posts[0].body.get('app'), 'com.google.android.apps.adm');
  assert.match(posts[0].body.get('service'), /android_device_manager$/);
  now += 3600_000;
  assert.equal(await tokens.getToken(), 'tok-2');
});

test('a refused master token surfaces the Google reason', async () => {
  const tokens = createTokenProvider(SECRETS, {
    post: async () => ({ status: 403, body: Buffer.from('Error=BadAuthentication\n') }),
  });
  await assert.rejects(tokens.getToken(), (err) => err.reason === 'BadAuthentication');
  assert.deepEqual(parseAuthResponse('A=1\nB=x=y\n\n'), { A: '1', B: 'x=y' });
});

test('the Nova client retries once with a fresh token after a 401', async () => {
  const calls = [];
  let invalidated = 0;
  const tokens = { getToken: async () => `t${invalidated}`, invalidate: () => (invalidated += 1) };
  const nova = createNovaClient(tokens, 'fcm', {
    uuid: () => 'u',
    post: async (url, { headers }) => {
      calls.push([url, headers.Authorization]);
      if (calls.length === 1) return { status: 401, body: Buffer.alloc(0) };
      return { status: 200, body: devicesListBuffer([{ canonicId: 'x', name: 'X' }]) };
    },
  });
  const devices = await nova.listDevices();
  assert.equal(devices[0].name, 'X');
  assert.deepEqual(calls, [
    ['https://android.googleapis.com/nova/nbe_list_devices', 'Bearer t0'],
    ['https://android.googleapis.com/nova/nbe_list_devices', 'Bearer t1'],
  ]);
  const failing = createNovaClient(tokens, 'fcm', {
    post: async () => ({ status: 500, body: Buffer.alloc(0) }),
  });
  await assert.rejects(failing.sound('x', true), NovaError);
});

// --- secrets.json ------------------------------------------------------------

test('secrets.json is parsed, with the owner key when present', () => {
  const secrets = parseSecrets(secretsJson());
  assert.equal(secrets.username, 'alice@example.com');
  assert.equal(secrets.fcmToken, 'fcm-token-fake');
  assert.deepEqual(secrets.ownerKey, OWNER_KEY);
  assert.equal(parseSecrets(secretsJson({ ownerKey: null })).ownerKey, null);
  assert.equal(maskEmail('alice@example.com'), 'al***@example.com');
});

test('a bad secrets.json says what is wrong, in every language', () => {
  for (const raw of ['', '{', '[]', JSON.stringify({ username: 'a' })]) {
    assert.throws(
      () => parseSecrets(raw),
      (err) => err instanceof SecretsError && Object.keys(err.userMessage).length === 4,
    );
  }
  assert.throws(() => parseSecrets(JSON.stringify({ username: 'a' })), /aas_token/);
});
