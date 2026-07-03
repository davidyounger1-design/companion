// Web Push: VAPID-authenticated (RFC 8292) sends with encrypted payloads
// (RFC 8291 / aes128gcm content coding, RFC 8188). Used where a
// notification needs real title/body text and a specific tap target,
// rather than the bare wake-up ping push-notify sends today.

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_CONTACT = 'mailto:admin@myappbuddy.com.au'

function b64uDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad), (c) => c.charCodeAt(0))
}
function b64uEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function makeVapidJWT(audience: string): Promise<string> {
  const pub = b64uDecode(VAPID_PUBLIC)
  const x = b64uEncode(pub.slice(1, 33).buffer as ArrayBuffer)
  const y = b64uEncode(pub.slice(33, 65).buffer as ArrayBuffer)

  const sigKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: VAPID_PRIVATE, x, y, key_ops: ['sign'], ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign'],
  )

  const header = b64uEncode(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = b64uEncode(new TextEncoder().encode(JSON.stringify({
    aud: new URL(audience).origin,
    exp: Math.floor(Date.now() / 1000) + 43200,
    sub: VAPID_CONTACT,
  })))
  const sigInput = `${header}.${payload}`
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    sigKey,
    new TextEncoder().encode(sigInput),
  )
  return `${sigInput}.${b64uEncode(sig)}`
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data.buffer as ArrayBuffer)
  return new Uint8Array(sig)
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) { out.set(p, offset); offset += p.length }
  return out
}

/** Encrypts a JSON payload per RFC 8291 (Web Push aes128gcm). Returns the raw POST body. */
async function encryptPayload(payload: unknown, p256dhB64: string, authB64: string): Promise<Uint8Array> {
  const uaPublicRaw = b64uDecode(p256dhB64) // 65-byte uncompressed P-256 point
  const authSecret = b64uDecode(authB64) // 16 bytes

  const uaPublicKey = await crypto.subtle.importKey(
    'raw', uaPublicRaw.buffer as ArrayBuffer, { name: 'ECDH', namedCurve: 'P-256' }, true, [],
  )

  const asKeyPair = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  )) as CryptoKeyPair
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey))

  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, asKeyPair.privateKey, 256),
  )

  // RFC 8291 §3.4 key derivation
  const prkKey = await hmacSha256(authSecret, ecdhSecret)
  const keyInfo = concatBytes(new TextEncoder().encode('WebPush: info\0'), uaPublicRaw, asPublicRaw)
  const ikm = (await hmacSha256(prkKey, concatBytes(keyInfo, new Uint8Array([1])))).slice(0, 32)

  // RFC 8188 aes128gcm content coding
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const prk = await hmacSha256(salt, ikm)
  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0')
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0')
  const cek = (await hmacSha256(prk, concatBytes(cekInfo, new Uint8Array([1])))).slice(0, 16)
  const nonce = (await hmacSha256(prk, concatBytes(nonceInfo, new Uint8Array([1])))).slice(0, 12)

  const plaintext = concatBytes(new TextEncoder().encode(JSON.stringify(payload)), new Uint8Array([2]))
  const aesKey = await crypto.subtle.importKey('raw', cek.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer }, aesKey, plaintext.buffer as ArrayBuffer),
  )

  const rs = new Uint8Array(4)
  new DataView(rs.buffer).setUint32(0, 4096)
  const header = concatBytes(salt, rs, new Uint8Array([asPublicRaw.length]), asPublicRaw)

  return concatBytes(header, ciphertext)
}

export type PushPayload = { title: string; body: string; tag?: string; url?: string }

/** Sends one encrypted push message to a subscription. Returns the push service's HTTP status. */
export async function sendEncryptedPush(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
): Promise<number> {
  const jwt = await makeVapidJWT(sub.endpoint)
  const body = await encryptPayload(payload, sub.p256dh, sub.auth)
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt},k=${VAPID_PUBLIC}`,
      TTL: '86400',
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
    },
    body,
  })
  return res.status
}
