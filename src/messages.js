// -----------------------------------------------------------------------------
// User-facing sentences shared by the Configuration actions, the scene actions
// and the widget, in the four languages of Gladys.
// -----------------------------------------------------------------------------

import { formatCoordinates } from './geo.js';
import { localize, pick } from './i18n.js';

/** "at 1.25 km from home" / "at home" / '' when unknown. */
function homePart(language, { atHome, distanceKm }) {
  if (atHome === true) {
    return pick(language, { en: 'at home', fr: 'à la maison', de: 'zu Hause', es: 'en casa' });
  }
  if (distanceKm === null || distanceKm === undefined) {
    return '';
  }
  return pick(language, {
    en: `${distanceKm} km from home`,
    fr: `à ${distanceKm} km de la maison`,
    de: `${distanceKm} km von zu Hause`,
    es: `a ${distanceKm} km de casa`,
  });
}

/** Short state of a device, e.g. "at home" / "3.2 km from home" / "Office". */
export function shortState(language, item) {
  const home = homePart(language, item);
  if (home) return home;
  if (item.position?.place) return item.position.place;
  if (Number.isFinite(item.position?.latitude)) return formatCoordinates(item.position);
  return pick(language, {
    en: 'position unknown',
    fr: 'position inconnue',
    de: 'Position unbekannt',
    es: 'posición desconocida',
  });
}

/** The answer of a locate order. */
export function locatedMessage(name, item) {
  if (!item.position) {
    return localize((language) =>
      pick(language, {
        en: `${name} did not answer in time (offline or switched off?). Try again later.`,
        fr: `${name} n'a pas répondu à temps (hors ligne ou éteint ?). Réessayez plus tard.`,
        de: `${name} hat nicht rechtzeitig geantwortet (offline oder ausgeschaltet?). Versuche es später erneut.`,
        es: `${name} no respondió a tiempo (¿sin conexión o apagado?). Inténtelo más tarde.`,
      }),
    );
  }
  return localize((language) => {
    const parts = [shortState(language, item)];
    if (Number.isFinite(item.position.latitude) && !parts[0].includes(',')) {
      parts.push(formatCoordinates(item.position));
    }
    if (item.position.accuracy) {
      parts.push(`± ${Math.round(item.position.accuracy)} m`);
    }
    return `${name}: ${parts.join(', ')}.`;
  });
}

export function ringMessage(name, start) {
  return localize((language) =>
    start
      ? pick(language, {
          en: `${name} is ringing.`,
          fr: `${name} sonne.`,
          de: `${name} klingelt.`,
          es: `${name} está sonando.`,
        })
      : pick(language, {
          en: `${name} stopped ringing.`,
          fr: `${name} ne sonne plus.`,
          de: `${name} klingelt nicht mehr.`,
          es: `${name} dejó de sonar.`,
        }),
  );
}

export const UNKNOWN_DEVICE = {
  en: 'Unknown device: refresh the device list and pick it again.',
  fr: 'Appareil inconnu : rafraîchissez la liste des appareils et choisissez-le à nouveau.',
  de: 'Unbekanntes Gerät: Aktualisiere die Geräteliste und wähle es erneut.',
  es: 'Dispositivo desconocido: actualice la lista de dispositivos y elíjalo de nuevo.',
};
