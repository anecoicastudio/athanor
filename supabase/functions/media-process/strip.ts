/**
 * media-process strip library — byte-level metadata removal, zero dependencies.
 *
 * Server-side defense-in-depth for EXIF/GPS/XMP/IPTC (backend 10 §4.1a, 11 §3.9a): the
 * client already re-encodes images (apps/native/src/lib/media/process.ts) and passes
 * `exif: false` to the picker; this library is the backstop for tampered clients and
 * direct Storage API uploads. The spec's binding assertion is outcome-based ("a photo
 * carrying GPS EXIF arrives in Storage with no location metadata") — a byte-level
 * segment/box strip meets it with zero quality loss and ~KB memory, vs decoding a
 * 50 MB file for a full re-encode.
 *
 * Formats: JPEG (drop APP1 EXIF/XMP, APP13 IPTC, COM), PNG (drop eXIf/tEXt/zTXt/iTXt/tIME),
 * WebP (drop EXIF/XMP RIFF chunks, patch RIFF size + VP8X flags), MP4/M4A (overwrite every
 * udta/meta box IN PLACE with a `free` box — sizes unchanged so stco/co64 chunk offsets
 * stay valid, no transcode), MP3 (zero the ID3v2 body + blank ID3v1 trailer in place).
 *
 * Every stripper is idempotent: a second pass finds nothing and reports changed=false —
 * this is also what terminates the storage-trigger re-upload loop.
 *
 * Accepted JPEG gaps (documented, not bugs): bytes after EOI survive verbatim (motion-photo
 * MP4 trailers), Extended-XMP APP1 (ns.adobe.com/xmp/extension/) and APP2/MPF are kept.
 * MP4: top-level `uuid` boxes (vendor XMP) are not stripped. HEIF-family brands are skipped
 * entirely (their `meta` box is the image itself — see dispatcher).
 */

export type StripResult = {
  out: Uint8Array;
  changed: boolean;
  kind: 'jpeg' | 'png' | 'webp' | 'mp4' | 'mp3' | 'unknown';
};

const ascii = (b: Uint8Array, off: number, len: number): string =>
  String.fromCharCode(...b.subarray(off, off + len));

const startsWith = (b: Uint8Array, off: number, sig: number[]): boolean =>
  sig.every((v, i) => b[off + i] === v);

// ── JPEG ─────────────────────────────────────────────────────────────────────────────

const XMP_NS = 'http://ns.adobe.com/xap/1.0/';

function stripJpeg(b: Uint8Array): StripResult {
  const kept: Uint8Array[] = [b.subarray(0, 2)]; // SOI
  let changed = false;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) break; // malformed — bail, copy rest verbatim
    const marker = b[i + 1]!;
    if (marker === 0xda) {
      // SOS — entropy-coded data + EOI follow; nothing after this carries EXIF. Copy verbatim.
      kept.push(b.subarray(i));
      i = b.length;
      break;
    }
    if (marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      kept.push(b.subarray(i, i + 2)); // standalone marker (no length)
      i += 2;
      continue;
    }
    const len = (b[i + 2]! << 8) | b[i + 3]!; // includes the 2 length bytes
    const segEnd = i + 2 + len;
    if (len < 2 || segEnd > b.length) break; // malformed — bail
    let drop = false;
    if (marker === 0xe1) {
      // APP1 — EXIF or XMP payloads only; any other APP1 is kept
      const payload = ascii(b, i + 4, Math.min(len - 2, XMP_NS.length + 1));
      drop = payload.startsWith('Exif\0\0') || payload.startsWith(XMP_NS);
    } else if (marker === 0xed || marker === 0xfe) {
      drop = true; // APP13 (Photoshop/IPTC) · COM
    }
    if (drop) changed = true;
    else kept.push(b.subarray(i, segEnd));
    i = segEnd;
  }
  if (i < b.length) kept.push(b.subarray(i)); // malformed tail — preserved as-is
  if (!changed) return { out: b, changed: false, kind: 'jpeg' };
  const total = kept.reduce((n, s) => n + s.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const s of kept) {
    out.set(s, o);
    o += s.length;
  }
  return { out, changed: true, kind: 'jpeg' };
}

// ── PNG ──────────────────────────────────────────────────────────────────────────────

const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function stripPng(b: Uint8Array): StripResult {
  const kept: Uint8Array[] = [b.subarray(0, 8)]; // signature
  let changed = false;
  let i = 8;
  while (i + 12 <= b.length) {
    const len = (b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!;
    const type = ascii(b, i + 4, 4);
    const chunkEnd = i + 12 + len; // len + type + data + crc
    if (len < 0 || chunkEnd > b.length) break; // malformed — bail
    if (PNG_DROP.has(type)) changed = true;
    else kept.push(b.subarray(i, chunkEnd));
    i = chunkEnd;
    if (type === 'IEND') break;
  }
  if (i < b.length) kept.push(b.subarray(i));
  if (!changed) return { out: b, changed: false, kind: 'png' };
  const total = kept.reduce((n, s) => n + s.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const s of kept) {
    out.set(s, o);
    o += s.length;
  }
  return { out, changed: true, kind: 'png' };
}

// ── WebP ─────────────────────────────────────────────────────────────────────────────

const WEBP_DROP = new Set(['EXIF', 'XMP ']);
const VP8X_EXIF_FLAG = 0x08;
const VP8X_XMP_FLAG = 0x04;

function stripWebp(b: Uint8Array): StripResult {
  const kept: Uint8Array[] = [];
  let changed = false;
  let i = 12; // 'RIFF' + size + 'WEBP'
  while (i + 8 <= b.length) {
    const fourcc = ascii(b, i, 4);
    const len = b[i + 4]! | (b[i + 5]! << 8) | (b[i + 6]! << 16) | (b[i + 7]! << 24);
    const chunkEnd = i + 8 + len + (len & 1); // chunks are 2-byte aligned
    if (len < 0 || chunkEnd > b.length) break;
    if (WEBP_DROP.has(fourcc)) changed = true;
    else kept.push(b.subarray(i, Math.min(chunkEnd, b.length)));
    i = chunkEnd;
  }
  if (i < b.length) kept.push(b.subarray(i)); // malformed tail — preserved, never dropped
  if (!changed) return { out: b, changed: false, kind: 'webp' };
  const body = kept.reduce((n, s) => n + s.length, 0);
  const out = new Uint8Array(12 + body);
  out.set(b.subarray(0, 12), 0);
  let o = 12;
  for (const s of kept) {
    out.set(s, o);
    o += s.length;
  }
  // patch RIFF size (little-endian, file length - 8)
  const riffSize = out.length - 8;
  out[4] = riffSize & 0xff;
  out[5] = (riffSize >>> 8) & 0xff;
  out[6] = (riffSize >>> 16) & 0xff;
  out[7] = (riffSize >>> 24) & 0xff;
  // clear the VP8X EXIF/XMP flag bits so the header matches the stripped chunk list
  if (ascii(out, 12, 4) === 'VP8X' && out.length >= 21) {
    out[20] = out[20]! & ~(VP8X_EXIF_FLAG | VP8X_XMP_FLAG);
  }
  return { out, changed: true, kind: 'webp' };
}

// ── MP4 / M4A (video/mp4, audio/mp4) ─────────────────────────────────────────────────

/** Containers we descend into looking for udta/meta. mdat & friends are never touched. */
const MP4_CONTAINERS = new Set(['moov', 'trak']);
const FREE = [0x66, 0x72, 0x65, 0x65]; // 'free'

function readU32(b: Uint8Array, i: number): number {
  return b[i]! * 0x1000000 + ((b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!);
}

/**
 * Overwrite every udta/meta box in [start, end) with a `free` box IN PLACE: the size
 * field(s) stay byte-identical (so stco/co64 offsets remain valid) — only the type is
 * renamed and the payload zeroed. Returns true when anything was overwritten.
 */
function freeMp4Boxes(b: Uint8Array, start: number, end: number): boolean {
  let changed = false;
  let i = start;
  while (i + 8 <= end) {
    const size32 = readU32(b, i);
    const type = ascii(b, i + 4, 4);
    let hdr = 8;
    let boxEnd: number;
    if (size32 === 1) {
      if (i + 16 > end) break;
      // 64-bit largesize — high half must be 0 for anything addressable here
      const hi = readU32(b, i + 8);
      const lo = readU32(b, i + 12);
      if (hi !== 0) break;
      hdr = 16;
      boxEnd = i + lo;
    } else if (size32 === 0) {
      boxEnd = end; // box extends to end of enclosing scope
    } else {
      boxEnd = i + size32;
    }
    if (boxEnd <= i + hdr - 1 || boxEnd > end) break; // malformed — stop scanning this scope
    if (type === 'udta' || type === 'meta') {
      b.set(FREE, i + 4); // rename; size field untouched
      b.fill(0, i + hdr, boxEnd); // zero payload (kills ©xyz, loci, Apple meta keys wholesale)
      changed = true;
    } else if (MP4_CONTAINERS.has(type)) {
      if (freeMp4Boxes(b, i + hdr, boxEnd)) changed = true;
    }
    if (size32 === 0) break;
    i = boxEnd;
  }
  return changed;
}

function stripMp4(b: Uint8Array): StripResult {
  const changed = freeMp4Boxes(b, 0, b.length);
  return { out: b, changed, kind: 'mp4' };
}

// ── MP3 (audio/mpeg) ─────────────────────────────────────────────────────────────────

function stripMp3(b: Uint8Array): StripResult {
  let changed = false;
  // ID3v2 leading tag: zero the body in place (zero bytes are valid ID3v2 padding).
  if (b.length > 10 && ascii(b, 0, 3) === 'ID3') {
    const size =
      ((b[6]! & 0x7f) << 21) | ((b[7]! & 0x7f) << 14) | ((b[8]! & 0x7f) << 7) | (b[9]! & 0x7f);
    const bodyEnd = Math.min(10 + size, b.length);
    for (let i = 10; i < bodyEnd; i++) {
      if (b[i] !== 0) {
        changed = true;
        b[i] = 0;
      }
    }
  }
  // ID3v1 trailer: blank the 125 bytes after 'TAG'.
  if (b.length >= 128) {
    const t = b.length - 128;
    if (ascii(b, t, 3) === 'TAG') {
      for (let i = t + 3; i < b.length; i++) {
        if (b[i] !== 0) {
          changed = true;
          b[i] = 0;
        }
      }
    }
  }
  return { out: b, changed, kind: 'mp3' };
}

// ── dispatcher ───────────────────────────────────────────────────────────────────────

/**
 * Sniffs the real format from magic bytes (content-type/extension are never trusted)
 * and strips its metadata. `changed === false` means the caller can skip the re-upload.
 * NOTE: mp4/mp3 mutate `bytes` in place (out === bytes); jpeg/png/webp return a copy.
 */
export function stripMetadata(bytes: Uint8Array): StripResult {
  if (bytes.length >= 4 && startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return stripJpeg(bytes);
  if (bytes.length >= 16 && startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47])) return stripPng(bytes);
  if (bytes.length >= 16 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return stripWebp(bytes);
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    // HEIF-family guard: for HEIC/AVIF the top-level `meta` box IS the image (iloc/iprp) —
    // freeing it would destroy the file. No bucket accepts these mimes today; this protects
    // against mislabeled uploads and a future avatars bucket.
    const brand = bytes.length >= 16 ? ascii(bytes, 8, 4) : '';
    if (['heic', 'heix', 'hevc', 'mif1', 'msf1', 'avif', 'avis'].includes(brand)) {
      return { out: bytes, changed: false, kind: 'unknown' };
    }
    return stripMp4(bytes);
  }
  if (
    bytes.length >= 10 &&
    (ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0))
  ) {
    return stripMp3(bytes);
  }
  return { out: bytes, changed: false, kind: 'unknown' };
}
