// -----------------------------------------------------------------------------
// Minimal Protocol Buffers wire codec.
//
// Google's Find My Device API (Nova), its push channel (MCS) and the decrypted
// location reports all speak protobuf. The integration only needs a handful of
// messages, so instead of a code generator and a runtime dependency it writes
// and reads the wire format directly:
//   - `encode([[field, kind, value], ...])` builds a message;
//   - `decode(buffer)` returns the raw fields, grouped by number, that the
//     readers below turn into numbers, strings, bytes or nested messages.
// Unknown fields are kept and ignored, like any protobuf reader does: Google
// adds fields to its answers all the time.
// -----------------------------------------------------------------------------

const WIRE = { VARINT: 0, FIXED64: 1, BYTES: 2, FIXED32: 5 };

/** Encode an unsigned integer (number or BigInt) as a base-128 varint. */
export function encodeVarint(value) {
  let n = BigInt(value);
  if (n < 0n) {
    // Negative int32/int64 are sent as their 64-bit two's complement.
    n = BigInt.asUintN(64, n);
  }
  const bytes = [];
  do {
    let byte = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (n > 0n);
  return Buffer.from(bytes);
}

/**
 * Read a varint at `offset`.
 * @returns {{ value: bigint, offset: number }} the value and the next offset
 */
export function readVarint(buffer, offset) {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    if (offset >= buffer.length) {
      throw new Error('Truncated protobuf varint');
    }
    const byte = buffer[offset];
    offset += 1;
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value: result, offset };
    }
    shift += 7n;
    if (shift > 70n) {
      throw new Error('Protobuf varint too long');
    }
  }
}

function key(field, wireType) {
  return encodeVarint((field << 3) | wireType);
}

/**
 * Build a message from `[field, kind, value]` entries. Kinds:
 * `varint` (number | bigint | boolean), `string`, `bytes` (Buffer),
 * `message` (Buffer, an already encoded message), `fixed32` / `sfixed32`
 * (number), `float` (number). An `undefined` or `null` value is skipped, so
 * optional fields can be listed unconditionally.
 */
export function encode(entries) {
  const parts = [];
  for (const [field, kind, value] of entries) {
    if (value === undefined || value === null) {
      continue;
    }
    switch (kind) {
      case 'varint':
        parts.push(
          key(field, WIRE.VARINT),
          encodeVarint(value === true ? 1 : value === false ? 0 : value),
        );
        break;
      case 'string':
      case 'bytes':
      case 'message': {
        const payload = kind === 'string' ? Buffer.from(String(value), 'utf8') : Buffer.from(value);
        parts.push(key(field, WIRE.BYTES), encodeVarint(payload.length), payload);
        break;
      }
      case 'fixed32':
      case 'sfixed32':
      case 'float': {
        const payload = Buffer.alloc(4);
        if (kind === 'float') payload.writeFloatLE(value);
        else if (kind === 'sfixed32') payload.writeInt32LE(value);
        else payload.writeUInt32LE(value);
        parts.push(key(field, WIRE.FIXED32), payload);
        break;
      }
      default:
        throw new Error(`Unknown protobuf kind: ${kind}`);
    }
  }
  return Buffer.concat(parts);
}

function fixed(buffer, offset, size) {
  if (offset + size > buffer.length) {
    throw new Error('Truncated protobuf field');
  }
  return buffer.subarray(offset, offset + size);
}

/**
 * Split a message into its raw fields.
 * @returns {Map<number, Array<{ wireType: number, value: bigint | Buffer }>>}
 */
export function decode(buffer) {
  const fields = new Map();
  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const field = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 7n);
    let value;
    switch (wireType) {
      case WIRE.VARINT: {
        const read = readVarint(buffer, offset);
        value = read.value;
        offset = read.offset;
        break;
      }
      case WIRE.FIXED64:
        value = fixed(buffer, offset, 8);
        offset += 8;
        break;
      case WIRE.BYTES: {
        const length = readVarint(buffer, offset);
        offset = length.offset;
        const end = offset + Number(length.value);
        if (end > buffer.length) {
          throw new Error('Truncated protobuf field');
        }
        value = buffer.subarray(offset, end);
        offset = end;
        break;
      }
      case WIRE.FIXED32:
        value = fixed(buffer, offset, 4);
        offset += 4;
        break;
      default:
        throw new Error(`Unsupported protobuf wire type ${wireType}`);
    }
    if (!fields.has(field)) {
      fields.set(field, []);
    }
    fields.get(field).push({ wireType, value });
  }
  return fields;
}

// --- Readers: one value of a decoded message, with the proto3 defaults --------

function last(fields, field) {
  const values = fields.get(field);
  return values ? values[values.length - 1] : undefined;
}

/** An unsigned varint as a number (0 when absent). */
export function uint(fields, field) {
  const entry = last(fields, field);
  return entry && entry.wireType === WIRE.VARINT ? Number(entry.value) : 0;
}

/** A signed int32 varint (sent as 64-bit two's complement when negative). */
export function int32(fields, field) {
  const entry = last(fields, field);
  return entry && entry.wireType === WIRE.VARINT ? Number(BigInt.asIntN(32, entry.value)) : 0;
}

/** A boolean varint (false when absent). */
export function bool(fields, field) {
  return uint(fields, field) !== 0;
}

/** A UTF-8 string ('' when absent). */
export function string(fields, field) {
  const entry = last(fields, field);
  return entry && entry.wireType === WIRE.BYTES ? entry.value.toString('utf8') : '';
}

/** Raw bytes (an empty Buffer when absent). */
export function bytes(fields, field) {
  const entry = last(fields, field);
  return entry && entry.wireType === WIRE.BYTES ? Buffer.from(entry.value) : Buffer.alloc(0);
}

/** A nested message, decoded (undefined when absent). */
export function message(fields, field) {
  const entry = last(fields, field);
  return entry && entry.wireType === WIRE.BYTES ? decode(entry.value) : undefined;
}

/** Every occurrence of a repeated nested message, decoded. */
export function messages(fields, field) {
  return (fields.get(field) ?? [])
    .filter((entry) => entry.wireType === WIRE.BYTES)
    .map((entry) => decode(entry.value));
}

/** Every occurrence of a repeated string. */
export function strings(fields, field) {
  return (fields.get(field) ?? [])
    .filter((entry) => entry.wireType === WIRE.BYTES)
    .map((entry) => entry.value.toString('utf8'));
}

/** A `sfixed32` (0 when absent). */
export function sfixed32(fields, field) {
  const entry = last(fields, field);
  return entry && entry.wireType === WIRE.FIXED32 ? entry.value.readInt32LE(0) : 0;
}

/** A `float` (0 when absent). */
export function float(fields, field) {
  const entry = last(fields, field);
  return entry && entry.wireType === WIRE.FIXED32 ? entry.value.readFloatLE(0) : 0;
}

/** Whether a field is present at all. */
export function has(fields, field) {
  return fields.has(field);
}
