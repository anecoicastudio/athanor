// Run via `cd supabase/functions && deno test .` — executed in CI by the `edge` job.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { stripMetadata } from './strip.ts';

const A = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

// ── fixture builders ─────────────────────────────────────────────────────────────────

function jpegFixture(): Uint8Array {
  const soi = [0xff, 0xd8];
  const app0 = [0xff, 0xe0, 0x00, 0x08, ...A('JFIF\0'), 0x01]; // len 8 → 6 payload bytes
  const exifPayload = [...A('Exif\0\0'), ...A('GPSLATITUDE12.34')];
  const app1 = [0xff, 0xe1, 0x00, 2 + exifPayload.length, ...exifPayload];
  const com = [0xff, 0xfe, 0x00, 0x07, ...A('hello')];
  const sos = [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0xaa, 0xbb, 0xcc, 0xff, 0xd9];
  return new Uint8Array([...soi, ...app0, ...app1, ...com, ...sos]);
}

function pngChunk(type: string, data: number[]): number[] {
  const len = data.length;
  return [
    (len >>> 24) & 0xff,
    (len >>> 16) & 0xff,
    (len >>> 8) & 0xff,
    len & 0xff,
    ...A(type),
    ...data,
    0xde,
    0xad,
    0xbe,
    0xef, // CRC not validated by the stripper
  ];
}

function pngFixture(): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk('IHDR', new Array(13).fill(1)),
    ...pngChunk('tEXt', A('Comment\0made by camera')),
    ...pngChunk('eXIf', A('II*\0gpsdata')),
    ...pngChunk('IDAT', [1, 2, 3, 4]),
    ...pngChunk('IEND', []),
  ]);
}

function webpChunk(fourcc: string, data: number[]): number[] {
  const len = data.length;
  return [
    ...A(fourcc),
    len & 0xff,
    (len >>> 8) & 0xff,
    (len >>> 16) & 0xff,
    (len >>> 24) & 0xff,
    ...data,
    ...(len & 1 ? [0] : []),
  ];
}

function webpFixture(): Uint8Array {
  const vp8x = webpChunk('VP8X', [0x0c, 0, 0, 0, 9, 0, 0, 9, 0, 0]); // EXIF|XMP flags set
  const exif = webpChunk('EXIF', A('II*\0gps'));
  const vp8 = webpChunk('VP8 ', [9, 9, 9, 9]);
  const body = [...vp8x, ...exif, ...vp8];
  const size = body.length + 4; // + 'WEBP'
  return new Uint8Array([
    ...A('RIFF'),
    size & 0xff,
    (size >>> 8) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 24) & 0xff,
    ...A('WEBP'),
    ...body,
  ]);
}

function mp4Box(type: string, payload: number[]): number[] {
  const size = 8 + payload.length;
  return [
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    ...A(type),
    ...payload,
  ];
}

function mp4Fixture(): Uint8Array {
  const stco = mp4Box('stco', [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0x64]); // offset table
  const stbl = mp4Box('stbl', stco);
  const trakUdta = mp4Box('udta', mp4Box('©xyz', A('+45.4642+009.1900/')));
  const trak = mp4Box('trak', [...stbl, ...trakUdta]);
  const mvhd = mp4Box('mvhd', new Array(20).fill(7));
  const moovUdta = mp4Box('udta', [
    ...mp4Box('©xyz', A('+45.4642+009.1900/')),
    ...mp4Box('meta', A('appleGPSkeys')),
  ]);
  const moov = mp4Box('moov', [...mvhd, ...trak, ...moovUdta]);
  const ftyp = mp4Box('ftyp', A('isomiso2'));
  const mdat = mp4Box('mdat', [0xca, 0xfe, 0xba, 0xbe, 0x11, 0x22]);
  return new Uint8Array([...ftyp, ...moov, ...mdat]);
}

function mp3Fixture(): Uint8Array {
  const body = A('TXXXsomedata\0lat=45.46');
  const size = body.length;
  const id3 = [
    ...A('ID3'),
    3,
    0,
    0,
    (size >>> 21) & 0x7f,
    (size >>> 14) & 0x7f,
    (size >>> 7) & 0x7f,
    size & 0x7f,
    ...body,
  ];
  const frames = [0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4, 5, 6];
  const id3v1 = [...A('TAG'), ...A('title').concat(new Array(120).fill(0x41))];
  return new Uint8Array([...id3, ...frames, ...id3v1.slice(0, 128)]);
}

const findSeq = (hay: Uint8Array, needle: number[]): number => {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
};

// ── JPEG ─────────────────────────────────────────────────────────────────────────────

Deno.test('jpeg: drops APP1 EXIF + COM, keeps JFIF and scan bytes', () => {
  const src = jpegFixture();
  const { out, changed, kind } = stripMetadata(src.slice());
  assertEquals(kind, 'jpeg');
  assert(changed);
  assertEquals(findSeq(out, A('Exif\0\0')), -1);
  assertEquals(findSeq(out, A('GPSLATITUDE')), -1);
  assertEquals(findSeq(out, A('hello')), -1);
  assert(findSeq(out, A('JFIF')) >= 0, 'APP0/JFIF preserved');
  assert(
    findSeq(out, [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0xaa, 0xbb, 0xcc]) >= 0,
    'SOS+scan preserved',
  );
  assertEquals(out[out.length - 1], 0xd9, 'EOI preserved');
});

Deno.test('jpeg: idempotent — second pass reports changed=false', () => {
  const once = stripMetadata(jpegFixture().slice());
  const twice = stripMetadata(once.out.slice());
  assertEquals(twice.changed, false);
  assertEquals(twice.out, once.out);
});

// ── PNG ──────────────────────────────────────────────────────────────────────────────

Deno.test('png: drops tEXt + eXIf, keeps IHDR/IDAT/IEND', () => {
  const { out, changed, kind } = stripMetadata(pngFixture().slice());
  assertEquals(kind, 'png');
  assert(changed);
  assertEquals(findSeq(out, A('tEXt')), -1);
  assertEquals(findSeq(out, A('eXIf')), -1);
  assertEquals(findSeq(out, A('gpsdata')), -1);
  assert(findSeq(out, A('IHDR')) >= 0);
  assert(findSeq(out, A('IDAT')) >= 0);
  assert(findSeq(out, A('IEND')) >= 0);
});

Deno.test('png: idempotent', () => {
  const once = stripMetadata(pngFixture().slice());
  assertEquals(stripMetadata(once.out.slice()).changed, false);
});

// ── WebP ─────────────────────────────────────────────────────────────────────────────

Deno.test('webp: drops EXIF chunk, patches RIFF size, clears VP8X flags', () => {
  const { out, changed, kind } = stripMetadata(webpFixture().slice());
  assertEquals(kind, 'webp');
  assert(changed);
  assertEquals(findSeq(out, A('EXIF')), -1);
  assert(findSeq(out, A('VP8X')) >= 0);
  assert(findSeq(out, A('VP8 ')) >= 0);
  const riffSize = out[4]! | (out[5]! << 8) | (out[6]! << 16) | (out[7]! << 24);
  assertEquals(riffSize, out.length - 8, 'RIFF size patched');
  assertEquals(out[20]! & 0x0c, 0, 'VP8X EXIF/XMP flag bits cleared');
});

Deno.test('webp: idempotent', () => {
  const once = stripMetadata(webpFixture().slice());
  assertEquals(stripMetadata(once.out.slice()).changed, false);
});

// ── MP4 ──────────────────────────────────────────────────────────────────────────────

Deno.test('mp4: udta/meta become free boxes in place; length, stco and mdat untouched', () => {
  const src = mp4Fixture();
  const pristine = src.slice();
  const stcoAt = findSeq(pristine, A('stco'));
  const mdatAt = findSeq(pristine, A('mdat'));
  const { out, changed, kind } = stripMetadata(src);
  assertEquals(kind, 'mp4');
  assert(changed);
  assertEquals(out.length, pristine.length, 'total length unchanged (offsets stay valid)');
  assertEquals(findSeq(out, A('udta')), -1, 'no udta box remains');
  assertEquals(findSeq(out, A('©xyz')), -1, 'Apple GPS atom gone');
  assertEquals(findSeq(out, A('+45.4642')), -1, 'GPS coordinates gone');
  assertEquals(findSeq(out, A('appleGPSkeys')), -1, 'meta payload gone');
  // stco box (header + offset table) byte-identical at the same position
  assertEquals(out.subarray(stcoAt - 4, stcoAt + 16), pristine.subarray(stcoAt - 4, stcoAt + 16));
  // mdat byte-identical at the same position
  assertEquals(out.subarray(mdatAt - 4), pristine.subarray(mdatAt - 4));
  // the former moov/udta range now reads as a free box
  assert(findSeq(out, A('free')) >= 0);
});

Deno.test('mp4: idempotent — free boxes are not re-stripped', () => {
  const once = stripMetadata(mp4Fixture());
  const twice = stripMetadata(once.out.slice());
  assertEquals(twice.changed, false);
});

// ── MP3 ──────────────────────────────────────────────────────────────────────────────

Deno.test('mp3: zeroes ID3v2 body + blanks ID3v1, keeps audio frames', () => {
  const src = mp3Fixture();
  const pristine = src.slice();
  const frameAt = findSeq(pristine, [0xff, 0xfb, 0x90, 0x00, 1, 2, 3]);
  const { out, changed, kind } = stripMetadata(src);
  assertEquals(kind, 'mp3');
  assert(changed);
  assertEquals(findSeq(out, A('TXXX')), -1, 'ID3v2 frame content zeroed');
  assertEquals(findSeq(out, A('lat=45.46')), -1);
  assertEquals(findSeq(out, A('title')), -1, 'ID3v1 fields blanked');
  assertEquals(out.length, pristine.length, 'length unchanged');
  assertEquals(
    out.subarray(frameAt, frameAt + 10),
    pristine.subarray(frameAt, frameAt + 10),
    'audio frames untouched',
  );
  assert(findSeq(out, A('TAG')) >= 0, 'ID3v1 marker itself may remain (fields blank)');
});

Deno.test('mp3: idempotent', () => {
  const once = stripMetadata(mp3Fixture());
  assertEquals(stripMetadata(once.out.slice()).changed, false);
});

// ── dispatcher / clean inputs ────────────────────────────────────────────────────────

Deno.test('unknown format passes through unchanged', () => {
  const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const { changed, kind, out } = stripMetadata(junk);
  assertEquals(kind, 'unknown');
  assertEquals(changed, false);
  assertEquals(out, junk);
});

Deno.test('clean jpeg (no metadata segments) reports changed=false', () => {
  const clean = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x08,
    ...A('JFIF\0'),
    0x01,
    0xff,
    0xda,
    0x00,
    0x04,
    0x01,
    0x02,
    0xaa,
    0xff,
    0xd9,
  ]);
  const res = stripMetadata(clean.slice());
  assertEquals(res.kind, 'jpeg');
  assertEquals(res.changed, false);
});

Deno.test('webp: malformed tail (missing pad byte) is preserved, never dropped', () => {
  // final odd-length chunk WITHOUT the RIFF pad byte, preceded by an EXIF chunk:
  // the walker bails at the truncated chunk but must keep the tail bytes verbatim.
  const exif = webpChunk('EXIF', A('II*\0gps'));
  const truncated = [...A('VP8 '), 5, 0, 0, 0, 1, 2, 3, 4, 5]; // len 5, no pad, ends file
  const body = [...exif, ...truncated];
  const size = body.length + 4;
  const src = new Uint8Array([
    ...A('RIFF'),
    size & 0xff,
    (size >>> 8) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 24) & 0xff,
    ...A('WEBP'),
    ...body,
  ]);
  const { out, changed } = stripMetadata(src.slice());
  assert(changed, 'EXIF still dropped');
  assert(findSeq(out, [...A('VP8 '), 5, 0, 0, 0, 1, 2, 3, 4, 5]) >= 0, 'image tail preserved');
  assertEquals(findSeq(out, A('EXIF')), -1);
});

Deno.test('heic/avif ftyp brands pass through untouched', () => {
  for (const brand of ['heic', 'avif', 'mif1']) {
    const src = new Uint8Array([
      ...mp4Box('ftyp', [...A(brand), 0, 0, 0, 0]),
      ...mp4Box('meta', A('ilocDATA-this-is-the-image')),
    ]);
    const pristine = src.slice();
    const { out, changed, kind } = stripMetadata(src);
    assertEquals(kind, 'unknown', `${brand} not treated as mp4`);
    assertEquals(changed, false);
    assertEquals(out, pristine, `${brand} bytes untouched`);
  }
});

Deno.test('mp4 without udta/meta reports changed=false', () => {
  const bare = new Uint8Array([
    ...mp4Box('ftyp', A('isom')),
    ...mp4Box('moov', mp4Box('mvhd', [1, 2, 3])),
    ...mp4Box('mdat', [9, 9]),
  ]);
  const res = stripMetadata(bare);
  assertEquals(res.kind, 'mp4');
  assertEquals(res.changed, false);
});
