// -----------------------------------------------------------------------------
// Buttons of the Configuration screen (manifest `actions`).
//
// Each handler resolves the multi-language message shown under the button.
// A failure is a message too (never a throw): the user reads why, in their
// language, instead of a raw error.
// -----------------------------------------------------------------------------

import { describeError } from './service.js';
import { localize, pick } from './i18n.js';
import { UNKNOWN_DEVICE, locatedMessage, ringMessage } from './messages.js';

async function guarded(run) {
  try {
    return await run();
  } catch (err) {
    return err.userMessage ?? describeError(err);
  }
}

/** Find the device chosen in a `"source": "devices"` select. */
function chosen(service, externalId) {
  return service.canonicIdOf(externalId);
}

/** @param {import('./service.js').FindMyService} service */
export function createActions(service) {
  return {
    test_connection: () =>
      guarded(async () => {
        const devices = await service.refreshDevices();
        const { account, pushConnected } = service.status;
        const home = service.home;
        return localize((language) => {
          const lines = [
            pick(language, {
              en: `Connected as ${account}: ${devices.length} device(s) found.`,
              fr: `Connecté en tant que ${account} : ${devices.length} appareil(s) trouvé(s).`,
              de: `Verbunden als ${account}: ${devices.length} Gerät(e) gefunden.`,
              es: `Conectado como ${account}: ${devices.length} dispositivo(s) encontrado(s).`,
            }),
            pushConnected
              ? pick(language, {
                  en: 'Push channel: connected.',
                  fr: 'Canal push : connecté.',
                  de: 'Push-Kanal: verbunden.',
                  es: 'Canal push: conectado.',
                })
              : pick(language, {
                  en: 'Push channel: not connected yet (positions on demand will wait for it).',
                  fr: 'Canal push : pas encore connecté (les positions à la demande l’attendront).',
                  de: 'Push-Kanal: noch nicht verbunden (Positionen auf Abruf warten darauf).',
                  es: 'Canal push: aún no conectado (las posiciones a petición lo esperarán).',
                }),
            home
              ? pick(language, {
                  en: `Home: ${home.name}.`,
                  fr: `Maison : ${home.name}.`,
                  de: `Zuhause: ${home.name}.`,
                  es: `Casa: ${home.name}.`,
                })
              : pick(language, {
                  en: 'No located house in Gladys: presence and distance are disabled.',
                  fr: 'Aucune maison localisée dans Gladys : présence et distance désactivées.',
                  de: 'Kein Haus mit Standort in Gladys: Anwesenheit und Entfernung deaktiviert.',
                  es: 'Ninguna casa localizada en Gladys: presencia y distancia desactivadas.',
                }),
          ];
          if (service.status.error) {
            lines.push(service.status.error[language] ?? service.status.error.en);
          }
          return lines.join(' ');
        });
      }),

    locate: (fields) =>
      guarded(async () => {
        const canonicId = chosen(service, fields.device);
        if (!canonicId) return UNKNOWN_DEVICE;
        await service.locate(canonicId);
        const item = service.summary().find((entry) => entry.canonicId === canonicId);
        return locatedMessage(item.name, item);
      }),

    ring: (fields) =>
      guarded(async () => {
        const canonicId = chosen(service, fields.device);
        if (!canonicId) return UNKNOWN_DEVICE;
        await service.ring(canonicId, true);
        return ringMessage(service.nameOf(canonicId), true);
      }),
  };
}
