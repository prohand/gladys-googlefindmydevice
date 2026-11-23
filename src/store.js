// -----------------------------------------------------------------------------
// Last known positions, kept on the /data volume.
//
// The container rootfs is read-only and /data is the one writable place. The
// file lets the dashboard widget and the presence logic start from the last
// positions after a restart, instead of "unknown" until the next locate. A
// write failure is logged, never fatal: the positions are a cache.
// -----------------------------------------------------------------------------

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || '/data';

/**
 * @param {{ dir?: string, logger: object }} options
 */
export function createStore({ dir = DATA_DIR, logger }) {
  const file = path.join(dir, 'positions.json');

  return {
    /** `{ [canonicId]: { position, atHome } }`, empty when nothing was saved. */
    load() {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8'));
        return data && typeof data === 'object' && data.devices ? data.devices : {};
      } catch {
        return {};
      }
    },

    save(devices) {
      try {
        mkdirSync(dir, { recursive: true });
        // Write then rename: a crash mid-write never leaves a truncated file.
        const tmp = `${file}.tmp`;
        writeFileSync(tmp, JSON.stringify({ version: 1, devices }));
        renameSync(tmp, file);
      } catch (err) {
        logger.warn(`Could not save the positions in ${dir}: ${err.message}`);
      }
    },
  };
}
