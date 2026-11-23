import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { FEATURES, deviceIds } from '../src/devices.js';
import { FindMyService } from '../src/service.js';
import { createActions } from '../src/actions.js';
import { SCENE_ACTION_KEYS, createSceneActions } from '../src/capabilities/scenes.js';
import { WIDGET_ACTIONS, WIDGET_KEY, createWidgets } from '../src/capabilities/widget.js';
import { LANGUAGES } from '../src/i18n.js';
import { FakeNova, FakeReceiver, memoryStore, secretsJson } from './helpers/fakeGoogle.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const HOME = { id: 'h', name: 'Home', selector: 'home', latitude: 48.8566, longitude: 2.3522 };
const silent = { debug() {}, info() {}, warn() {}, error() {} };

async function started({ secrets = secretsJson() } = {}) {
  const gladys = createFakeGladys();
  gladys.fake.houses = [HOME];
  const receiver = new FakeReceiver();
  const nova = new FakeNova(receiver, [
    {
      canonicId: 'phone-1',
      name: 'Pixel of Alice',
      reports: [{ latitude: 48.8567, longitude: 2.3523, accuracy: 9, time: 1_763_900_000 }],
    },
    { canonicId: 'tag-1', name: 'Keys', android: false, reports: [] },
  ]);
  const service = new FindMyService({
    gladys,
    store: memoryStore(),
    // Real short timers for the locate timeout (20 ms), none for the rest.
    timers: {
      setTimeout: (fn, ms) => (ms <= 1000 ? setTimeout(fn, ms) : 0),
      clearTimeout: (id) => clearTimeout(id),
      setInterval: () => 0,
      clearInterval() {},
    },
    locateTimeoutMs: 20,
    logger: silent,
    createClients: () => ({ nova, receiver }),
  });
  await service.start(normalizeConfig({ secrets_json: secrets, refresh_interval: 0 }));
  return { gladys, service, nova };
}

const widgetOf = (service) => createWidgets(service)[WIDGET_KEY];
const request = (settings = {}) => ({ settings, language: 'en', units: 'metric' });

// --- Widget ------------------------------------------------------------------

test('the device list content is rendered exactly as sent', async () => {
  const { gladys, service } = await started();
  const content = await widgetOf(service).get(gladys, request());
  assert.deepEqual(validateWidgetContent(content), []);
  const list = content.components.find((c) => c.type === 'card-list');
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].badge.text.en, 'Home');
  assert.match(list.items[0].links[0].url, /^https:\/\/www\.google\.com\/maps/);
});

test('the one-device content binds live tiles to published features', async () => {
  const { gladys, service } = await started();
  const phone = deviceIds(gladys, 'phone-1');
  const content = await widgetOf(service).get(gladys, request({ device: phone.device }));
  assert.deepEqual(validateWidgetContent(content), []);
  const featureIds = new Set(
    gladys.fake.discoveredDevices.flatMap((d) => d.features.map((f) => f.external_id)),
  );
  for (const component of content.components.filter((c) => c.device_feature)) {
    assert.ok(featureIds.has(component.device_feature), component.device_feature);
  }
  const ring = content.components.find((c) => c.device_feature === phone.feature(FEATURES.RING));
  assert.equal(ring.value, 1);
});

test('the not-configured content is valid and explains what to do', async () => {
  const { gladys, service } = await started({ secrets: '' });
  const content = await widgetOf(service).get(gladys, request());
  assert.deepEqual(validateWidgetContent(content), []);
  assert.match(content.components[0].text.en, /secrets\.json/);
});

test('every widget action answers a short toast in every language', async () => {
  const { gladys, service, nova } = await started();
  const widget = widgetOf(service);
  const phone = deviceIds(gladys, 'phone-1').device;
  const toasts = [
    await widget.action(gladys, { actionKey: WIDGET_ACTIONS.LOCATE_ALL }),
    await widget.action(gladys, { actionKey: WIDGET_ACTIONS.LOCATE, params: { device: phone } }),
    await widget.action(gladys, { actionKey: WIDGET_ACTIONS.RING, values: { device: phone } }),
  ];
  for (const toast of toasts) {
    for (const language of LANGUAGES) {
      assert.ok(
        toast[language]?.length > 0 && toast[language].length <= 200,
        `${language}: ${toast[language]}`,
      );
    }
  }
  assert.ok(nova.calls.some(([kind]) => kind === 'ring'));
  await assert.rejects(widget.action(gladys, { actionKey: 'nope' }), /Unknown widget action/);
});

// --- Scene actions -----------------------------------------------------------

function declaredOutputs(key) {
  return new Set(manifest.scene_actions.find((a) => a.key === key).outputs.map((o) => o.key));
}

test('locate_device returns only declared outputs', async () => {
  const { gladys, service } = await started();
  const actions = createSceneActions(service);
  const outputs = await actions[SCENE_ACTION_KEYS.LOCATE]({
    device: deviceIds(gladys, 'phone-1').device,
  });
  assert.equal(outputs.found, true);
  assert.equal(outputs.at_home, true);
  const declared = declaredOutputs(SCENE_ACTION_KEYS.LOCATE);
  for (const key of Object.keys(outputs)) assert.ok(declared.has(key), key);
});

test('a device that does not answer is an output, not a failure', async () => {
  const { gladys, service } = await started();
  const actions = createSceneActions(service);
  // The tracker has no report at all: the push answer carries no position.
  const outputs = await actions[SCENE_ACTION_KEYS.LOCATE]({
    device: deviceIds(gladys, 'tag-1').device,
  });
  assert.deepEqual(outputs, { found: false });
});

test('ring_device and stop_ringing_device send the orders', async () => {
  const { gladys, service, nova } = await started();
  const actions = createSceneActions(service);
  const device = deviceIds(gladys, 'tag-1').device;
  assert.deepEqual(await actions[SCENE_ACTION_KEYS.RING]({ device }), { sent: true });
  assert.deepEqual(await actions[SCENE_ACTION_KEYS.STOP_RING]({ device }), { sent: true });
  assert.deepEqual(nova.calls.slice(-2), [
    ['ring', 'tag-1'],
    ['stop', 'tag-1'],
  ]);
  await assert.rejects(actions[SCENE_ACTION_KEYS.RING]({ device: 'ext:other' }), /Unknown device/);
});

test('scene events only carry keys the trigger declares', async () => {
  const { gladys } = await started();
  for (const event of gladys.fake.sceneEvents) {
    const trigger = manifest.scene_triggers.find((t) => t.key === event.key);
    assert.ok(trigger, `undeclared trigger ${event.key}`);
    const declared = new Set([...trigger.fields, ...trigger.variables].map((f) => f.key));
    for (const key of Object.keys(event.data)) assert.ok(declared.has(key), `${event.key}.${key}`);
  }
  assert.ok(gladys.fake.sceneEvents.length > 0);
});

// --- Configuration actions ---------------------------------------------------

test('the Configuration actions answer in every language', async () => {
  const { gladys, service } = await started();
  const actions = createActions(service);
  const phone = deviceIds(gladys, 'phone-1').device;
  const answers = [
    await actions.test_connection({}),
    await actions.locate({ device: phone }),
    await actions.ring({ device: phone }),
    await actions.ring({ device: 'ext:unknown' }),
  ];
  for (const answer of answers) {
    assert.deepEqual(Object.keys(answer).sort(), [...LANGUAGES].sort());
  }
  assert.match(answers[0].en, /2 device\(s\) found/);
  assert.match(answers[1].fr, /Pixel of Alice : |Pixel of Alice:/);
});

test('a Configuration action never throws, it explains', async () => {
  const { service } = await started({ secrets: '{' });
  const answer = await createActions(service).test_connection({});
  assert.match(answer.en, /not valid JSON/);
});
