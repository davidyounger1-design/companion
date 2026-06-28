// AES-256-GCM client-side encryption for journal photos.
// Layout: MAGIC(4) | IV(12) | GCM-ciphertext
// MAGIC allows detecting unencrypted legacy photos and serving them as-is.

const MAGIC = new Uint8Array([0x45, 0x4e, 0x43, 0x01]) // "ENC\x01"
const IV_LEN = 12
const HEADER_LEN = MAGIC.length + IV_LEN // 16 bytes

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

async function importKey(keyHex: string): Promise<CryptoKey> {
  const bytes = hexToBytes(keyHex)
  return crypto.subtle.importKey(
    'raw',
    bytes.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function isEncrypted(data: Uint8Array): boolean {
  if (data.length < MAGIC.length) return false
  return MAGIC.every((b, i) => data[i] === b)
}

export function mimeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', heic: 'image/heic', gif: 'image/gif',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
    m4v: 'video/mp4',
  }
  return map[ext] ?? 'application/octet-stream'
}

/** Encrypt a file for storage. Returns an opaque encrypted blob. */
export async function encryptFile(file: File, keyHex: string): Promise<Blob> {
  const buf = await file.arrayBuffer()
  const key = await importKey(keyHex)
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buf)
  const out = new Uint8Array(HEADER_LEN + cipher.byteLength)
  out.set(MAGIC, 0)
  out.set(iv, MAGIC.length)
  out.set(new Uint8Array(cipher), HEADER_LEN)
  return new Blob([out], { type: 'application/octet-stream' })
}

/**
 * Decrypt a downloaded buffer to a blob: URL.
 * Handles legacy unencrypted files transparently (no magic bytes → serve as-is).
 * Caller is responsible for calling URL.revokeObjectURL when done.
 */
export async function decryptToObjectURL(
  data: ArrayBuffer,
  keyHex: string,
  mimeType: string,
): Promise<string> {
  const bytes = new Uint8Array(data)
  if (!isEncrypted(bytes)) {
    return URL.createObjectURL(new Blob([data], { type: mimeType }))
  }
  const key = await importKey(keyHex)
  const iv = bytes.slice(MAGIC.length, HEADER_LEN)
  const cipher = bytes.slice(HEADER_LEN)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
  return URL.createObjectURL(new Blob([plain], { type: mimeType }))
}
