// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// `fields` arrive resolved by the core (a `"source": "devices"` field is the
// chosen device external_id); the handler resolves the declared scalar
// `outputs`. A device that does not answer is an OUTPUT (`found: false`),
// never a failure: a scene action is not a condition, the scene author gates
// on the output. Throwing is kept for real errors (not configured, Google
// refusing the account), which the scene logs.
//
// The triggers (location_updated, arrived_home, left_home) are fired by the
// service itself, see src/service.js.
// -----------------------------------------------------------------------------

import { mapsUrl } from '../geo.js';

/** Scene action keys. Never renamed once published. */
export const SCENE_ACTION_KEYS = {
  LOCATE: 'locate_device',
  RING: 'ring_device',
  STOP_RING: 'stop_ringing_device',
};

function resolveDevice(service, externalId) {
  const canonicId = service.canonicIdOf(externalId);
  if (!canonicId) {
    throw new Error(`Unknown device ${externalId}`);
  }
  return canonicId;
}

/** @param {import('../service.js').FindMyService} service */
export function createSceneActions(service) {
  return {
    async [SCENE_ACTION_KEYS.LOCATE](fields) {
      const canonicId = resolveDevice(service, fields.device);
      const answered = await service.locate(canonicId);
      const item = service.summary().find((entry) => entry.canonicId === canonicId);
      const position = item?.position;
      if (!answered || !position || !Number.isFinite(position.latitude)) {
        return { found: false };
      }
      const outputs = {
        found: true,
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
        maps_url: mapsUrl(position),
      };
      if (item.distanceKm !== null) {
        outputs.distance_km = item.distanceKm;
        outputs.at_home = item.atHome === true;
      }
      return outputs;
    },

    async [SCENE_ACTION_KEYS.RING](fields) {
      await service.ring(resolveDevice(service, fields.device), true);
      return { sent: true };
    },

    async [SCENE_ACTION_KEYS.STOP_RING](fields) {
      await service.ring(resolveDevice(service, fields.device), false);
      return { sent: true };
    },
  };
}
