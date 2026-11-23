// -----------------------------------------------------------------------------
// The Find My Device (Nova) messages the integration sends and reads.
//
// Field numbers come from the reverse-engineered definitions of
// GoogleFindMyTools (ProtoDecoders/DeviceUpdate.proto and Common.proto,
// https://github.com/leonboe1/GoogleFindMyTools). Only the fields used here
// are written or read.
// -----------------------------------------------------------------------------

import * as pb from './protobuf.js';

/** DeviceType.SPOT_DEVICE: every device of the Find Hub network, phones included. */
export const SPOT_DEVICE = 2;

/** IdentifierInformationType.IDENTIFIER_ANDROID: a phone or tablet. */
const IDENTIFIER_ANDROID = 1;

/** SpotContributorType.FMDN_ALL_LOCATIONS: ask for every report, crowd-sourced included. */
const FMDN_ALL_LOCATIONS = 2;

/** Status of a location report (Common.proto). */
export const LOCATION_STATUS = {
  SEMANTIC: 0,
  LAST_KNOWN: 1,
  CROWDSOURCED: 2,
  AGGREGATED: 3,
};

/** SpotDeviceType names, for the device model shown in Gladys. */
const SPOT_DEVICE_TYPES = {
  1: 'beacon',
  2: 'headphones',
  3: 'keys',
  4: 'watch',
  5: 'wallet',
  7: 'bag',
  8: 'laptop',
  9: 'car',
  10: 'remote-control',
  11: 'badge',
  12: 'bike',
  13: 'camera',
  14: 'cat',
  15: 'charger',
  16: 'clothing',
  17: 'dog',
  18: 'notebook',
  19: 'passport',
  20: 'phone',
  21: 'speaker',
  22: 'tablet',
  23: 'toy',
  24: 'umbrella',
  25: 'stylus',
  26: 'earbuds',
};

// --- Requests ----------------------------------------------------------------

/** DevicesListRequest: the devices of the account. */
export function encodeDevicesListRequest(requestId) {
  const payload = pb.encode([
    [1, 'varint', SPOT_DEVICE],
    [3, 'string', requestId],
  ]);
  return pb.encode([[1, 'message', payload]]);
}

/** The ExecuteActionRequest skeleton shared by every action. */
function encodeAction({ canonicId, requestUuid, clientUuid, fcmToken, action }) {
  const scope = pb.encode([
    [2, 'varint', SPOT_DEVICE],
    [3, 'message', pb.encode([[1, 'message', pb.encode([[1, 'string', canonicId]])]])],
  ]);
  const metadata = pb.encode([
    [1, 'varint', SPOT_DEVICE],
    [2, 'string', requestUuid],
    [3, 'string', clientUuid],
    [4, 'message', pb.encode([[1, 'string', fcmToken]])],
    [6, 'varint', true],
  ]);
  return pb.encode([
    [1, 'message', scope],
    [2, 'message', action],
    [3, 'message', metadata],
  ]);
}

/**
 * Ask a device for its location. The answer does not come back in the HTTP
 * response: Google pushes it to the FCM token, tagged with `requestUuid`.
 */
export function encodeLocateRequest(options) {
  const locate = pb.encode([
    // Arbitrary, as in GoogleFindMyTools: the server only needs the field.
    [2, 'message', pb.encode([[1, 'varint', 1732120060]])],
    [3, 'varint', FMDN_ALL_LOCATIONS],
  ]);
  return encodeAction({ ...options, action: pb.encode([[30, 'message', locate]]) });
}

/** Make a device ring (`start: true`) or stop ringing (`start: false`). */
export function encodeSoundRequest({ start, ...options }) {
  // DEVICE_COMPONENT_UNSPECIFIED: an empty but PRESENT sub-message.
  const sound = Buffer.alloc(0);
  return encodeAction({ ...options, action: pb.encode([[start ? 31 : 32, 'message', sound]]) });
}

// --- Responses ---------------------------------------------------------------

function decodeTime(fields) {
  return fields ? pb.uint(fields, 1) : 0;
}

/** A LocationReport (Common.proto), its encrypted part left as bytes. */
function decodeLocationReport(fields) {
  const semantic = pb.message(fields, 5);
  const geo = pb.message(fields, 10);
  const encrypted = geo ? pb.message(geo, 1) : undefined;
  return {
    status: pb.uint(fields, 11),
    semanticName: semantic ? pb.string(semantic, 1) : '',
    publicKeyRandom: encrypted ? pb.bytes(encrypted, 1) : Buffer.alloc(0),
    encryptedLocation: encrypted ? pb.bytes(encrypted, 2) : Buffer.alloc(0),
    isOwnReport: encrypted ? pb.bool(encrypted, 3) : false,
    deviceTimeOffset: geo ? pb.uint(geo, 2) : 0,
    accuracy: geo ? pb.float(geo, 3) : 0,
  };
}

/** The reports of a DeviceInformation, paired with their timestamps. */
function decodeReports(information) {
  const locationInformation = information ? pb.message(information, 2) : undefined;
  const wrapper = locationInformation ? pb.message(locationInformation, 3) : undefined;
  const recent = wrapper ? pb.message(wrapper, 4) : undefined;
  if (!recent) {
    return [];
  }
  const network = pb.messages(recent, 5).map(decodeLocationReport);
  const times = pb.messages(recent, 6).map(decodeTime);
  const reports = network.map((report, i) => ({ ...report, time: times[i] ?? 0 }));
  if (pb.has(recent, 1)) {
    reports.push({
      ...decodeLocationReport(pb.message(recent, 1)),
      time: decodeTime(pb.message(recent, 2)),
    });
  }
  return reports;
}

/** A DeviceMetadata: identity, registration (for the keys) and reports. */
export function decodeDeviceMetadata(fields) {
  const identifier = pb.message(fields, 1) ?? new Map();
  const isAndroid = pb.uint(identifier, 2) === IDENTIFIER_ANDROID;
  const idsHolder = isAndroid
    ? pb.message(pb.message(identifier, 1) ?? new Map(), 2)
    : pb.message(identifier, 3);
  const canonicIds = idsHolder ? pb.messages(idsHolder, 1).map((id) => pb.string(id, 1)) : [];

  const information = pb.message(fields, 4);
  const registration = information ? pb.message(information, 1) : undefined;
  const typeInformation = registration ? pb.message(registration, 2) : undefined;
  const secrets = registration ? pb.message(registration, 19) : undefined;
  const image = pb.message(fields, 6);
  const spotType = typeInformation ? pb.uint(typeInformation, 2) : 0;

  return {
    canonicIds: canonicIds.filter(Boolean),
    name: pb.string(fields, 5),
    isAndroid,
    kind: isAndroid ? 'phone' : (SPOT_DEVICE_TYPES[spotType] ?? 'tracker'),
    manufacturer: registration ? pb.string(registration, 20) : '',
    model: registration ? pb.string(registration, 34) : '',
    fastPairModelId: registration ? pb.string(registration, 21) : '',
    encryptedIdentityKey: secrets ? pb.bytes(secrets, 1) : Buffer.alloc(0),
    ownerKeyVersion: secrets ? pb.uint(secrets, 3) : 0,
    imageUrl: image ? pb.string(image, 1) : '',
    reports: decodeReports(information),
  };
}

/** DevicesList: the answer of nbe_list_devices. */
export function decodeDevicesList(buffer) {
  return pb.messages(pb.decode(buffer), 2).map(decodeDeviceMetadata);
}

/** DeviceUpdate: the payload Google pushes after a locate request. */
export function decodeDeviceUpdate(buffer) {
  const fields = pb.decode(buffer);
  const fcmMetadata = pb.message(fields, 1);
  const metadata = pb.message(fields, 3);
  return {
    requestUuid: fcmMetadata ? pb.string(fcmMetadata, 2) : '',
    device: metadata ? decodeDeviceMetadata(metadata) : undefined,
  };
}

/** The decrypted Location message: degrees ×1e7 and an altitude in metres. */
export function decodeLocation(buffer) {
  const fields = pb.decode(buffer);
  return {
    latitude: pb.sfixed32(fields, 1) / 1e7,
    longitude: pb.sfixed32(fields, 2) / 1e7,
    altitude: pb.int32(fields, 3),
  };
}
