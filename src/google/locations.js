// -----------------------------------------------------------------------------
// From encrypted reports to positions.
//
// A device carries several reports (its own, crowd-sourced ones, a semantic
// "Home"-like place). They are decrypted with the device identity key and the
// most recent one with coordinates wins; a newer semantic report, which has
// no coordinates, only adds its place name.
// -----------------------------------------------------------------------------

import {
  MCU_FAST_PAIR_MODEL_ID,
  decryptForeignReport,
  decryptIdentityKey,
  decryptOwnReport,
} from './crypto.js';
import { LOCATION_STATUS, decodeLocation } from './messages.js';

const STATUS_NAMES = {
  [LOCATION_STATUS.SEMANTIC]: 'semantic',
  [LOCATION_STATUS.LAST_KNOWN]: 'last-known',
  [LOCATION_STATUS.CROWDSOURCED]: 'crowdsourced',
  [LOCATION_STATUS.AGGREGATED]: 'aggregated',
};

/** Thrown when the owner key cannot open a device's identity key. */
export class KeyError extends Error {}

/**
 * Decrypt every report of a device.
 * @param {ReturnType<import('./messages.js').decodeDeviceMetadata>} device
 * @param {Buffer | null} ownerKey
 * @returns {Array<{ time: number, status: string, own: boolean, accuracy: number,
 *   latitude?: number, longitude?: number, altitude?: number, place?: string }>}
 */
export function decryptReports(device, ownerKey) {
  if (device.reports.length === 0) {
    return [];
  }
  let identityKey = null;
  const needsKey = device.reports.some((report) => report.status !== LOCATION_STATUS.SEMANTIC);
  if (needsKey) {
    if (!ownerKey) {
      throw new KeyError('owner_key missing from secrets.json');
    }
    if (device.encryptedIdentityKey.length === 0) {
      throw new KeyError(`no identity key for ${device.name}`);
    }
    try {
      identityKey = decryptIdentityKey(
        ownerKey,
        device.encryptedIdentityKey,
        device.fastPairModelId,
      );
    } catch {
      // Typically an owner key older than the device (encryption data reset).
      throw new KeyError(
        `owner key cannot decrypt ${device.name} (key version ${device.ownerKeyVersion})`,
      );
    }
  }

  const isMcu = device.fastPairModelId === MCU_FAST_PAIR_MODEL_ID;
  const positions = [];
  for (const report of device.reports) {
    const base = {
      time: report.time,
      status: STATUS_NAMES[report.status] ?? 'unknown',
      own: report.isOwnReport,
      accuracy: Math.round(report.accuracy * 10) / 10,
    };
    if (report.status === LOCATION_STATUS.SEMANTIC) {
      positions.push({ ...base, own: true, place: report.semanticName });
      continue;
    }
    if (report.encryptedLocation.length === 0) {
      continue;
    }
    try {
      const plain =
        report.publicKeyRandom.length === 0
          ? decryptOwnReport(identityKey, report.encryptedLocation)
          : decryptForeignReport(
              identityKey,
              report.encryptedLocation,
              report.publicKeyRandom,
              isMcu ? 0 : report.deviceTimeOffset,
            );
      positions.push({ ...base, ...decodeLocation(plain) });
    } catch {
      // One unreadable report (corrupted, other key) must not hide the others.
    }
  }
  return positions;
}

/**
 * The position to show: the most recent one with coordinates, plus the place
 * name of a semantic report at least as recent. Null when there is nothing.
 */
export function latestPosition(positions) {
  const located = positions
    .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
    .sort((a, b) => b.time - a.time);
  const semantic = positions.filter((p) => p.place).sort((a, b) => b.time - a.time);
  const best = located[0];
  if (!best) {
    return semantic[0] ?? null;
  }
  if (semantic[0] && semantic[0].time >= best.time) {
    return { ...best, place: semantic[0].place };
  }
  return best;
}
