// Zip files, written and read in the browser with nothing but its own streams: a file deflated
// where that makes it smaller (CompressionStream('deflate-raw')), stored as it is otherwise, and
// read back stored or deflated (DecompressionStream). Enough of the format for a folder of files
// (no Zip64, no encryption, one disk), which is what a workspace is downloaded and imported as.
// A zip is taken from anyone, so reading it trusts none of it: its paths must stay in its folder,
// its sizes are held to limits and to what they say, and every file's CRC is checked.

/** The most files and folders a zip read may hold. */
export const MAX_ZIP_ENTRIES = 10_000;
/** The most bytes a zip read may hold, its files unpacked, and the most the zip itself may be. */
export const MAX_ZIP_BYTES = 256 * 1024 * 1024;

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
/** The end record's size, without the comment that may follow it. */
const END_SIZE = 22;
/** The longest a zip's comment may be, which the end record may be followed by. */
const MAX_COMMENT = 0xffff;
/** Version 2.0: what deflate and folders need. */
const VERSION = 20;
/** The flag that says a name (and comment) is UTF-8. */
const UTF8_FLAG = 0x0800;
/** The flag that says a file is encrypted. */
const ENCRYPTED_FLAG = 0x0001;
const STORED = 0;
const DEFLATED = 8;
/** The value a field too small for its number holds in a Zip64 zip. */
const ZIP64_MARK = 0xffffffff;

/**
 * A file or folder of a zip: a folder has no data.
 * @typedef {{ path: string, data?: Uint8Array<ArrayBuffer>, modified?: number }} ZipEntry
 */

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

/**
 * The CRC-32 a zip checks each file by.
 * @param {Uint8Array} data
 */
export function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * `data` passed through a compression or decompression stream.
 * @param {Uint8Array<ArrayBuffer>} data
 * @param {TransformStream<BufferSource, Uint8Array<ArrayBuffer>>} stream
 */
const through = async (data, stream) =>
  new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer());

/**
 * The date and time a zip keeps, as MS-DOS has them: local time, to two seconds, from 1980.
 * @param {number} time milliseconds since the epoch
 */
function dosTime(time) {
  const date = new Date(Math.max(time, new Date(1980, 0, 1).getTime()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * A zip of `entries`, each at its path (a folder's given a trailing `/`), a file deflated where
 * that makes it smaller.
 * @param {ZipEntry[]} entries
 * @returns {Promise<Blob>}
 */
export async function zip(entries) {
  const encoder = new TextEncoder();
  /** @type {BlobPart[]} */
  const parts = [];
  /** @type {Uint8Array<ArrayBuffer>[]} */
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const folder = entry.data === undefined;
    const name = encoder.encode(folder ? `${entry.path}/` : entry.path);
    const data = entry.data ?? new Uint8Array();
    const deflated = folder ? data : await through(data, new CompressionStream('deflate-raw'));
    const smaller = deflated.length < data.length;
    const stored = smaller ? deflated : data;
    const { time, date } = dosTime(entry.modified ?? Date.now());
    const fields = {
      method: smaller ? DEFLATED : STORED,
      time,
      date,
      crc: crc32(data),
      compressed: stored.length,
      size: data.length,
    };

    const local = new DataView(new ArrayBuffer(30 + name.length));
    local.setUint32(0, LOCAL_HEADER, true);
    local.setUint16(4, VERSION, true);
    local.setUint16(6, UTF8_FLAG, true);
    local.setUint16(8, fields.method, true);
    local.setUint16(10, fields.time, true);
    local.setUint16(12, fields.date, true);
    local.setUint32(14, fields.crc, true);
    local.setUint32(18, fields.compressed, true);
    local.setUint32(22, fields.size, true);
    local.setUint16(26, name.length, true);
    new Uint8Array(local.buffer).set(name, 30);
    parts.push(local.buffer, stored);

    const header = new DataView(new ArrayBuffer(46 + name.length));
    header.setUint32(0, CENTRAL_HEADER, true);
    header.setUint16(4, VERSION, true);
    header.setUint16(6, VERSION, true);
    header.setUint16(8, UTF8_FLAG, true);
    header.setUint16(10, fields.method, true);
    header.setUint16(12, fields.time, true);
    header.setUint16(14, fields.date, true);
    header.setUint32(16, fields.crc, true);
    header.setUint32(20, fields.compressed, true);
    header.setUint32(24, fields.size, true);
    header.setUint16(28, name.length, true);
    // MS-DOS's directory attribute, for a folder
    header.setUint32(38, folder ? 0x10 : 0, true);
    header.setUint32(42, offset, true);
    new Uint8Array(header.buffer).set(name, 46);
    central.push(new Uint8Array(header.buffer));

    offset += local.byteLength + stored.length;
  }
  const centralSize = central.reduce((sum, header) => sum + header.length, 0);
  const end = new DataView(new ArrayBuffer(END_SIZE));
  end.setUint32(0, END_OF_CENTRAL_DIRECTORY, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

/**
 * Why `path`, a zip's, can't be a file's in the folder it is unpacked in, or null: it must be
 * relative, stay in the folder (no `..`), and be plain (no `\`, no empty or `.` parts, no
 * control characters).
 * @param {string} path
 */
export function zipPathError(path) {
  if (path === '' || path.startsWith('/') || /^[a-z]:/i.test(path)) return 'isn’t relative';
  if (path.includes('\\')) return 'has a \\';
  if (/\p{Cc}/u.test(path)) return 'has control characters';
  const names = path.split('/');
  if (names.includes('..')) return 'leaves its folder';
  if (names.some((name) => name === '' || name === '.')) return 'isn’t plain';
  return null;
}

/**
 * The files and folders of the zip `bytes`, by their paths (a folder's without its trailing
 * `/`), in the order it has them; refused, with why, where it is damaged, holds what it may not
 * (an encrypted file, a Zip64 one, a path out of its folder, one path twice), or holds more than
 * `limits`.
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @param {{ entries?: number, bytes?: number }} [limits]
 * @returns {Promise<ZipEntry[]>}
 */
export async function unzip(
  bytes,
  { entries: maxEntries = MAX_ZIP_ENTRIES, bytes: maxBytes = MAX_ZIP_BYTES } = {},
) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  /** A field of the zip, refused where it runs past the end. @param {number} at */
  const u16 = (at) => (at + 2 <= view.byteLength ? view.getUint16(at, true) : fail('is damaged'));
  /** @param {number} at */
  const u32 = (at) => (at + 4 <= view.byteLength ? view.getUint32(at, true) : fail('is damaged'));

  // The end record: the last one whose comment runs to the zip's end
  let end = -1;
  for (
    let at = view.byteLength - END_SIZE;
    at >= 0 && at >= view.byteLength - END_SIZE - MAX_COMMENT;
    at -= 1
  ) {
    if (u32(at) === END_OF_CENTRAL_DIRECTORY && at + END_SIZE + u16(at + 20) === view.byteLength) {
      end = at;
      break;
    }
  }
  if (end < 0) fail('is damaged, or no zip');
  if (u16(end + 4) !== 0 || u16(end + 6) !== 0) fail('is split over disks');
  const count = u16(end + 10);
  let at = u32(end + 16);
  if (count === 0xffff || at === ZIP64_MARK) fail('is a Zip64 one');
  if (count > maxEntries) fail(`has more than ${maxEntries} files`);

  const decoder = new TextDecoder();
  /** @type {ZipEntry[]} */
  const found = [];
  const paths = new Set();
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    if (u32(at) !== CENTRAL_HEADER) fail('is damaged');
    const flags = u16(at + 8);
    const method = u16(at + 10);
    const crc = u32(at + 16);
    const compressed = u32(at + 20);
    const size = u32(at + 24);
    const nameLength = u16(at + 28);
    const local = u32(at + 42);
    if (at + 46 + nameLength > view.byteLength) fail('is damaged');
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + u16(at + 30) + u16(at + 32);

    if (compressed === ZIP64_MARK || size === ZIP64_MARK || local === ZIP64_MARK) {
      fail('is a Zip64 one');
    }
    if (flags & ENCRYPTED_FLAG) fail(`has “${name}” encrypted`);
    const folder = name.endsWith('/');
    const path = folder ? name.slice(0, -1) : name;
    const error = zipPathError(path);
    if (error !== null) fail(`has a path that ${error}: “${name}”`);
    if (paths.has(path)) fail(`has “${path}” twice`);
    paths.add(path);
    if (folder) {
      found.push({ path });
      continue;
    }

    total += size;
    if (total > maxBytes) fail(`holds more than ${maxBytes / 1024 / 1024} MB`);
    if (u32(local) !== LOCAL_HEADER) fail('is damaged');
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    if (start + compressed > view.byteLength) fail('is damaged');
    const packed = bytes.subarray(start, start + compressed);
    let data;
    if (method === STORED) {
      data = packed;
    } else if (method === DEFLATED) {
      data = await inflate(packed, size).catch(() => fail(`has “${path}” damaged`));
    } else {
      fail(`has “${path}” compressed in a way not read here`);
    }
    if (data.length !== size || crc32(data) !== crc) fail(`has “${path}” damaged`);
    // Stored, it is a view of the zip: a copy of its own lets the zip go
    found.push({ path, data: method === STORED ? data.slice() : data });
  }
  return found;
}

/**
 * Refuses a zip, saying why.
 * @param {string} why
 * @returns {never}
 */
function fail(why) {
  throw new Error(`The zip ${why}.`);
}

/**
 * `packed` inflated, refused as soon as it unpacks past `size`, the size its zip says it has: a
 * zip lying about it unpacks no more than that.
 * @param {Uint8Array<ArrayBuffer>} packed
 * @param {number} size
 */
async function inflate(packed, size) {
  const reader = new Blob([packed])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader();
  const data = new Uint8Array(size);
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.length > size) {
      await reader.cancel();
      throw new RangeError('Larger than its zip says');
    }
    data.set(value, length);
    length += value.length;
  }
  return data.subarray(0, length);
}
