// -----------------------------------------------------------------------------
// Small geographic helpers: distance to home, presence, map links.
// -----------------------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_000;

function radians(degrees) {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a, b) {
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Whether a position is at home. The accuracy circle is given the benefit of
 * the doubt, up to the radius itself: a phone indoors often reports 50-100 m
 * of uncertainty, and flapping between "home" and "away" would fire scenes for
 * nothing.
 */
export function isAtHome(distance, accuracy, radius) {
  return distance <= radius + Math.min(Math.max(accuracy || 0, 0), radius);
}

/** Google Maps link of a position. */
export function mapsUrl({ latitude, longitude }) {
  return `https://www.google.com/maps/search/?api=1&query=${latitude.toFixed(6)},${longitude.toFixed(6)}`;
}

/** "48.856610, 2.352220". */
export function formatCoordinates({ latitude, longitude }) {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

/** Kilometres with two decimals. */
export function toKm(meters) {
  return Math.round(meters / 10) / 100;
}
