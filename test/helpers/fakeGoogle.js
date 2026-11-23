// -----------------------------------------------------------------------------
// A fake Google account for the tests: real protobuf payloads, really
// encrypted locations (with the integration's own key layout), and fake Nova /
// push clients that never touch the network.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { createCipheriv, createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import * as pb from '../../src/google/protobuf.js';
import { decodeDeviceUpdate, decodeDevicesList } from '../../src/google/messages.js';

export const OWNER_KEY = Buffer.alloc(32, 0xc3);
export const IDENTITY_KEY = Buffer.alloc(32, 0xa1);

function encryptGcm(key, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]);
}

/** The encrypted identity key, as Google stores it (60-byte AES-GCM). */
export const ENCRYPTED_IDENTITY_KEY = encryptGcm(OWNER_KEY, IDENTITY_KEY);

/** An "own" report: the Location message encrypted with SHA-256(EIK). */
function ownReport({ latitude, longitude, accuracy = 10, time }) {
  const location = pb.encode([
    [1, 'sfixed32', Math.round(latitude * 1e7)],
    [2, 'sfixed32', Math.round(longitude * 1e7)],
    [3, 'varint', 35],
  ]);
  const key = createHash('sha256').update(IDENTITY_KEY).digest();
  const encrypted = pb.encode([
    [2, 'bytes', encryptGcm(key, location)],
    [3, 'varint', true],
  ]);
  const geo = pb.encode([
    [1, 'message', encrypted],
    [3, 'float', accuracy],
  ]);
  return {
    report: pb.encode([
      [10, 'message', geo],
      [11, 'varint', 1],
    ]),
    time: pb.encode([[1, 'varint', time]]),
  };
}

function semanticReport({ place, time }) {
  return {
    report: pb.encode([[5, 'message', pb.encode([[1, 'string', place]])]]),
    time: pb.encode([[1, 'varint', time]]),
  };
}

/**
 * A DeviceMetadata message.
 * @param {{ canonicId: string, name: string, android?: boolean, model?: string,
 *   reports?: Array<{ latitude?: number, longitude?: number, accuracy?: number,
 *   time: number, place?: string }> }} device
 */
export function deviceMetadata({
  canonicId,
  name,
  android = true,
  model = 'Pixel 8',
  reports = [],
}) {
  const canonicIds = pb.encode([[1, 'message', pb.encode([[1, 'string', canonicId]])]]);
  const identifier = android
    ? pb.encode([
        [1, 'message', pb.encode([[2, 'message', canonicIds]])],
        [2, 'varint', 1],
      ])
    : pb.encode([
        [2, 'varint', 2],
        [3, 'message', canonicIds],
      ]);
  const registration = pb.encode([
    [2, 'message', pb.encode([[2, 'varint', android ? 20 : 3]])],
    [
      19,
      'message',
      pb.encode([
        [1, 'bytes', ENCRYPTED_IDENTITY_KEY],
        [3, 'varint', 1],
      ]),
    ],
    [20, 'string', 'Google'],
    [34, 'string', model],
  ]);
  const built = reports.map((r) => (r.place ? semanticReport(r) : ownReport(r)));
  const information = [[1, 'message', registration]];
  if (built.length > 0) {
    const recent = pb.encode([
      ...built.map((b) => [5, 'message', b.report]),
      ...built.map((b) => [6, 'message', b.time]),
    ]);
    const wrapper = pb.encode([[4, 'message', recent]]);
    information.push([2, 'message', pb.encode([[3, 'message', wrapper]])]);
  }
  return pb.encode([
    [1, 'message', identifier],
    [4, 'message', pb.encode(information)],
    [5, 'string', name],
  ]);
}

export function devicesListBuffer(devices) {
  return pb.encode(devices.map((device) => [2, 'message', deviceMetadata(device)]));
}

export function deviceUpdateBuffer(requestUuid, device) {
  return pb.encode([
    [1, 'message', pb.encode([[2, 'string', requestUuid]])],
    [3, 'message', deviceMetadata(device)],
  ]);
}

/** A secrets.json as GoogleFindMyTools writes it (fake values, real key format). */
export function secretsJson({ ownerKey = OWNER_KEY } = {}) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const der = privateKey.export({ format: 'der', type: 'pkcs8' });
  const secrets = {
    username: 'alice@example.com',
    aas_token: 'aas_et/FAKE',
    fcm_credentials: {
      gcm: { android_id: '4242424242424242424', security_token: '1234567890123456789' },
      fcm: { registration: { token: 'fcm-token-fake' } },
      keys: {
        private: der.toString('base64url'),
        public: 'unused',
        secret: randomBytes(16).toString('base64url'),
      },
    },
  };
  if (ownerKey) secrets.owner_key = ownerKey.toString('hex');
  return JSON.stringify(secrets);
}

/** The push receiver, minus the network. */
export class FakeReceiver extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
  }
  start() {
    this.connected = true;
    this.emit('connected');
  }
  stop() {
    this.connected = false;
  }
}

/**
 * The Nova client, minus the network. `devices` is what the account holds;
 * `answers` decides how a locate is answered (default: the device's own
 * reports, pushed right away).
 */
export class FakeNova {
  constructor(receiver, devices) {
    this.receiver = receiver;
    this.devices = devices;
    this.calls = [];
    this.failWith = null;
    this.answerLocate = true;
  }
  async listDevices() {
    this.calls.push(['list']);
    if (this.failWith) throw this.failWith;
    // Through the real decoder, as the client would.
    return decodeDevicesList(devicesListBuffer(this.devices));
  }
  async locate(canonicId, requestUuid) {
    this.calls.push(['locate', canonicId]);
    if (this.failWith) throw this.failWith;
    const device = this.devices.find((d) => d.canonicId === canonicId);
    if (this.answerLocate && device) {
      const buffer = deviceUpdateBuffer(requestUuid, device);
      // Sanity: the payload decodes to the request it answers.
      if (decodeDeviceUpdate(buffer).requestUuid !== requestUuid) throw new Error('bad fixture');
      setImmediate(() => this.receiver.emit('payload', buffer));
    }
    return requestUuid;
  }
  async sound(canonicId, start) {
    this.calls.push([start ? 'ring' : 'stop', canonicId]);
    if (this.failWith) throw this.failWith;
    return 'uuid';
  }
}

/** An in-memory store. */
export function memoryStore(initial = {}) {
  let saved = initial;
  return {
    load: () => saved,
    save(devices) {
      saved = structuredClone(devices);
    },
    get saved() {
      return saved;
    },
  };
}

/** Timers that never fire on their own (tests call them explicitly). */
export function manualTimers() {
  let next = 1;
  const pending = new Map();
  return {
    setTimeout(fn, ms) {
      const id = next++;
      pending.set(id, { fn, ms, repeat: false });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    setInterval(fn, ms) {
      const id = next++;
      pending.set(id, { fn, ms, repeat: true });
      return id;
    },
    clearInterval(id) {
      pending.delete(id);
    },
    /** Run every pending timer of the given delay once. */
    run(ms) {
      for (const [id, timer] of [...pending]) {
        if (timer.ms !== ms) continue;
        if (!timer.repeat) pending.delete(id);
        timer.fn();
      }
    },
    get pending() {
      return [...pending.values()];
    },
  };
}
