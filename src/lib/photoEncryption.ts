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

/**
 * Downscales an image to a small JPEG for a fast inline preview — the full
 * original only downloads when a viewer taps to open it. Returns null if
 * thumbnailing fails for any reason (e.g. an image format the browser can't
 * decode) so the caller can fall back to uploading the full photo only;
 * never blocks saving the entry over a preview nicety.
 */
export async function createImageThumbnail(file: File | Blob, maxDim = 480, quality = 0.6): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    return await new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
    })
  } catch {
    return null
  }
}

/** Encrypt a file (or a generated blob, e.g. a thumbnail) for storage. Returns an opaque encrypted blob. */
export async function encryptFile(file: File | Blob, keyHex: string): Promise<Blob> {
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
 * Decrypt a downloaded buffer to a plain Blob.
 * Handles legacy unencrypted files transparently (no magic bytes → serve as-is).
 */
export async function decryptToBlob(
  data: ArrayBuffer,
  keyHex: string,
  mimeType: string,
): Promise<Blob> {
  const bytes = new Uint8Array(data)
  if (!isEncrypted(bytes)) {
    return new Blob([data], { type: mimeType })
  }
  const key = await importKey(keyHex)
  const iv = bytes.slice(MAGIC.length, HEADER_LEN)
  const cipher = bytes.slice(HEADER_LEN)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
  return new Blob([plain], { type: mimeType })
}

/**
 * Decrypt a downloaded buffer to a blob: URL.
 * Caller is responsible for calling URL.revokeObjectURL when done.
 */
export async function decryptToObjectURL(
  data: ArrayBuffer,
  keyHex: string,
  mimeType: string,
): Promise<string> {
  const blob = await decryptToBlob(data, keyHex, mimeType)
  return URL.createObjectURL(blob)
}
