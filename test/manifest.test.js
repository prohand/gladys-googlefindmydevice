// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest shape; only these tests can know
// which handlers the code registers and which keys it fires.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LIMITS, normalizeConfig } from '../src/config.js';
import { SCENE_TRIGGERS, WIDGET_KEY } from '../src/service.js';
import { SCENE_ACTION_KEYS } from '../src/capabilities/scenes.js';
import { LANGUAGES } from '../src/i18n.js';
import { createActions } from '../src/actions.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('../gladys-assistant-integration.json'));
const pkg = JSON.parse(await read('../package.json'));

test('version, package and image tag agree', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-googlefindmydevice:${pkg.version}`);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
});

test('the catalog description holds 10 to 100 characters in every language', () => {
  for (const language of LANGUAGES) {
    const text = manifest.description[language];
    assert.ok(text && text.length >= 10 && text.length <= 100, `${language}: ${text?.length}`);
  }
});

/** Every multi-language object of the manifest, with where it is. */
function texts(node, path = '$') {
  if (Array.isArray(node)) return node.flatMap((item, i) => texts(item, `${path}[${i}]`));
  if (!node || typeof node !== 'object') return [];
  const found = [];
  for (const [key, value] of Object.entries(node)) {
    if (
      ['label', 'description', 'placeholder'].includes(key) &&
      value &&
      typeof value === 'object'
    ) {
      found.push([`${path}.${key}`, value]);
    } else {
      found.push(...texts(value, `${path}.${key}`));
    }
  }
  return found;
}

test('every manifest text is written in English, French, German and Spanish', () => {
  for (const [where, text] of texts(manifest)) {
    assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), where);
    for (const language of LANGUAGES) assert.ok(text[language].trim(), `${where}.${language}`);
  }
});

test('the config defaults are the code defaults', () => {
  const fields = manifest.config_schema.filter((field) => field.type !== 'section');
  assert.deepEqual(fields.map((field) => field.key).sort(), Object.keys(DEFAULT_CONFIG).sort());
  for (const field of fields) {
    if ('default' in field) assert.equal(field.default, DEFAULT_CONFIG[field.key], field.key);
    if (LIMITS[field.key]) {
      assert.equal(field.min, LIMITS[field.key].min, `${field.key}.min`);
      assert.equal(field.max, LIMITS[field.key].max, `${field.key}.max`);
    }
  }
  assert.deepEqual(normalizeConfig({}), DEFAULT_CONFIG);
});

test('the account secrets are a secret field', () => {
  const field = manifest.config_schema.find((f) => f.key === 'secrets_json');
  assert.equal(field.type, 'secret');
});

test('every manifest action has a handler, and the other way round', () => {
  const handlers = Object.keys(createActions({}));
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), handlers.sort());
});

test('scene triggers and actions match the code', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.values(SCENE_ACTION_KEYS).sort(),
  );
  assert.deepEqual(
    manifest.widgets.map((w) => w.key),
    [WIDGET_KEY],
  );
});

test('the Gladys floor covers every field the manifest declares', () => {
  // categories: 4.86; widgets, scenes: 5.1; houses select: 5.2; keywords,
  // countries: 5.3 — older cores reject unknown manifest fields.
  assert.equal(manifest.gladys_version, '>=5.3.0');
});

test('Google is a cloud service: the transport is cloud only', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
  // The house coordinates are read for presence: declared on the install screen.
  assert.equal(manifest.location, true);
});

test('Find My Device works worldwide: no countries restriction', () => {
  // Declaring `countries` would HIDE the integration from every other
  // country's catalog; Google's service is available everywhere.
  assert.equal(manifest.countries, undefined);
});

test('the search keywords and categories follow the store rules', () => {
  const normalized = manifest.keywords.map((k) => k.trim().toLowerCase());
  assert.ok(normalized.length >= 1 && normalized.length <= 10);
  assert.equal(new Set(normalized).size, normalized.length);
  for (const keyword of normalized) assert.ok(keyword.length >= 2 && keyword.length <= 30, keyword);
  const vocabulary = [
    'climate',
    'lighting',
    'energy',
    'security',
    'multimedia',
    'appliances',
    'environment',
    'protocols',
    'network',
    'notifications',
    'assistants',
    'services',
  ];
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const category of manifest.categories) assert.ok(vocabulary.includes(category), category);
});

test('the user documentation exists in the four languages', async () => {
  for (const language of LANGUAGES) {
    const doc = await read(`../docs/${language}.md`);
    assert.ok(doc.length >= 300, `docs/${language}.md is too short`);
  }
});
