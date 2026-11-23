import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SECP160R1,
  calculateR,
  cmac,
  decryptAesEax,
  decryptForeignReport,
  decryptIdentityKey,
  decryptOwnReport,
  liftX,
  multiply,
} from '../src/google/crypto.js';
import { decodeLocation } from '../src/google/messages.js';

// Reference vectors produced with pycryptodome (EAX, GCM, CBC, ECB) and
// python-ecdsa (SECP160r1), following the FMDN specification.
const hex = (value) => Buffer.from(value, 'hex');
const IDENTITY_KEY = hex('a1'.repeat(16) + 'b2'.repeat(16));
const LOCATION = hex('0d54ed1e1d1598eb66011823');

test('CMAC matches RFC 4493 (AES-128, examples 1 to 4)', () => {
  const key = hex('2b7e151628aed2a6abf7158809cf4f3c');
  const message = hex(
    '6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51' +
      '30c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710',
  );
  assert.equal(cmac(key, Buffer.alloc(0)).toString('hex'), 'bb1d6929e95937287fa37d129b756746');
  assert.equal(
    cmac(key, message.subarray(0, 16)).toString('hex'),
    '070a16b46b4d4144f79bdd9dd04a287c',
  );
  assert.equal(
    cmac(key, message.subarray(0, 40)).toString('hex'),
    'dfa66747de9ae63030ca32611497c827',
  );
  assert.equal(cmac(key, message).toString('hex'), '51f0bebf7e3b9d92fc49741779363cfe');
});

test('AES-EAX decrypts what pycryptodome encrypted', () => {
  const plaintext = decryptAesEax(
    hex('e5'.repeat(32)),
    hex('f6'.repeat(16)),
    hex('a46c60f5ceb875acf57be78f143feed84cc9d04979faab28e9b7e470d2794f12c4095b29fdd685'),
    hex('6e1dffcdda8cd95a4f7c2f74c3c5e48e'),
  );
  assert.equal(plaintext.toString(), 'hello find hub network, 40 bytes long!!');
});

test('AES-EAX refuses a tampered tag', () => {
  assert.throws(
    () =>
      decryptAesEax(
        hex('e5'.repeat(32)),
        hex('f6'.repeat(16)),
        hex('a46c60f5ceb875acf57be78f143feed84cc9d04979faab28e9b7e470d2794f12c4095b29fdd685'),
        hex('6e1dffcdda8cd95a4f7c2f74c3c5e48f'),
      ),
    /authentication failed/,
  );
});

test('the SECP160R1 generator is on the curve', () => {
  const { p, a, b, G } = SECP160R1;
  assert.equal((G.y * G.y) % p, (G.x ** 3n + a * G.x + b) % p);
  assert.equal(multiply(SECP160R1.n, G), null, 'n·G is the point at infinity');
  assert.equal(liftX(G.x).x, G.x);
});

test('calculateR and r·G match the reference', () => {
  const r = calculateR(IDENTITY_KEY, 8704123);
  assert.equal(r, 0x3b05eef6e4d18b5a9eb48e02b75c88910ec1a203n);
  assert.equal(multiply(r, SECP160R1.G).x, 0xc49fec557830485456640658fc6cfe5440fc08aen);
});

test('a crowd-sourced report decrypts to the location', () => {
  const plaintext = decryptForeignReport(
    IDENTITY_KEY,
    hex('2d080abc9d8624cad6ba5644b19758dc8d630efee0bc9151be3bf5d7'),
    hex('108590fb3ef32087b8a47f93b307605731539dcb'),
    8704123,
  );
  assert.deepEqual(plaintext, LOCATION);
  assert.deepEqual(decodeLocation(plaintext), {
    latitude: 48.85661,
    longitude: 2.35222,
    altitude: 35,
  });
});

test('an own report decrypts with SHA-256 of the identity key', () => {
  const plaintext = decryptOwnReport(
    IDENTITY_KEY,
    hex('1111111111111111111111111c879470e42cef7418abb9e2d4720fe5f01faf1b957937a4cecc61d0'),
  );
  assert.deepEqual(plaintext, LOCATION);
});

test('the identity key decrypts from both owner-key formats', () => {
  const ownerKey = hex('c3'.repeat(32));
  const gcm = hex(
    '111111111111111111111111f9d1ab6dd1f67251946841a99baaed90bcb736b8ddc33f4d4384141e6e510d805faad3eb68ac5a121028484a363e8f13',
  );
  const cbc = hex(
    'd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4e3954f814f6d1ea57894a4992ce20604709695135b3b133d1aa17562590fcefb',
  );
  assert.deepEqual(decryptIdentityKey(ownerKey, gcm), IDENTITY_KEY);
  assert.deepEqual(decryptIdentityKey(ownerKey, cbc), IDENTITY_KEY);
  assert.throws(() => decryptIdentityKey(ownerKey, Buffer.alloc(10)), /Unexpected identity key/);
});
