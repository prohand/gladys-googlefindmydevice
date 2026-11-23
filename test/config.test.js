import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';
import { FEATURES, buildDevice, canonicIdOf, featureKeyOf } from '../src/devices.js';
import { distanceMeters, isAtHome, mapsUrl } from '../src/geo.js';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

test('the config is normalized and bounded', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  const config = normalizeConfig({ home_radius: '20', refresh_interval: '2', house: 42 });
  assert.equal(config.home_radius, 50);
  assert.equal(config.refresh_interval, 5, 'between 1 and 4 minutes becomes 5');
  assert.equal(config.house, '');
  assert.equal(normalizeConfig({ refresh_interval: 0 }).refresh_interval, 0);
  assert.equal(normalizeConfig({ refresh_interval: 'x' }).refresh_interval, 15);
});

test('the device payload is accepted by Gladys', async () => {
  const gladys = createFakeGladys();
  const device = buildDevice(gladys, {
    canonicId: 'abc-123',
    name: '',
    kind: 'phone',
    manufacturer: 'Google',
    model: 'Pixel 8',
  });
  assert.equal(device.name, 'Google Pixel 8');
  // The fake Gladys refuses what the host API refuses (categories, units, NOT NULL columns).
  await gladys.publishDiscoveredDevices([device]);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.equal(canonicIdOf(gladys, device.external_id), 'abc-123');
  assert.equal(canonicIdOf(gladys, 'ext:other:device:x'), null);
  const ring = device.features.find((f) => f.external_id.endsWith(':ring'));
  assert.equal(featureKeyOf(gladys, 'abc-123', ring.external_id), FEATURES.RING);
});

test('distance and presence', () => {
  const home = { latitude: 48.8566, longitude: 2.3522 };
  const lyon = { latitude: 45.764, longitude: 4.8357 };
  const km = distanceMeters(home, lyon) / 1000;
  assert.ok(km > 390 && km < 394, `${km}`);
  assert.equal(isAtHome(140, 0, 150), true);
  assert.equal(isAtHome(250, 120, 150), true, 'the accuracy gives the benefit of the doubt');
  assert.equal(isAtHome(400, 5000, 150), false, '…up to the radius only');
  assert.equal(mapsUrl(home), 'https://www.google.com/maps/search/?api=1&query=48.856600,2.352200');
});

test('the release script rolls the Unreleased section', async () => {
  const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(changelog, /^## \[Unreleased\]$/m);
  const rolled = rollChangelog(
    '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Thing.\n',
    '1.0.0',
    '2026-01-02',
  );
  assert.match(
    rolled,
    /## \[Unreleased\]\n\n## \[1\.0\.0\] - 2026-01-02\n\n### Added\n\n- Thing\./,
  );
});
