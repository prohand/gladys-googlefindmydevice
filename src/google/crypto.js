// -----------------------------------------------------------------------------
// Cryptography of the Find Hub network (end-to-end encrypted locations).
//
// Every location Google stores is encrypted for the owner only:
//   owner key (account-wide, from secrets.json)
//     -> decrypts the identity key (EIK) of each device;
//   identity key
//     -> "own" reports (the device reporting itself): AES-256-GCM keyed by
//        SHA-256(EIK);
//     -> crowd-sourced reports (other Android phones that heard a tracker):
//        ECDH on SECP160R1 + HKDF-SHA256 + AES-256-EAX.
//
// Node's crypto has AES, GCM, HKDF and SHA-256, but neither the EAX mode nor
// the SECP160R1 curve: both are written here, small and tested against the
// reference implementation (GoogleFindMyTools, pycryptodome, python-ecdsa).
// -----------------------------------------------------------------------------

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  timingSafeEqual,
} from 'node:crypto';

// --- AES helpers -------------------------------------------------------------

function aesAlgorithm(key, mode) {
  return `aes-${key.length * 8}-${mode}`;
}

/** AES-GCM decryption of `iv (12 bytes) || ciphertext || tag (16 bytes)`. */
export function decryptAesGcm(key, data, additionalData) {
  const iv = data.subarray(0, 12);
  const tag = data.subarray(data.length - 16);
  const ciphertext = data.subarray(12, data.length - 16);
  const decipher = createDecipheriv(aesAlgorithm(key, 'gcm'), key, iv);
  if (additionalData) {
    decipher.setAAD(additionalData);
  }
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** AES-CBC decryption of `iv (16 bytes) || ciphertext`, without padding. */
export function decryptAesCbcNoPadding(key, data) {
  const decipher = createDecipheriv(aesAlgorithm(key, 'cbc'), key, data.subarray(0, 16));
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(data.subarray(16)), decipher.final()]);
}

function aesEcbBlock(key, block) {
  const cipher = createCipheriv(aesAlgorithm(key, 'ecb'), key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

// --- CMAC (RFC 4493) and EAX -------------------------------------------------

function xor(a, b) {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i += 1) {
    out[i] = a[i] ^ b[i];
  }
  return out;
}

// Multiply by x in GF(2^128): the CMAC subkey derivation.
function double(block) {
  const out = Buffer.alloc(16);
  let carry = 0;
  for (let i = 15; i >= 0; i -= 1) {
    out[i] = ((block[i] << 1) | carry) & 0xff;
    carry = block[i] >> 7;
  }
  if (block[0] & 0x80) {
    out[15] ^= 0x87;
  }
  return out;
}

/** AES-CMAC of `message`. */
export function cmac(key, message) {
  const k1 = double(aesEcbBlock(key, Buffer.alloc(16)));
  const k2 = double(k1);
  const blocks = Math.max(1, Math.ceil(message.length / 16));
  const complete = message.length > 0 && message.length % 16 === 0;
  let lastBlock;
  if (complete) {
    lastBlock = xor(message.subarray((blocks - 1) * 16), k1);
  } else {
    const padded = Buffer.alloc(16);
    message.subarray((blocks - 1) * 16).copy(padded);
    padded[message.length - (blocks - 1) * 16] = 0x80;
    lastBlock = xor(padded, k2);
  }
  let state = Buffer.alloc(16);
  for (let i = 0; i < blocks - 1; i += 1) {
    state = aesEcbBlock(key, xor(state, message.subarray(i * 16, i * 16 + 16)));
  }
  return aesEcbBlock(key, xor(state, lastBlock));
}

// OMAC^t(X) = CMAC([t]_128 || X), the tweaked MAC of EAX.
function omac(key, tweak, data) {
  const prefix = Buffer.alloc(16);
  prefix[15] = tweak;
  return cmac(key, Buffer.concat([prefix, data]));
}

/** AES-EAX decryption (16-byte tag, no header), verifying the tag. */
export function decryptAesEax(key, nonce, ciphertext, tag) {
  const n = omac(key, 0, nonce);
  const h = omac(key, 1, Buffer.alloc(0));
  const c = omac(key, 2, ciphertext);
  const expected = xor(xor(n, h), c).subarray(0, tag.length);
  if (tag.length !== 16 || !timingSafeEqual(expected, tag)) {
    throw new Error('AES-EAX authentication failed');
  }
  // EAX counts on the full 128-bit block, like OpenSSL's CTR mode.
  const decipher = createDecipheriv(aesAlgorithm(key, 'ctr'), key, n);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// --- SECP160R1 ---------------------------------------------------------------

/** SEC 2 parameters of secp160r1. */
export const SECP160R1 = {
  p: 0xffffffffffffffffffffffffffffffff7fffffffn,
  a: 0xffffffffffffffffffffffffffffffff7ffffffcn,
  b: 0x1c97befc54bd7a8b65acf89f81d4d4adc565fa45n,
  n: 0x0100000000000000000001f4c8f927aed3ca752257n,
  G: {
    x: 0x4a96b5688ef573284664698968c38bb913cbfc82n,
    y: 0x23a628553168947d59dcc912042351377ac5fb32n,
  },
};

function mod(value, m) {
  const r = value % m;
  return r < 0n ? r + m : r;
}

function modPow(base, exponent, m) {
  let result = 1n;
  let b = mod(base, m);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

function modInverse(value, m) {
  // p is prime: Fermat's little theorem.
  return modPow(value, m - 2n, m);
}

function pointAdd(P, Q) {
  const { p, a } = SECP160R1;
  if (P === null) return Q;
  if (Q === null) return P;
  if (P.x === Q.x) {
    if (mod(P.y + Q.y, p) === 0n) return null;
    const slope = mod((3n * P.x * P.x + a) * modInverse(2n * P.y, p), p);
    const x = mod(slope * slope - 2n * P.x, p);
    return { x, y: mod(slope * (P.x - x) - P.y, p) };
  }
  const slope = mod((Q.y - P.y) * modInverse(Q.x - P.x, p), p);
  const x = mod(slope * slope - P.x - Q.x, p);
  return { x, y: mod(slope * (P.x - x) - P.y, p) };
}

/** Scalar multiplication k·P (double-and-add). */
export function multiply(k, P) {
  let result = null;
  let addend = P;
  let e = k;
  while (e > 0n) {
    if (e & 1n) result = pointAdd(result, addend);
    addend = pointAdd(addend, addend);
    e >>= 1n;
  }
  return result;
}

/** The point of abscissa `x` whose ordinate is even. */
export function liftX(x) {
  const { p, a, b } = SECP160R1;
  const rhs = mod(x * x * x + a * x + b, p);
  // p ≡ 3 (mod 4): the square root is rhs^((p+1)/4).
  let y = modPow(rhs, (p + 1n) / 4n, p);
  if ((y * y) % p !== rhs) {
    throw new Error('Not a valid SECP160R1 abscissa');
  }
  if (y % 2n !== 0n) {
    y = p - y;
  }
  return { x, y };
}

function toBigInt(buffer) {
  return buffer.length === 0 ? 0n : BigInt(`0x${buffer.toString('hex')}`);
}

function toBytes(value, length) {
  return Buffer.from(value.toString(16).padStart(length * 2, '0'), 'hex');
}

// --- Find Hub network --------------------------------------------------------

/** Rotation of the ephemeral ids: 2^10 seconds. */
const K = 10;

/**
 * The ephemeral scalar r of a beacon time counter, as the tracker computed
 * it to advertise (FMDN specification): AES-ECB-256 of a fixed layout around
 * the masked timestamp, reduced modulo n.
 */
export function calculateR(identityKey, timestamp) {
  const masked = Buffer.alloc(4);
  masked.writeUInt32BE(((timestamp >>> 0) & ~((1 << K) - 1)) >>> 0);
  const data = Buffer.alloc(32);
  data.fill(0xff, 0, 11);
  data[11] = K;
  masked.copy(data, 12);
  data[27] = K;
  masked.copy(data, 28);
  return mod(toBigInt(aesEcbBlock(identityKey, data)), SECP160R1.n);
}

/** Decrypt a crowd-sourced report: `encryptedAndTag` is `m' || tag (16)`. */
export function decryptForeignReport(identityKey, encryptedAndTag, publicKeyRandom, timestamp) {
  const r = calculateR(identityKey, timestamp);
  const R = multiply(r, SECP160R1.G);
  const S = liftX(toBigInt(publicKeyRandom));
  const shared = multiply(r, S);
  const key = Buffer.from(
    hkdfSync('sha256', toBytes(shared.x, 20), Buffer.alloc(0), Buffer.alloc(0), 32),
  );
  const nonce = Buffer.concat([toBytes(R.x, 20).subarray(12), toBytes(S.x, 20).subarray(12)]);
  const ciphertext = encryptedAndTag.subarray(0, encryptedAndTag.length - 16);
  const tag = encryptedAndTag.subarray(encryptedAndTag.length - 16);
  return decryptAesEax(key, nonce, ciphertext, tag);
}

/** Decrypt a report the device sent about itself. */
export function decryptOwnReport(identityKey, encryptedLocation) {
  const key = createHash('sha256').update(identityKey).digest();
  return decryptAesGcm(key, encryptedLocation);
}

/** Fast Pair model id of the DIY (ESP32/Zephyr) trackers: their EIK is bit-flipped. */
export const MCU_FAST_PAIR_MODEL_ID = '003200';

/**
 * Decrypt the identity key of a device with the account's owner key: 48
 * bytes are AES-CBC (older devices), 60 bytes AES-GCM.
 */
export function decryptIdentityKey(ownerKey, encryptedIdentityKey, fastPairModelId = '') {
  let data = encryptedIdentityKey;
  if (fastPairModelId === MCU_FAST_PAIR_MODEL_ID) {
    data = Buffer.from(data.map((byte) => byte ^ 0xff));
  }
  if (data.length === 48) {
    return decryptAesCbcNoPadding(ownerKey, data);
  }
  if (data.length === 60) {
    return decryptAesGcm(ownerKey, data);
  }
  throw new Error(`Unexpected identity key length: ${data.length}`);
}
