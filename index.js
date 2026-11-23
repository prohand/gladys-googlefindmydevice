// -----------------------------------------------------------------------------
// Entry point of the Google Find My Device integration for Gladys.
//
// This file only wires the SDK to the service (src/service.js): handlers are
// registered BEFORE connect(), then the service starts on every (re)connection
// and restarts on every configuration change.
//
// Environment variables injected by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { FEATURES, featureKeyOf } from './src/devices.js';
import { FindMyService } from './src/service.js';
import { createStore } from './src/store.js';
import { createActions } from './src/actions.js';
import { createSceneActions } from './src/capabilities/scenes.js';
import { createWidgets } from './src/capabilities/widget.js';

const gladys = new GladysIntegration();
const service = new FindMyService({ gladys, store: createStore({ logger }) });

// Serialize the restarts: a config update arriving during a (re)connection
// must not run two starts side by side.
let starting = Promise.resolve();
function restart(config) {
  starting = starting
    .catch(() => {})
    .then(() => service.start(config))
    .catch((err) => logger.error('Service start failed', err));
  return starting;
}

// --- Discovery: Gladys asks for the device list ------------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> refreshing the Google device list');
  await service.refreshDevices({ force: true });
});

// --- Command: the Ring switch ------------------------------------------------
gladys.onSetValue(async (device, feature, value) => {
  const canonicId = service.canonicIdOf(device.external_id);
  if (!canonicId || featureKeyOf(gladys, canonicId, feature.external_id) !== FEATURES.RING) {
    // Throwing acks the command as failed.
    throw new Error(`No command for ${feature.external_id}`);
  }
  await service.ring(canonicId, Number(value) === 1);
});

// --- Buttons of the Configuration screen -------------------------------------
for (const [key, handler] of Object.entries(createActions(service))) {
  gladys.onAction(key, (fields) => handler(fields ?? {}));
}

// --- Scene actions (triggers are fired by the service) -----------------------
for (const [key, handler] of Object.entries(createSceneActions(service))) {
  gladys.onSceneAction(key, (fields) => handler(fields ?? {}));
}

// --- Dashboard widget --------------------------------------------------------
for (const [key, widget] of Object.entries(createWidgets(service))) {
  gladys.onWidgetGet(key, (request) => widget.get(gladys, request));
  gladys.onWidgetAction(key, (actionKey, params, request) =>
    widget.action(gladys, { actionKey, params, ...request }),
  );
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> restarting with the new configuration');
  await restart(normalizeConfig(newConfig));
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  try {
    await restart(normalizeConfig(await gladys.getConfig()));
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
  }
});

gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  service.stop();
});

logger.info('Starting the Google Find My Device integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
