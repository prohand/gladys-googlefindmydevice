// -----------------------------------------------------------------------------
// FCM push receiver (MCS protocol, mtalk.google.com:5228).
//
// Find My Device answers a locate order by PUSHING the location to the FCM
// token given in the order, like it would to the Android app. This module
// keeps that channel open with the push identity of secrets.json:
//   1. TLS connection, then a LoginRequest (android_id + security_token);
//   2. framed protobuf messages both ways: [version (first message only)]
//      [tag] [varint size] [payload];
//   3. answers the server heartbeats, sends its own every few minutes and
//      reconnects (with backoff) when the line goes quiet or drops;
//   4. decrypts each data message (Web Push "aesgcm", see ece.js) and emits
//      the Find My Device payload, a DeviceUpdate protobuf.
// Tags and fields: mcs.proto of the Chromium GCM client.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import tls from 'node:tls';
import * as pb from './protobuf.js';
import { decryptAesGcmContent, ecdhFromPrivateKey, fromBase64Url } from './ece.js';

const MCS_HOST = 'mtalk.google.com';
const MCS_PORT = 5228;
const MCS_VERSION = 41;
// Same client id as the reference implementation (firebase-messaging).
const CHROME_VERSION = '94.0.4606.51';

export const TAGS = {
  HEARTBEAT_PING: 0,
  HEARTBEAT_ACK: 1,
  LOGIN_REQUEST: 2,
  LOGIN_RESPONSE: 3,
  CLOSE: 4,
  IQ_STANZA: 7,
  DATA_MESSAGE: 8,
};

const SELECTIVE_ACK_EXTENSION = 12;
const FMD_PAYLOAD_KEY = 'com.google.android.apps.adm.FCM_PAYLOAD';

const HEARTBEAT_INTERVAL_MS = 5 * 60_000;
// Nothing received for this long (our own pings get answers): the line is dead.
const IDLE_TIMEOUT_MS = 2 * HEARTBEAT_INTERVAL_MS + 60_000;
const BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];

/** Frame one message: [version] tag size payload. */
export function frame(tag, payload, withVersion = false) {
  const header = withVersion ? Buffer.from([MCS_VERSION, tag]) : Buffer.from([tag]);
  return Buffer.concat([header, pb.encodeVarint(payload.length), payload]);
}

/** The LoginRequest of a push identity. */
export function encodeLoginRequest({ androidId, securityToken }, persistentIds = []) {
  return pb.encode([
    [1, 'string', CHROME_VERSION],
    [2, 'string', 'mcs.android.com'],
    [3, 'string', androidId],
    [4, 'string', androidId],
    [5, 'string', securityToken],
    [6, 'string', `android-${BigInt(androidId).toString(16)}`],
    [
      8,
      'message',
      pb.encode([
        [1, 'string', 'new_vc'],
        [2, 'string', '1'],
      ]),
    ],
    ...persistentIds.map((id) => [10, 'string', id]),
    [12, 'varint', false],
    [14, 'varint', true],
    [16, 'varint', 2], // AuthService.ANDROID_ID
    [17, 'varint', 1], // network_type
  ]);
}

/** Acknowledge one received message, so the server does not deliver it again. */
export function encodeSelectiveAck(persistentId) {
  const ack = pb.encode([[1, 'string', persistentId]]);
  return pb.encode([
    [2, 'varint', 1], // IqType.SET
    [3, 'string', ''],
    [
      7,
      'message',
      pb.encode([
        [1, 'varint', SELECTIVE_ACK_EXTENSION],
        [2, 'bytes', ack],
      ]),
    ],
  ]);
}

/**
 * Incremental frame reader: feed it socket chunks, it returns the complete
 * messages (`{ tag, payload }`) and keeps the rest for the next chunk.
 */
export function createFrameReader() {
  let buffer = Buffer.alloc(0);
  let expectVersion = true;
  return function read(chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    const messages = [];
    for (;;) {
      let offset = 0;
      if (expectVersion) {
        if (buffer.length < 1) break;
        const version = buffer[0];
        if (version < MCS_VERSION && version !== 38) {
          throw new Error(`Unsupported MCS protocol version ${version}`);
        }
        offset = 1;
      }
      if (buffer.length < offset + 1) break;
      const tag = buffer[offset];
      let size;
      try {
        size = pb.readVarint(buffer, offset + 1);
      } catch {
        break; // the size itself is not complete yet
      }
      const end = size.offset + Number(size.value);
      if (buffer.length < end) break;
      messages.push({ tag, payload: buffer.subarray(size.offset, end) });
      buffer = buffer.subarray(end);
      expectVersion = false;
    }
    return messages;
  };
}

function appData(fields) {
  const result = {};
  for (const entry of pb.messages(fields, 7)) {
    result[pb.string(entry, 1)] = pb.string(entry, 2);
  }
  return result;
}

/**
 * The push receiver. Events: `connected`, `disconnected` (error?), `payload`
 * (Buffer: a DeviceUpdate protobuf), `error` is never emitted (logged).
 */
export class FcmReceiver extends EventEmitter {
  /**
   * @param {object} options
   * @param {{ androidId: string, securityToken: string, privateKey: string, authSecret: string }} options.secrets
   * @param {object} options.logger
   * @param {() => import('node:stream').Duplex} [options.connect] opens the socket (tests)
   * @param {{ setTimeout: Function, clearTimeout: Function, setInterval: Function, clearInterval: Function }} [options.timers]
   */
  constructor({ secrets, logger, connect, timers = globalThis }) {
    super();
    this.secrets = secrets;
    this.logger = logger;
    this.connectSocket =
      connect ?? (() => tls.connect({ host: MCS_HOST, port: MCS_PORT, servername: MCS_HOST }));
    this.timers = timers;
    this.ecdh = ecdhFromPrivateKey(secrets.privateKey);
    this.authSecret = fromBase64Url(secrets.authSecret);
    this.persistentIds = [];
    this.connected = false;
    this.running = false;
    this.failures = 0;
    this.socket = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.open();
  }

  stop() {
    this.running = false;
    this.timers.clearTimeout(this.retryTimer);
    this.close();
  }

  open() {
    const socket = this.connectSocket();
    this.socket = socket;
    const read = createFrameReader();
    this.firstWrite = true;
    socket.on('connect', () => this.logger.debug('MCS socket connected'));
    socket.on('secureConnect', () => this.logger.debug('MCS TLS established'));
    socket.on('data', (chunk) => {
      this.lastReceived = Date.now();
      let messages;
      try {
        messages = read(chunk);
      } catch (err) {
        this.logger.warn(`MCS stream error: ${err.message}`);
        this.reconnect(err);
        return;
      }
      for (const message of messages) {
        this.handle(message).catch((err) =>
          this.logger.warn(`MCS message ${message.tag} not handled: ${err.message}`),
        );
      }
    });
    socket.on('error', (err) => this.reconnect(err));
    socket.on('close', () => this.reconnect());
    this.send(TAGS.LOGIN_REQUEST, encodeLoginRequest(this.secrets, this.persistentIds));
    this.lastReceived = Date.now();
    this.heartbeat = this.timers.setInterval(() => this.tick(), HEARTBEAT_INTERVAL_MS);
  }

  send(tag, payload) {
    if (!this.socket || this.socket.destroyed) return;
    this.socket.write(frame(tag, payload, this.firstWrite));
    this.firstWrite = false;
  }

  tick() {
    if (Date.now() - this.lastReceived > IDLE_TIMEOUT_MS) {
      this.logger.warn('MCS connection silent for too long, reconnecting');
      this.reconnect(new Error('idle'));
      return;
    }
    this.send(TAGS.HEARTBEAT_PING, Buffer.alloc(0));
  }

  close() {
    this.timers.clearInterval(this.heartbeat);
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners();
      socket.on('error', () => {});
      socket.destroy();
    }
    if (this.connected) {
      this.connected = false;
      this.emit('disconnected');
    }
  }

  reconnect(err) {
    if (!this.socket) return; // already closing
    this.close();
    if (!this.running) return;
    const delay = BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)];
    this.failures += 1;
    this.logger.info(
      `MCS connection lost${err ? ` (${err.message})` : ''}, retrying in ${delay / 1000} s`,
    );
    this.retryTimer = this.timers.setTimeout(() => {
      if (this.running) this.open();
    }, delay);
  }

  async handle({ tag, payload }) {
    switch (tag) {
      case TAGS.LOGIN_RESPONSE: {
        const fields = pb.decode(payload);
        if (pb.has(fields, 3)) {
          const error = pb.message(fields, 3);
          this.logger.error(`MCS login refused (code ${pb.uint(error, 1)})`);
          this.reconnect(new Error('login refused'));
          return;
        }
        this.logger.info('Connected to the Google push channel');
        this.connected = true;
        this.failures = 0;
        this.persistentIds = [];
        this.emit('connected');
        return;
      }
      case TAGS.HEARTBEAT_PING:
        this.send(TAGS.HEARTBEAT_ACK, Buffer.alloc(0));
        return;
      case TAGS.CLOSE:
        this.reconnect(new Error('closed by server'));
        return;
      case TAGS.DATA_MESSAGE:
        this.handleData(pb.decode(payload));
        return;
      default:
        // Heartbeat acks, iq stanzas: nothing to do.
        return;
    }
  }

  handleData(fields) {
    const persistentId = pb.string(fields, 9);
    if (persistentId) {
      this.persistentIds.push(persistentId);
      this.send(TAGS.IQ_STANZA, encodeSelectiveAck(persistentId));
    }
    const data = appData(fields);
    let encoded = data[FMD_PAYLOAD_KEY];
    const raw = pb.bytes(fields, 21);
    if (!encoded && raw.length > 0 && data['crypto-key'] && data.encryption) {
      const plain = decryptAesGcmContent({
        ecdh: this.ecdh,
        authSecret: this.authSecret,
        senderPublicKey: fromBase64Url(data['crypto-key'].replace(/^dh=/, '')),
        salt: fromBase64Url(data.encryption.replace(/^salt=/, '')),
        data: raw,
      });
      const json = JSON.parse(plain.toString('utf8'));
      encoded = json?.data?.[FMD_PAYLOAD_KEY];
    }
    if (!encoded) {
      this.logger.debug('Push message without Find My Device payload, ignored');
      return;
    }
    this.emit('payload', Buffer.from(encoded, 'base64'));
  }
}
