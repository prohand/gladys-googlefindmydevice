// -----------------------------------------------------------------------------
// The Gladys device of a Google Find My Device entry (phone, tablet, tracker,
// earbuds...).
//
// External ids are built from the Google canonic id, the unique and stable
// identifier Google gives each device: renaming the device in the Find My
// Device app changes its name, never its id, so the Gladys device, its history
// and the scenes using it survive.
//
// Features, all published with the NOT NULL columns (name, min, max,
// read_only, has_feedback):
//   - location  text      place name or "lat, lon" of the last position
//   - presence  binary    1 = within the home radius
//   - distance  decimal   km from home
//   - accuracy  decimal   m, radius of the last position
//   - ring      switch    1 = ring now, 0 = stop ringing
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'device';

export const FEATURES = {
  LOCATION: 'location',
  PRESENCE: 'presence',
  DISTANCE: 'distance',
  ACCURACY: 'accuracy',
  RING: 'ring',
};

// Half the Earth's circumference: no distance on the ground is longer.
const MAX_DISTANCE_KM = 20_040;

/** External ids of a device, from its Google canonic id. */
export function deviceIds(gladys, canonicId) {
  return gladys.externalIds(DEVICE_TYPE, canonicId);
}

/** The Google canonic id behind a device external id, or null. */
export function canonicIdOf(gladys, externalId) {
  const prefix = gladys.externalIds(DEVICE_TYPE, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  return externalId.slice(prefix.length) || null;
}

/** The feature key behind a feature external id (e.g. 'ring'), or null. */
export function featureKeyOf(gladys, canonicId, featureExternalId) {
  const ids = deviceIds(gladys, canonicId);
  return Object.values(FEATURES).find((key) => ids.feature(key) === featureExternalId) ?? null;
}

/** Display name: the user's name in Find My Device, else the model. */
export function displayName(info) {
  return info.name || [info.manufacturer, info.model].filter(Boolean).join(' ') || 'Google device';
}

/**
 * The discovery payload of one device.
 * @param {object} gladys
 * @param {{ canonicId: string, name: string, kind: string, manufacturer: string, model: string }} info
 */
export function buildDevice(gladys, info) {
  const ids = deviceIds(gladys, info.canonicId);
  const sensor = (key, name, category, type, extra = {}) => ({
    name,
    external_id: ids.feature(key),
    category,
    type,
    read_only: true,
    has_feedback: false,
    ...extra,
  });
  return {
    name: displayName(info),
    external_id: ids.device,
    // `model` is shown by the Gladys device page next to the name.
    model: [info.manufacturer, info.model].filter(Boolean).join(' ') || info.kind,
    params: [
      { name: 'kind', value: info.kind },
      { name: 'canonic_id', value: info.canonicId },
    ],
    features: [
      sensor(
        FEATURES.LOCATION,
        'Location',
        DEVICE_FEATURE_CATEGORIES.TEXT,
        DEVICE_FEATURE_TYPES.TEXT.TEXT,
        {
          min: 0,
          max: 0,
          keep_history: false,
        },
      ),
      sensor(
        FEATURES.PRESENCE,
        'At home',
        DEVICE_FEATURE_CATEGORIES.PRESENCE_SENSOR,
        DEVICE_FEATURE_TYPES.SENSOR.BINARY,
        { min: 0, max: 1, keep_history: true },
      ),
      sensor(
        FEATURES.DISTANCE,
        'Distance from home',
        DEVICE_FEATURE_CATEGORIES.DISTANCE_SENSOR,
        DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
        { unit: DEVICE_FEATURE_UNITS.KM, min: 0, max: MAX_DISTANCE_KM, keep_history: true },
      ),
      sensor(
        FEATURES.ACCURACY,
        'Position accuracy',
        DEVICE_FEATURE_CATEGORIES.DISTANCE_SENSOR,
        DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
        { unit: DEVICE_FEATURE_UNITS.M, min: 0, max: 100_000, keep_history: false },
      ),
      {
        name: 'Ring',
        external_id: ids.feature(FEATURES.RING),
        category: DEVICE_FEATURE_CATEGORIES.SWITCH,
        type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
        min: 0,
        max: 1,
        // Google never confirms the ringing: the state is the order given.
        read_only: false,
        has_feedback: false,
        keep_history: false,
      },
    ],
  };
}
