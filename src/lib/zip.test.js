import { describe, expect, it } from 'vitest';
import { crc32, unzip, zip, zipPathError } from './zip.js';

const text = (/** @type {string} */ value) => new TextEncoder().encode(value);
const bytesOf = async (/** @type {Blob} */ blob) => new Uint8Array(await blob.arrayBuffer());

/**
 * A folder `Shelf` with `main.kup` and `parts/lid.kup` in it, zipped by Info-ZIP's `zip -X -r`
 * (as macOS has it): its folders stored, its files deflated.
 */
const INFO_ZIP = Uint8Array.from(
  atob(
    'UEsDBAoAAAAAAFQMZ10AAAAAAAAAAAAAAAAGAAAAU2hlbGYvUEsDBAoAAAAAAFQMZ10AAAAAAAAAAAAAAAAMAAAAU2hlbGYv' +
      'cGFydHMvUEsDBBQAAAAIAFQMZ11v+yBoKgAAAHsAAAATAAAAU2hlbGYvcGFydHMvbGlkLmt1cFNWcFTIyUzhSklNA9Ea5Zpc' +
      'CgrJpUmpGtHlOgpAZBSryZWal8KlTHWFAFBLAwQUAAAACABUDGddtPWnoy0AAAAuAAAADgAAAFNoZWxmL21haW4ua3Vwy8wt' +
      'yC8qUahWyMlMUahVSCvKz1VQ0tMvSCwqKdYHiulllxYocQEZGiYGmlwAUEsBAh4DCgAAAAAAVAxnXQAAAAAAAAAAAAAAAAYA' +
      'AAAAAAAAAAAQAO1BAAAAAFNoZWxmL1BLAQIeAwoAAAAAAFQMZ10AAAAAAAAAAAAAAAAMAAAAAAAAAAAAEADtQSQAAABTaGVs' +
      'Zi9wYXJ0cy9QSwECHgMUAAAACABUDGddb/sgaCoAAAB7AAAAEwAAAAAAAAABAAAApIFOAAAAU2hlbGYvcGFydHMvbGlkLmt1' +
      'cFBLAQIeAxQAAAAIAFQMZ1209aejLQAAAC4AAAAOAAAAAAAAAAEAAACkgakAAABTaGVsZi9tYWluLmt1cFBLBQYAAAAABAAE' +
      'AOsAAAACAQAAAAA=',
  ),
  (character) => character.charCodeAt(0),
);

/**
 * A zip of one stored file named `name`, holding `data`, its CRC as given (the right one unless
 * said): a zip no writer of ours would make.
 * @param {string} name
 * @param {Uint8Array<ArrayBuffer>} data
 */
async function oneFile(name, data, crc = crc32(data)) {
  const bytes = await bytesOf(await zip([{ path: 'x'.repeat(name.length), data }]));
  const view = new DataView(bytes.buffer);
  const encoded = text(name);
  // The name in the local header and in the central one, both its own length long
  bytes.set(encoded, 30);
  const central = view.getUint32(bytes.length - 6, true);
  bytes.set(encoded, central + 46);
  view.setUint32(14, crc, true);
  view.setUint32(central + 16, crc, true);
  return bytes;
}

describe('a zip', () => {
  it('holds the files and folders it was made of, read back as they were', async () => {
    const big = text('cube(1)\n'.repeat(500));
    const binary = Uint8Array.from({ length: 300 }, (_, i) => (i * 7919) % 256);
    const made = await zip([
      { path: 'Shelf' },
      { path: 'Shelf/main.kup', data: big, modified: Date.UTC(2026, 10, 7, 12, 30) },
      { path: 'Shelf/parts' },
      { path: 'Shelf/parts/logo.svg', data: binary },
      { path: 'Shelf/Ящик 😀.kup', data: text('') },
    ]);
    expect(made.type).toBe('application/zip');
    // Deflated where that makes it smaller
    expect(made.size).toBeLessThan(big.length);
    const read = await unzip(await bytesOf(made));
    expect(read.map(({ path, data }) => [path, data && [...data]])).toEqual([
      ['Shelf', undefined],
      ['Shelf/main.kup', [...big]],
      ['Shelf/parts', undefined],
      ['Shelf/parts/logo.svg', [...binary]],
      ['Shelf/Ящик 😀.kup', []],
    ]);
  });

  it('is read as another tool made it', async () => {
    const read = await unzip(INFO_ZIP);
    const decoder = new TextDecoder();
    expect(read.map(({ path, data }) => [path, data && decoder.decode(data)])).toEqual([
      ['Shelf', undefined],
      ['Shelf/parts', undefined],
      ['Shelf/parts/lid.kup', '# A lid\ndef lid(w)\n  cube([w, w, 2])\nend\n'.repeat(3)],
      ['Shelf/main.kup', 'import { lid } from "./parts/lid.kup"\nlid(40)\n'],
    ]);
  });

  it('has the fields another tool reads first where the format puts them', async () => {
    // The fields another tool checks, as Info-ZIP's: the end record, a deflated file's
    const made = await bytesOf(await zip([{ path: 'a.kup', data: text('cube(1)\n'.repeat(50)) }]));
    const view = new DataView(made.buffer);
    expect(view.getUint32(made.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(8, true)).toBe(8);
    expect(view.getUint32(14, true)).toBe(crc32(text('cube(1)\n'.repeat(50))));
  });

  it('is refused where a file is damaged: its CRC not what it holds', async () => {
    await expect(unzip(await oneFile('a.kup', text('cube(1)'), 1234))).rejects.toThrow(
      'The zip has “a.kup” damaged.',
    );
  });

  it('is refused where a deflated file unpacks to more than it says', async () => {
    const made = await bytesOf(await zip([{ path: 'a.kup', data: text('cube(1)\n'.repeat(50)) }]));
    const view = new DataView(made.buffer);
    const central = view.getUint32(made.length - 6, true);
    view.setUint32(central + 24, 10, true);
    await expect(unzip(made)).rejects.toThrow('The zip has “a.kup” damaged.');
  });

  it.each([
    ['../escape.kup', 'leaves its folder'],
    ['parts/../../escape.kup', 'leaves its folder'],
    ['/etc/passwd', 'isn’t relative'],
    ['C:/escape.kup', 'isn’t relative'],
    ['parts\\escape.kup', 'has a \\'],
    ['parts//lid.kup', 'isn’t plain'],
  ])('is refused where a path leaves its folder: %j', async (name, why) => {
    await expect(unzip(await oneFile(name, text('cube(1)')))).rejects.toThrow(
      `The zip has a path that ${why}: “${name}”.`,
    );
  });

  it('is refused where it holds more than its limits', async () => {
    const made = await bytesOf(
      await zip([
        { path: 'a.kup', data: text('cube(1)\n'.repeat(100)) },
        { path: 'b.kup', data: text('cube(2)') },
      ]),
    );
    await expect(unzip(made, { entries: 1 })).rejects.toThrow('has more than 1 files');
    await expect(unzip(made, { bytes: 100 })).rejects.toThrow('holds more than');
    expect(await unzip(made, { entries: 2, bytes: 807 })).toHaveLength(2);
  });

  it('is refused where it is no zip, or holds a path twice', async () => {
    await expect(unzip(text('not a zip'))).rejects.toThrow('The zip is damaged, or no zip.');
    await expect(
      unzip(await bytesOf(await zip([{ path: 'a' }, { path: 'a', data: text('') }]))),
    ).rejects.toThrow('The zip has “a” twice.');
  });
});

describe("a zip's path", () => {
  it('is a plain one, relative, in its folder', () => {
    expect(zipPathError('parts/lid.kup')).toBeNull();
    expect(zipPathError('..a/b..')).toBeNull();
    expect(zipPathError('')).toBe('isn’t relative');
    expect(zipPathError('a/./b')).toBe('isn’t plain');
    expect(zipPathError('a\u0000b')).toBe('has control characters');
  });
});
