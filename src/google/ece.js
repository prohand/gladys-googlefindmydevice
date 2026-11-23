// -----------------------------------------------------------------------------
// Web Push message decryption, "aesgcm" content encoding
// (draft-ietf-webpush-encryption-04), the one FCM uses for the data messages
// delivered over MCS.
//
//   shared = ECDH(our P-256 private key, sender public key `dh`)
//   ikm    = HKDF(salt = auth secret, shared, "Content-Encoding: auth\0", 32)
//   ctx    = "P-256\0" || len(ours) || ours || len(theirs) || theirs
//   key    = HKDF(salt, ikm, "Content-Encoding: aesgcm\0" || ctx, 16)
//   nonce  = HKDF(salt, ikm, "Content-Encoding: nonce\0"  || ctx, 12)
// Each 4096-byte record (+16-byte tag) is AES-128-GCM with nonce XOR its
// index, and starts with a 2-byte padding length.
// -----------------------------------------------------------------------------

import { createDecipheriv, createECDH, createPrivateKey, hkdfSync } from 'node:crypto';

const RECORD_SIZE = 4096;
const TAG_LENGTH = 16;

/** Decode base64url with or without padding. */
export function fromBase64Url(value) {
  return Buffer.from(String(value).replace(/=+$/, ''), 'base64url');
}

function hkdf(salt, ikm, info, length) {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length));
}

function lengthPrefixed(buffer) {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(buffer.length);
  return Buffer.concat([length, buffer]);
}

/**
 * Turn the `keys.private` of FCM credentials (base64url PKCS#8 DER, as
 * GoogleFindMyTools stores it) into an ECDH object ready to compute secrets.
 */
export function ecdhFromPrivateKey(privateKeyBase64Url) {
  const der = fromBase64Url(privateKeyBase64Url);
  let keyObject;
  try {
    keyObject = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  } catch {
    keyObject = createPrivateKey({ key: der, format: 'der', type: 'sec1' });
  }
  const { d } = keyObject.export({ format: 'jwk' });
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(d, 'base64url'));
  return ecdh;
}

/**
 * Decrypt the `raw_data` of an FCM data message.
 * @param {object} options
 * @param {import('node:crypto').ECDH} options.ecdh our key pair
 * @param {Buffer} options.authSecret the 16-byte auth secret
 * @param {Buffer} options.senderPublicKey the `dh` of the crypto-key header
 * @param {Buffer} options.salt the `salt` of the encryption header
 * @param {Buffer} options.data the encrypted records
 */
export function decryptAesGcmContent({ ecdh, authSecret, senderPublicKey, salt, data }) {
  const shared = ecdh.computeSecret(senderPublicKey);
  const ikm = hkdf(authSecret, shared, Buffer.from('Content-Encoding: auth\0'), 32);
  const context = Buffer.concat([
    Buffer.from('P-256\0'),
    lengthPrefixed(ecdh.getPublicKey()),
    lengthPrefixed(senderPublicKey),
  ]);
  const key = hkdf(
    salt,
    ikm,
    Buffer.concat([Buffer.from('Content-Encoding: aesgcm\0'), context]),
    16,
  );
  const nonce = hkdf(
    salt,
    ikm,
    Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), context]),
    12,
  );

  const chunks = [];
  for (
    let start = 0, index = 0;
    start < data.length;
    start += RECORD_SIZE + TAG_LENGTH, index += 1
  ) {
    const record = data.subarray(start, start + RECORD_SIZE + TAG_LENGTH);
    const iv = Buffer.from(nonce);
    // XOR the record index into the end of the nonce (the spec says the last
    // 6 bytes; an index always fits the last 4, and JS bitwise is 32-bit).
    iv.writeUInt32BE((iv.readUInt32BE(8) ^ index) >>> 0, 8);
    const decipher = createDecipheriv('aes-128-gcm', key, iv);
    decipher.setAuthTag(record.subarray(record.length - TAG_LENGTH));
    const plain = Buffer.concat([
      decipher.update(record.subarray(0, record.length - TAG_LENGTH)),
      decipher.final(),
    ]);
    const padding = plain.readUInt16BE(0);
    chunks.push(plain.subarray(2 + padding));
  }
  return Buffer.concat(chunks);
}
