// -----------------------------------------------------------------------------
// Dashboard widget "Find My Device" (manifest `widgets`, Gladys 5.1+).
//
// Two layouts, chosen by the per-instance `device` setting:
//   - empty (default): every device in a card list — state (home / distance /
//     place), time of the last position, map link — plus "Locate all" and a
//     "Ring" button whose form picks the device;
//   - one device: live tiles bound to its distance and accuracy features,
//     its location, and Ring / Locate buttons.
// The content is declarative; the core renders it with its theme and dark
// mode. Positions change through the service, which nudges the widget with
// `requestWidgetRefresh` (see service.refreshWidget).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { FEATURES, deviceIds } from '../devices.js';
import { formatCoordinates, mapsUrl } from '../geo.js';
import { localize, pick } from '../i18n.js';
import { locatedMessage, ringMessage, shortState, UNKNOWN_DEVICE } from '../messages.js';
import { WIDGET_KEY } from '../service.js';

export { WIDGET_KEY };

export const WIDGET_ACTIONS = {
  LOCATE_ALL: 'locate_all',
  LOCATE: 'locate',
  RING: 'ring',
};

const MAX_ITEMS = 8;

function clip(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Every language of a message, clipped (widget texts are bounded). */
function clipAll(message, max) {
  return Object.fromEntries(Object.entries(message).map(([lang, text]) => [lang, clip(text, max)]));
}

function badge(item) {
  if (item.atHome === true) {
    return {
      text: { en: 'Home', fr: 'Maison', de: 'Zuhause', es: 'Casa' },
      color: WIDGET_COLORS.SUCCESS,
    };
  }
  if (item.atHome === false) {
    return {
      text: { en: 'Away', fr: 'Absent', de: 'Unterwegs', es: 'Fuera' },
      color: WIDGET_COLORS.INFO,
    };
  }
  return undefined;
}

function cardItem(item) {
  const card = {
    title: clip(item.name, 60),
    subtitle: localize((language) => clip(shortState(language, item), 60)),
  };
  if (item.position?.time) {
    card.date = new Date(item.position.time * 1000).toISOString();
  }
  const itemBadge = badge(item);
  if (itemBadge) card.badge = itemBadge;
  if (Number.isFinite(item.position?.latitude)) {
    card.links = [
      {
        url: mapsUrl(item.position),
        label: { en: 'Open the map', fr: 'Voir la carte', de: 'Karte öffnen', es: 'Ver el mapa' },
      },
    ];
  }
  return card;
}

function notConfigured(service) {
  const message = service.status.error ?? {
    en: 'Paste your secrets.json in the integration configuration.',
    fr: "Collez votre secrets.json dans la configuration de l'intégration.",
    de: 'Füge deine secrets.json in die Konfiguration der Integration ein.',
    es: 'Pegue su secrets.json en la configuración de la integración.',
  };
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', text: clipAll(message, 300), variant: 'body' }],
  };
}

function allDevices(service, items) {
  if (items.length === 0) {
    return {
      ttl_seconds: 300,
      components: [
        {
          type: 'text',
          text: {
            en: 'No device found on this Google account yet.',
            fr: 'Aucun appareil trouvé sur ce compte Google pour le moment.',
            de: 'Noch kein Gerät in diesem Google-Konto gefunden.',
            es: 'Aún no se ha encontrado ningún dispositivo en esta cuenta de Google.',
          },
          variant: 'body',
        },
      ],
    };
  }
  const options = items.slice(0, 50).map((item) => ({
    value: item.externalId,
    label: { en: clip(item.name, 40) },
  }));
  return {
    // Positions are pushed with a refresh nudge; the TTL is a safety net.
    ttl_seconds: 300,
    components: [
      { type: 'card-list', display: 'list', items: items.slice(0, MAX_ITEMS).map(cardItem) },
      {
        type: 'button',
        label: { en: 'Locate all', fr: 'Tout localiser', de: 'Alle orten', es: 'Localizar todo' },
        icon: 'crosshair',
        style: 'primary',
        action: { key: WIDGET_ACTIONS.LOCATE_ALL },
      },
      {
        type: 'button',
        label: { en: 'Ring', fr: 'Faire sonner', de: 'Klingeln', es: 'Hacer sonar' },
        icon: 'bell',
        style: 'secondary',
        action: {
          key: WIDGET_ACTIONS.RING,
          fields: [
            {
              key: 'device',
              type: 'select',
              label: { en: 'Device', fr: 'Appareil', de: 'Gerät', es: 'Dispositivo' },
              required: true,
              options,
            },
          ],
        },
      },
    ],
  };
}

function oneDevice(gladys, item) {
  const ids = deviceIds(gladys, item.canonicId);
  const components = [];
  if (item.distanceKm !== null) {
    components.push({
      type: 'value',
      label: { en: 'From home', fr: 'De la maison', de: 'Von zu Hause', es: 'Desde casa' },
      icon: 'home',
      device_feature: ids.feature(FEATURES.DISTANCE),
    });
  }
  components.push({
    type: 'value',
    label: { en: 'Accuracy', fr: 'Précision', de: 'Genauigkeit', es: 'Precisión' },
    icon: 'target',
    device_feature: ids.feature(FEATURES.ACCURACY),
  });
  const statusItems = [
    {
      label: { en: 'Location', fr: 'Position', de: 'Position', es: 'Posición' },
      icon: 'map-pin',
      value: localize((language) =>
        clip(
          item.position?.place ||
            (Number.isFinite(item.position?.latitude)
              ? formatCoordinates(item.position)
              : shortState(language, item)),
          40,
        ),
      ),
      color: WIDGET_COLORS.NEUTRAL,
    },
  ];
  const itemBadge = badge(item);
  if (itemBadge) {
    statusItems.push({
      label: { en: 'Presence', fr: 'Présence', de: 'Anwesenheit', es: 'Presencia' },
      icon: 'home',
      value: itemBadge.text,
      color: itemBadge.color,
    });
  }
  components.push({ type: 'status', items: statusItems });
  components.push({
    type: 'button',
    label: { en: 'Locate', fr: 'Localiser', de: 'Orten', es: 'Localizar' },
    icon: 'crosshair',
    style: 'primary',
    action: { key: WIDGET_ACTIONS.LOCATE, params: { device: item.externalId } },
  });
  components.push({
    type: 'button',
    label: { en: 'Ring', fr: 'Faire sonner', de: 'Klingeln', es: 'Hacer sonar' },
    icon: 'bell',
    style: 'secondary',
    device_feature: ids.feature(FEATURES.RING),
    value: 1,
  });
  return { ttl_seconds: 300, components };
}

/** @param {import('../service.js').FindMyService} service */
export function createWidgets(service) {
  return {
    [WIDGET_KEY]: {
      async get(gladys, { settings = {} }) {
        const items = service.summary();
        if (!service.status.configured || (!service.status.ok && items.length === 0)) {
          return notConfigured(service);
        }
        const focused = settings.device
          ? items.find((item) => item.externalId === settings.device)
          : null;
        return focused ? oneDevice(gladys, focused) : allDevices(service, items);
      },

      // Toasts are capped at 200 characters by the core.
      async action(gladys, { actionKey, params = {}, values = {} }) {
        if (actionKey === WIDGET_ACTIONS.LOCATE_ALL) {
          const total = service.devices.size;
          const answered = await service.locateAll();
          return localize((language) =>
            pick(language, {
              en: `${answered} of ${total} device(s) answered.`,
              fr: `${answered} appareil(s) sur ${total} ont répondu.`,
              de: `${answered} von ${total} Gerät(en) haben geantwortet.`,
              es: `${answered} de ${total} dispositivo(s) respondieron.`,
            }),
          );
        }
        if (actionKey === WIDGET_ACTIONS.LOCATE || actionKey === WIDGET_ACTIONS.RING) {
          const externalId = actionKey === WIDGET_ACTIONS.RING ? values.device : params.device;
          const canonicId = service.canonicIdOf(externalId);
          if (!canonicId) return clipAll(UNKNOWN_DEVICE, 200);
          if (actionKey === WIDGET_ACTIONS.RING) {
            await service.ring(canonicId, true);
            return clipAll(ringMessage(service.nameOf(canonicId), true), 200);
          }
          await service.locate(canonicId);
          const item = service.summary().find((entry) => entry.canonicId === canonicId);
          return clipAll(locatedMessage(item.name, item), 200);
        }
        throw new Error(`Unknown widget action: ${actionKey}`);
      },
    },
  };
}
