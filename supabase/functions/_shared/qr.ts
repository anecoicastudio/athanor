/**
 * QR token = base64url(payloadJson) + '.' + base64url(hmacSha256(payloadJson)).
 * Signed by the webhook (W1) on payment; verified offline-of-Stripe by the check-in fn (Slice B).
 * The (eid,uid) pair maps to the unique (event_id,user_id) ticket; `iat` (= Stripe session.created)
 * keeps re-delivery deterministic so a webhook retry re-issues the SAME token (no unique churn).
 */
export type QrPayload = { eid: string; uid: string; iat: number };

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signQrToken(payload: QrPayload, secret: string): Promise<string> {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

/**
 * Returns the payload iff the signature verifies, else null. Used by Slice B's check-in fn on a
 * scanned QR string (attacker-controllable), so EVERY failure path — malformed base64 (`atob`
 * throws), bad JSON, a wrong-shaped payload — must return null, NEVER throw (a throw would surface
 * as a 500 at the check-in endpoint). The whole body is guarded.
 */
export async function verifyQrToken(token: string, secret: string): Promise<QrPayload | null> {
  try {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlToBytes(sig).buffer as ArrayBuffer,
      new TextEncoder().encode(body),
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body))) as unknown;
    // Field-presence guard — Slice B relies on this shape without re-validating.
    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof (payload as QrPayload).eid !== 'string' ||
      typeof (payload as QrPayload).uid !== 'string' ||
      typeof (payload as QrPayload).iat !== 'number'
    ) {
      return null;
    }
    return payload as QrPayload;
  } catch {
    return null;
  }
}
