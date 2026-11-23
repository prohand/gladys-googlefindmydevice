import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { FEATURES, deviceIds } from '../src/devices.js';
import { AuthError } from '../src/google/auth.js';
import { FindMyService, SCENE_TRIGGERS } from '../src/service.js';
import {
  FakeNova,
  FakeReceiver,
  manualTimers,
  memoryStore,
  secretsJson,
} from './helpers/fakeGoogle.js';

// Paris, and a point ~1.1 km east of it.
const HOME = { id: 'h1', name: 'Home', selector: 'home', latitude: 48.8566, longitude: 2.3522 };
const NEAR = { latitude: 48.8567, longitude: 2.3523 };
const AWAY = { latitude: 48.8566, longitude: 2.3672 };
const NOW = 1_763_900_000;

const silent = { debug() {}, info() {}, warn() {}, error() {} };

function setup({
  devices,
  config = {},
  secrets = secretsJson(),
  houses = [HOME],
  store = memoryStore(),
} = {}) {
  const gladys = createFakeGladys();
  gladys.fake.houses = houses;
  const receiver = new FakeReceiver();
  const nova = new FakeNova(
    receiver,
    devices ?? [
      {
        canonicId: 'phone-1',
        name: 'Pixel of Alice',
        reports: [{ ...NEAR, accuracy: 12, time: NOW }],
      },
      { canonicId: 'tag-1', name: 'Keys', android: false, model: 'Chipolo', reports: [] },
    ],
  );
  const timers = manualTimers();
  const service = new FindMyService({
    gladys,
    store,
    timers,
    logger: silent,
    createClients: () => ({ nova, receiver }),
  });
  const cfg = normalizeConfig({ secrets_json: secrets, refresh_interval: 0, ...config });
  return { gladys, receiver, nova, timers, service, cfg, store };
}

const ids = (gladys, canonicId) => deviceIds(gladys, canonicId);

test('start publishes every Google device with complete features', async () => {
  const { gladys, service, cfg } = setup();
  await service.start(cfg);
  const published = gladys.fake.discoveredDevices;
  assert.deepEqual(
    published.map((d) => d.name),
    ['Pixel of Alice', 'Keys'],
  );
  for (const device of published) {
    for (const feature of device.features) {
      for (const column of ['name', 'min', 'max', 'read_only', 'has_feedback']) {
        assert.ok(column in feature, `${feature.external_id} lacks ${column}`);
      }
    }
  }
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
});

test('the reports of the device list become states, presence included', async () => {
  const { gladys, service, cfg } = setup();
  await service.start(cfg);
  const phone = ids(gladys, 'phone-1');
  assert.equal(gladys.fake.lastState(phone.feature(FEATURES.PRESENCE)), 1);
  assert.equal(gladys.fake.lastState(phone.feature(FEATURES.ACCURACY)), 12);
  assert.ok(gladys.fake.lastState(phone.feature(FEATURES.DISTANCE)) < 0.05);
  assert.equal(gladys.fake.lastState(phone.feature(FEATURES.LOCATION)), '48.856700, 2.352300');
  const event = gladys.fake.sceneEvents.find((e) => e.key === SCENE_TRIGGERS.LOCATION_UPDATED);
  assert.equal(event.data.device, phone.device);
  assert.equal(event.data.at_home, true);
  // The first position has nothing to compare with: no arrival event.
  assert.equal(
    gladys.fake.sceneEvents.filter((e) => e.key === SCENE_TRIGGERS.ARRIVED_HOME).length,
    0,
  );
});

test('locate waits for the pushed answer and fires left_home on the transition', async () => {
  const { gladys, service, cfg, nova } = setup();
  await service.start(cfg);
  nova.devices[0].reports = [{ ...AWAY, accuracy: 20, time: NOW + 600 }];

  const position = await service.locate('phone-1');
  assert.equal(position.latitude, AWAY.latitude);
  assert.deepEqual(nova.calls.at(-1), ['locate', 'phone-1']);

  const phone = ids(gladys, 'phone-1');
  assert.equal(gladys.fake.lastState(phone.feature(FEATURES.PRESENCE)), 0);
  const left = gladys.fake.sceneEvents.filter((e) => e.key === SCENE_TRIGGERS.LEFT_HOME);
  assert.equal(left.length, 1);
  assert.equal(left[0].data.device_name, 'Pixel of Alice');
  assert.ok(left[0].data.distance_km > 1 && left[0].data.distance_km < 1.2);
});

test('arrived_home fires when the device comes back', async () => {
  const { gladys, service, cfg, nova } = setup();
  await service.start(cfg);
  nova.devices[0].reports = [{ ...AWAY, time: NOW + 600 }];
  await service.locate('phone-1');
  nova.devices[0].reports = [{ ...NEAR, time: NOW + 1200 }];
  await service.locate('phone-1');
  const keys = gladys.fake.sceneEvents
    .map((e) => e.key)
    .filter((k) => k !== SCENE_TRIGGERS.LOCATION_UPDATED);
  assert.deepEqual(keys, [SCENE_TRIGGERS.LEFT_HOME, SCENE_TRIGGERS.ARRIVED_HOME]);
});

test('an older report never replaces a newer position', async () => {
  const { gladys, service, cfg, nova } = setup();
  await service.start(cfg);
  const before = gladys.fake.states.length;
  nova.devices[0].reports = [{ ...AWAY, time: NOW - 3600 }];
  // The answer resolves with the best position known: the newer one.
  const position = await service.locate('phone-1');
  assert.equal(position.latitude, NEAR.latitude);
  assert.equal(gladys.fake.states.length, before, 'no state published for an old report');
  assert.equal(service.summary()[0].position.latitude, NEAR.latitude);
});

test('a locate without answer resolves null after the timeout', async () => {
  const { service, cfg, nova, timers } = setup();
  await service.start(cfg);
  nova.answerLocate = false;
  const pending = service.locate('phone-1', { timeoutMs: 1234 });
  await new Promise((resolve) => setImmediate(resolve));
  timers.run(1234);
  assert.equal(await pending, null);
  assert.equal(service.pending.size, 0);
});

test('ring publishes the switch state and resets it after five minutes', async () => {
  const { gladys, service, cfg, nova, timers } = setup();
  await service.start(cfg);
  await service.ring('tag-1', true);
  const ring = ids(gladys, 'tag-1').feature(FEATURES.RING);
  assert.deepEqual(nova.calls.at(-1), ['ring', 'tag-1']);
  assert.equal(gladys.fake.lastState(ring), 1);
  timers.run(5 * 60_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gladys.fake.lastState(ring), 0);
  await service.ring('tag-1', false);
  assert.deepEqual(nova.calls.at(-1), ['stop', 'tag-1']);
});

test('invalid secrets report a clear message and publish nothing', async () => {
  const { gladys, service, cfg } = setup({ secrets: '{"oops": true' });
  await service.start(cfg);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /JSON valide/);
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  await assert.rejects(service.locate('phone-1'), /not valid JSON/);
});

test('without owner_key the devices are listed but positions explained', async () => {
  const { gladys, service, cfg } = setup({ secrets: secretsJson({ ownerKey: null }) });
  await service.start(cfg);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /owner_key/);
});

test('a refused account token disconnects with the reason', async () => {
  const { gladys, service, cfg, nova } = setup();
  nova.failWith = new AuthError('BadAuthentication');
  await service.start(cfg);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /BadAuthentication/);
});

test('without a located house there is no presence nor distance', async () => {
  const { gladys, service, cfg } = setup({
    houses: [{ ...HOME, latitude: null, longitude: null }],
  });
  await service.start(cfg);
  const phone = ids(gladys, 'phone-1');
  assert.equal(gladys.fake.lastState(phone.feature(FEATURES.PRESENCE)), undefined);
  assert.equal(gladys.fake.lastState(phone.feature(FEATURES.LOCATION)), '48.856700, 2.352300');
});

test('positions survive a restart through the store', async () => {
  const store = memoryStore();
  const first = setup({ store });
  await first.service.start(first.cfg);
  first.service.stop();
  assert.equal(store.saved['phone-1'].atHome, true);

  // Restarted, the device now reports from away: that IS a transition.
  const second = setup({
    store,
    devices: [
      { canonicId: 'phone-1', name: 'Pixel of Alice', reports: [{ ...AWAY, time: NOW + 60 }] },
    ],
  });
  await second.service.start(second.cfg);
  assert.equal(
    second.gladys.fake.sceneEvents.filter((e) => e.key === SCENE_TRIGGERS.LEFT_HOME).length,
    1,
  );
});

test('the automatic refresh lists then locates every device', async () => {
  const { service, cfg, nova, timers } = setup({ config: { refresh_interval: 10 } });
  await service.start(cfg);
  await new Promise((resolve) => setImmediate(resolve));
  const initial = nova.calls.filter(([kind]) => kind === 'locate').length;
  assert.equal(initial, 2, 'a first locate right after the start');
  timers.run(10 * 60_000);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(nova.calls.filter(([kind]) => kind === 'list').length, 2);
  assert.equal(nova.calls.filter(([kind]) => kind === 'locate').length, 4);
});

test('transports are cloud, degraded while the push channel is down', async () => {
  const { gladys, service, cfg, receiver } = setup();
  await service.start(cfg);
  assert.equal(gladys.fake.transports.at(-1).transport, 'cloud');
  receiver.emit('disconnected');
  await new Promise((resolve) => setImmediate(resolve));
  const last = gladys.fake.transports.at(-1);
  assert.equal(last.degraded, true);
  assert.ok(last.message.de);
});

test('an unchanged device list is not published again, unless Gladys asks', async () => {
  const { gladys, service, cfg, nova } = setup();
  await service.start(cfg);
  const count = () => gladys.fake.bodies('POST', '/discovered_device').length;
  assert.equal(count(), 1);
  await service.refreshDevices();
  assert.equal(count(), 1);
  nova.devices[1].name = 'House keys';
  await service.refreshDevices();
  assert.equal(count(), 2);
  await service.refreshDevices({ force: true });
  assert.equal(count(), 3);
});
