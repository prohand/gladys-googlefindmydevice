// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the manifest `config_schema`; the SDK
// fetches it (`getConfig`) and notifies every change (`onConfigUpdated`).
// This module only adds the defaults and forces the types, so the rest of the
// code never deals with `undefined` or with numbers typed as strings.
// -----------------------------------------------------------------------------

// MUST stay consistent with the `default` values of the manifest (checked by
// test/manifest.test.js).
export const DEFAULT_CONFIG = {
  // The secrets.json written by GoogleFindMyTools, pasted as is.
  secrets_json: '',
  // Selector of the Gladys house used as "home"; empty = the first located one.
  house: '',
  // Radius around the house, in metres, inside which a device is "at home".
  home_radius: 150,
  // Minutes between two automatic locate requests; 0 = only on demand.
  refresh_interval: 15,
};

export const LIMITS = {
  home_radius: { min: 50, max: 5000 },
  refresh_interval: { min: 0, max: 1440 },
};

function number(value, key) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CONFIG[key];
  }
  const { min, max } = LIMITS[key];
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const refresh = number(
    raw.refresh_interval ?? DEFAULT_CONFIG.refresh_interval,
    'refresh_interval',
  );
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    secrets_json:
      typeof raw.secrets_json === 'string' ? raw.secrets_json : DEFAULT_CONFIG.secrets_json,
    house: typeof raw.house === 'string' ? raw.house : DEFAULT_CONFIG.house,
    home_radius: number(raw.home_radius ?? DEFAULT_CONFIG.home_radius, 'home_radius'),
    // Between 1 and 4 minutes is not offered: a locate request wakes the
    // device and Google throttles clients that ask too often.
    refresh_interval: refresh > 0 && refresh < 5 ? 5 : Math.round(refresh),
  };
}
