// -----------------------------------------------------------------------------
// The Find My Device service: one Google account, its devices and their
// positions, turned into Gladys states, scene events and transport badges.
//
//   start(config)   parse secrets.json, open the push channel, list the
//                   devices, publish them, schedule the automatic locates;
//   locate(id)      send a locate order and wait for the pushed answer;
//   ring(id, on)    make a device ring or stop ringing.
//
// The Google clients are built by `createClients` so the tests can replace
// them with fakes: no test ever reaches Google.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { createTokenProvider, AuthError } from './google/auth.js';
import { FcmReceiver } from './google/fcm.js';
import { decodeDeviceUpdate } from './google/messages.js';
import { createNovaClient, NovaError } from './google/nova.js';
import { KeyError, decryptReports, latestPosition } from './google/locations.js';
import { SecretsError, maskEmail, parseSecrets } from './google/secrets.js';
import { FEATURES, buildDevice, deviceIds, displayName } from './devices.js';
import { distanceMeters, formatCoordinates, isAtHome, mapsUrl, toKm } from './geo.js';
import { localize, pick } from './i18n.js';

/** Scene trigger keys (manifest `scene_triggers`). Never renamed once published. */
export const SCENE_TRIGGERS = {
  LOCATION_UPDATED: 'location_updated',
  ARRIVED_HOME: 'arrived_home',
  LEFT_HOME: 'left_home',
};

/** Widget key (manifest `widgets`), nudged when positions change. */
export const WIDGET_KEY = 'find_my_devices';

const LOCATE_TIMEOUT_MS = 60_000;
// Google makes a device ring for about five minutes, unless stopped.
const RING_DURATION_MS = 5 * 60_000;

function defaultCreateClients(secrets) {
  const tokens = createTokenProvider(secrets);
  return {
    nova: createNovaClient(tokens, secrets.fcmToken),
    receiver: new FcmReceiver({ secrets, logger: createLogger({ name: 'push' }) }),
  };
}

/** The user-facing message of a failure, in every language. */
export function describeError(err) {
  if (err instanceof SecretsError) {
    return err.userMessage;
  }
  if (err instanceof AuthError) {
    return {
      en: `Google refused the account token (${err.reason}). Generate a new secrets.json with GoogleFindMyTools and paste it again.`,
      fr: `Google a refusé le jeton du compte (${err.reason}). Générez un nouveau secrets.json avec GoogleFindMyTools et recollez-le.`,
      de: `Google hat das Konto-Token abgelehnt (${err.reason}). Erzeuge mit GoogleFindMyTools eine neue secrets.json und füge sie erneut ein.`,
      es: `Google rechazó el token de la cuenta (${err.reason}). Genere un nuevo secrets.json con GoogleFindMyTools y péguelo de nuevo.`,
    };
  }
  if (err instanceof NovaError) {
    return {
      en: `The Find My Device service answered an error (HTTP ${err.status}). Try again later.`,
      fr: `Le service Localiser mon appareil a répondu une erreur (HTTP ${err.status}). Réessayez plus tard.`,
      de: `Der Dienst „Mein Gerät finden“ hat einen Fehler gemeldet (HTTP ${err.status}). Versuche es später erneut.`,
      es: `El servicio Encontrar mi dispositivo respondió un error (HTTP ${err.status}). Inténtelo más tarde.`,
    };
  }
  return {
    en: 'Google could not be reached. Check the internet access of Gladys.',
    fr: "Google est injoignable. Vérifiez l'accès à Internet de Gladys.",
    de: 'Google ist nicht erreichbar. Prüfe den Internetzugang von Gladys.',
    es: 'No se puede contactar con Google. Compruebe el acceso a Internet de Gladys.',
  };
}

const NOT_CONFIGURED = {
  en: 'The integration is not configured yet: paste your secrets.json first.',
  fr: "L'intégration n'est pas encore configurée : collez d'abord votre secrets.json.",
  de: 'Die Integration ist noch nicht eingerichtet: Füge zuerst deine secrets.json ein.',
  es: 'La integración aún no está configurada: pegue primero su secrets.json.',
};

const NO_OWNER_KEY = {
  en: 'Positions cannot be decrypted: secrets.json has no owner_key. Locate one device once with GoogleFindMyTools (it asks for your screen lock PIN), then paste the new secrets.json.',
  fr: "Les positions ne peuvent pas être déchiffrées : secrets.json n'a pas d'owner_key. Localisez une fois un appareil avec GoogleFindMyTools (il demande le code de verrouillage), puis recollez le nouveau secrets.json.",
  de: 'Die Positionen können nicht entschlüsselt werden: secrets.json enthält keinen owner_key. Orte einmal ein Gerät mit GoogleFindMyTools (es fragt nach der PIN der Displaysperre) und füge dann die neue secrets.json ein.',
  es: 'Las posiciones no se pueden descifrar: secrets.json no tiene owner_key. Localice una vez un dispositivo con GoogleFindMyTools (pide el PIN de bloqueo) y pegue el nuevo secrets.json.',
};

export class FindMyService {
  /**
   * @param {object} options
   * @param {object} options.gladys the SDK instance
   * @param {{ load: () => object, save: (devices: object) => void }} options.store
   * @param {Function} [options.createClients] `(secrets, { logger }) => { nova, receiver }`
   * @param {object} [options.timers] setTimeout/clearTimeout/setInterval/clearInterval
   * @param {number} [options.locateTimeoutMs]
   */
  constructor({
    gladys,
    store,
    createClients = defaultCreateClients,
    timers = globalThis,
    locateTimeoutMs = LOCATE_TIMEOUT_MS,
    logger = createLogger({ name: 'find-my' }),
  }) {
    this.gladys = gladys;
    this.store = store;
    this.createClients = createClients;
    this.timers = timers;
    this.locateTimeoutMs = locateTimeoutMs;
    this.logger = logger;
    this.devices = new Map();
    this.pending = new Map();
    this.ringTimers = new Map();
    this.home = null;
    this.nova = null;
    this.receiver = null;
    this.secrets = null;
    this.config = null;
    this.status = { configured: false, ok: false, error: null, pushConnected: false, account: '' };
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.stop();
    this.config = config;
    this.publishedSignature = null;
    this.home = await this.loadHome(config);
    this.saved = this.store.load();

    try {
      this.secrets = parseSecrets(config.secrets_json);
    } catch (err) {
      this.status = {
        configured: false,
        ok: false,
        error: describeError(err),
        pushConnected: false,
        account: '',
      };
      await this.reportStatus();
      return;
    }
    this.status = {
      configured: true,
      ok: false,
      error: null,
      pushConnected: false,
      account: maskEmail(this.secrets.username),
    };

    const { nova, receiver } = this.createClients(this.secrets, { logger: this.logger });
    this.nova = nova;
    this.receiver = receiver;
    receiver.on('payload', (buffer) =>
      this.onPush(buffer).catch((err) => this.logger.warn(`Push message ignored: ${err.message}`)),
    );
    receiver.on('connected', () => {
      this.status.pushConnected = true;
      this.publishTransports().catch(() => {});
    });
    receiver.on('disconnected', () => {
      this.status.pushConnected = false;
      this.publishTransports().catch(() => {});
    });
    receiver.start();

    await this.safeRefresh();
    this.schedule();
  }

  stop() {
    this.timers.clearInterval(this.interval);
    this.interval = null;
    for (const timer of this.ringTimers.values()) this.timers.clearTimeout(timer);
    this.ringTimers.clear();
    for (const [uuid, pending] of this.pending) {
      this.timers.clearTimeout(pending.timer);
      pending.resolve(null);
      this.pending.delete(uuid);
    }
    if (this.receiver) {
      this.receiver.removeAllListeners();
      this.receiver.stop();
    }
    this.receiver = null;
    this.nova = null;
  }

  schedule() {
    const minutes = this.config.refresh_interval;
    if (!minutes) {
      return;
    }
    this.interval = this.timers.setInterval(() => {
      this.periodic().catch((err) => this.logger.warn(`Periodic refresh failed: ${err.message}`));
    }, minutes * 60_000);
    // A first fresh position right away, without blocking the start.
    this.locateAll().catch((err) => this.logger.warn(`Initial locate failed: ${err.message}`));
  }

  async periodic() {
    if (await this.safeRefresh()) {
      await this.locateAll();
    }
  }

  // --- Home ------------------------------------------------------------------

  async loadHome(config) {
    try {
      const houses = await this.gladys.getHouses();
      const located = houses.filter(
        (house) => Number.isFinite(house.latitude) && Number.isFinite(house.longitude),
      );
      const house = located.find((h) => h.selector === config.house) ?? located[0];
      return house
        ? { name: house.name, latitude: house.latitude, longitude: house.longitude }
        : null;
    } catch (err) {
      this.logger.warn(`Houses unavailable, presence disabled: ${err.message}`);
      return null;
    }
  }

  // --- Devices ---------------------------------------------------------------

  /** Refresh the device list, report the outcome. Resolves true on success. */
  async safeRefresh() {
    try {
      await this.refreshDevices();
      return true;
    } catch (err) {
      this.logger.error(`Device list failed: ${err.message}`);
      this.status.ok = false;
      this.status.error = describeError(err);
      await this.reportStatus();
      await this.publishTransports().catch(() => {});
      return false;
    }
  }

  async refreshDevices({ force = false } = {}) {
    this.ensureReady();
    const list = await this.nova.listDevices();
    const next = new Map();
    for (const device of list) {
      const canonicId = device.canonicIds[0];
      if (!canonicId || next.has(canonicId)) continue;
      const previous = this.devices.get(canonicId) ?? this.saved?.[canonicId] ?? {};
      next.set(canonicId, {
        info: {
          canonicId,
          name: device.name,
          kind: device.kind,
          manufacturer: device.manufacturer,
          model: device.model,
        },
        position: previous.position ?? null,
        atHome: previous.atHome,
      });
    }
    this.devices = next;
    // Publish only when the list or a name changed (or when Gladys asks):
    // the periodic refresh must not re-send the same discovery every time.
    const discovered = [...next.values()].map((entry) => buildDevice(this.gladys, entry.info));
    const signature = JSON.stringify(discovered);
    if (force || signature !== this.publishedSignature) {
      await this.gladys.publishDiscoveredDevices(discovered);
      this.publishedSignature = signature;
    }
    this.status.ok = true;
    this.status.error = null;
    // The list often carries the last known reports: use them right away.
    for (const device of list) {
      await this.applyReports(device.canonicIds[0], device);
    }
    await this.reportStatus();
    await this.publishTransports();
    this.refreshWidget();
    return [...next.values()];
  }

  /** Decrypt the reports of a device and apply the newest position. */
  async applyReports(canonicId, device) {
    if (!this.devices.has(canonicId) || device.reports.length === 0) {
      return null;
    }
    let positions;
    try {
      positions = decryptReports(device, this.secrets.ownerKey);
    } catch (err) {
      if (err instanceof KeyError) {
        this.logger.warn(`Cannot decrypt the positions: ${err.message}`);
        this.status.error = this.secrets.ownerKey ? describeError(err) : NO_OWNER_KEY;
        await this.reportStatus();
        return null;
      }
      throw err;
    }
    const position = latestPosition(positions);
    if (position) {
      await this.applyPosition(canonicId, position);
    }
    return position;
  }

  /** The canonic id behind a Gladys device external id, if it is one of ours. */
  canonicIdOf(externalId) {
    for (const canonicId of this.devices.keys()) {
      if (deviceIds(this.gladys, canonicId).device === externalId) return canonicId;
    }
    return null;
  }

  /** Name of a device, for messages. */
  nameOf(canonicId) {
    const entry = this.devices.get(canonicId);
    return entry ? displayName(entry.info) : canonicId;
  }

  // --- Positions -------------------------------------------------------------

  /** Distance and presence of a position, when the home and coordinates are known. */
  relativeToHome(position) {
    if (!this.home || !Number.isFinite(position?.latitude)) {
      return { distanceKm: null, atHome: undefined };
    }
    const meters = distanceMeters(this.home, position);
    return {
      distanceKm: toKm(meters),
      atHome: isAtHome(meters, position.accuracy, this.config.home_radius),
    };
  }

  async applyPosition(canonicId, position) {
    const entry = this.devices.get(canonicId);
    if (!entry) return false;
    const previous = entry.position;
    if (previous && position.time < previous.time) {
      return false; // an older report arriving late
    }
    if (
      previous &&
      position.time === previous.time &&
      position.latitude === previous.latitude &&
      position.longitude === previous.longitude &&
      position.place === previous.place
    ) {
      return false;
    }
    entry.position = position;
    const ids = deviceIds(this.gladys, canonicId);
    const { distanceKm, atHome } = this.relativeToHome(position);
    const hasCoordinates = Number.isFinite(position.latitude);
    const text = [position.place, hasCoordinates ? formatCoordinates(position) : null]
      .filter(Boolean)
      .join(' — ');

    const states = [];
    if (text) states.push({ device_feature_external_id: ids.feature(FEATURES.LOCATION), text });
    if (hasCoordinates) {
      states.push({
        device_feature_external_id: ids.feature(FEATURES.ACCURACY),
        state: position.accuracy,
      });
    }
    if (distanceKm !== null) {
      states.push({
        device_feature_external_id: ids.feature(FEATURES.DISTANCE),
        state: distanceKm,
      });
      states.push({
        device_feature_external_id: ids.feature(FEATURES.PRESENCE),
        state: atHome ? 1 : 0,
      });
    }
    if (states.length > 0) {
      await this.gladys.publishStates(states);
    }

    // Scene events: one per new position, one per presence TRANSITION.
    const name = displayName(entry.info);
    if (hasCoordinates) {
      await this.fire(SCENE_TRIGGERS.LOCATION_UPDATED, {
        device: ids.device,
        device_name: name,
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
        place: position.place ?? '',
        maps_url: mapsUrl(position),
        ...(distanceKm !== null ? { distance_km: distanceKm, at_home: atHome } : {}),
      });
    }
    const wasAtHome = entry.atHome;
    if (atHome !== undefined) {
      entry.atHome = atHome;
      if (wasAtHome !== undefined && wasAtHome !== atHome) {
        await this.fire(atHome ? SCENE_TRIGGERS.ARRIVED_HOME : SCENE_TRIGGERS.LEFT_HOME, {
          device: ids.device,
          device_name: name,
          distance_km: distanceKm,
        });
      }
    }

    this.persist();
    this.refreshWidget();
    return true;
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      this.logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  persist() {
    const devices = {};
    for (const [canonicId, entry] of this.devices) {
      devices[canonicId] = { position: entry.position, atHome: entry.atHome };
    }
    this.store.save(devices);
  }

  /** Handle one pushed DeviceUpdate (the answer of a locate order). */
  async onPush(buffer) {
    const update = decodeDeviceUpdate(buffer);
    const pending = this.pending.get(update.requestUuid);
    const canonicId = pending?.canonicId ?? update.device?.canonicIds[0];
    if (!update.device || !this.devices.has(canonicId)) {
      return;
    }
    const position = await this.applyReports(canonicId, update.device);
    if (pending && position) {
      this.timers.clearTimeout(pending.timer);
      this.pending.delete(update.requestUuid);
      pending.resolve(this.devices.get(canonicId).position);
    }
  }

  // --- Orders ----------------------------------------------------------------

  ensureReady() {
    if (!this.nova) {
      throw new SecretsError(this.status.error ?? NOT_CONFIGURED);
    }
  }

  /**
   * Ask a device for its position and wait for the pushed answer.
   * @returns {Promise<object | null>} the position, null when none came in time
   */
  async locate(canonicId, { timeoutMs = this.locateTimeoutMs } = {}) {
    this.ensureReady();
    const requestUuid = randomUUID();
    const answer = new Promise((resolve) => {
      const timer = this.timers.setTimeout(() => {
        this.pending.delete(requestUuid);
        resolve(null);
      }, timeoutMs);
      this.pending.set(requestUuid, { canonicId, resolve, timer });
    });
    try {
      await this.nova.locate(canonicId, requestUuid);
    } catch (err) {
      const pending = this.pending.get(requestUuid);
      if (pending) {
        this.timers.clearTimeout(pending.timer);
        this.pending.delete(requestUuid);
      }
      throw err;
    }
    return answer;
  }

  /** Locate every device in parallel; resolves how many answered. */
  async locateAll() {
    const results = await Promise.allSettled(
      [...this.devices.keys()].map((canonicId) => this.locate(canonicId)),
    );
    return results.filter((r) => r.status === 'fulfilled' && r.value).length;
  }

  /** Make a device ring (`start`) or stop ringing. */
  async ring(canonicId, start = true) {
    this.ensureReady();
    if (!this.devices.has(canonicId)) {
      throw new Error(`Unknown device ${canonicId}`);
    }
    await this.nova.sound(canonicId, start);
    const featureId = deviceIds(this.gladys, canonicId).feature(FEATURES.RING);
    await this.gladys.publishState(featureId, start ? 1 : 0);
    this.timers.clearTimeout(this.ringTimers.get(canonicId));
    this.ringTimers.delete(canonicId);
    if (start) {
      // The phone stops by itself: so does the switch.
      this.ringTimers.set(
        canonicId,
        this.timers.setTimeout(() => {
          this.ringTimers.delete(canonicId);
          this.gladys.publishState(featureId, 0).catch(() => {});
        }, RING_DURATION_MS),
      );
    }
  }

  // --- Reporting -------------------------------------------------------------

  async reportStatus() {
    const { configured, ok, error } = this.status;
    try {
      if (!configured || !ok) {
        await this.gladys.setConnectionStatus(false, error ?? undefined);
      } else if (error) {
        // Connected, but positions unreadable (no owner key...): say why.
        await this.gladys.setConnectionStatus(true, error);
      } else {
        await this.gladys.setConnectionStatus(true);
      }
    } catch (err) {
      this.logger.warn(`Connection status not published: ${err.message}`);
    }
  }

  async publishTransports() {
    if (this.devices.size === 0) return;
    const { ok, pushConnected } = this.status;
    const entries = [...this.devices.keys()].map((canonicId) => {
      const entry = {
        external_id: deviceIds(this.gladys, canonicId).device,
        transport: ok ? 'cloud' : 'unreachable',
      };
      if (ok && !pushConnected) {
        entry.degraded = true;
        entry.message = localize((lang) =>
          pick(lang, {
            en: 'Push channel down: new positions cannot arrive.',
            fr: 'Canal push coupé : les nouvelles positions ne peuvent pas arriver.',
            de: 'Push-Kanal getrennt: Neue Positionen können nicht ankommen.',
            es: 'Canal push caído: las nuevas posiciones no pueden llegar.',
          }),
        );
      }
      return entry;
    });
    await this.gladys.publishTransports(entries);
  }

  refreshWidget() {
    try {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } catch {
      // Fire-and-forget nudge: dropped while disconnected.
    }
  }

  /** Everything the widget and the actions show, one entry per device. */
  summary() {
    return [...this.devices.entries()].map(([canonicId, entry]) => ({
      canonicId,
      externalId: deviceIds(this.gladys, canonicId).device,
      name: displayName(entry.info),
      kind: entry.info.kind,
      position: entry.position,
      atHome: entry.atHome,
      ...this.relativeToHome(entry.position),
    }));
  }
}
