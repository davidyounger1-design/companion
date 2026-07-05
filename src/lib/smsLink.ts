// Opens the current device's own Messages app with a pre-filled text —
// there's no API to send a real SMS/iMessage from a server without a
// paid provider, so this is the free path: the person tapping the link
// still has to hit Send themselves, from their own phone number.
export function buildSmsLink(phone: string, body: string) {
  const digits = phone.trim().replace(/[^\d+]/g, '')
  return `sms:${digits}?&body=${encodeURIComponent(body)}`
}
