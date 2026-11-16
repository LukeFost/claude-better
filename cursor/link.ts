// Cursor's own rule for its prompt link (cursor://anysphere.cursor-deeplink/prompt?text=), copied from
// Cursor 3.30.14 (workbench.glass.main.js: Cju, AC3, TC3, CC3). When it refuses, Cursor opens no dialog,
// so /better must not open the link or claim one is showing; the text goes to the clipboard only.

const LIMIT = 10_000
const ALLOWED = /^(?!.*(?:\p{Cf}|\u007F))[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Z}\r\n\t !-~]+$/u
const RISKY = [
  /read.*\.env.*print/i, /cat.*\.ssh\/id_rsa/i, /upload.*passwords\.txt/i, /dump.*token/i,
  /dump.*password/i, /exfiltrate.*credential/i, /leak.*secret/i, /how.*extract.*credential/i,
]

function decodeTwice(text: string): string {
  let out = text
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(out)
      if (next === out) break
      out = next
    } catch {
      break
    }
  }
  return out
}

function base64Words(text: string): string {
  const found: string[] = []
  for (const word of text.split(/\s+/)) {
    if (!/^[A-Za-z0-9+/=]+$/.test(word) || word.length % 4 !== 0) continue
    // Cursor may decode with Buffer, which reads up to the first '=' where atob throws; try both, so a word either
    // decoder flags is caught (at worst a prompt goes to the clipboard only).
    const head = word.split('=')[0]!
    for (const form of new Set([word, head + '='.repeat((4 - (head.length % 4)) % 4)])) {
      try {
        const decoded = new TextDecoder('utf-8').decode(Uint8Array.from(atob(form), (c) => c.charCodeAt(0)))
        if (decoded) found.push(decoded.toLowerCase())
      } catch {}
    }
  }
  return found.join(' ')
}

function looksRisky(text: string): boolean {
  const lower = text.toLowerCase()
  const once = decodeTwice(lower)
  const twice = decodeTwice(once)
  const forms = [lower, once, twice]
  const b64 = base64Words(text)
  if (b64) forms.push(b64)
  const b64Decoded = base64Words(decodeTwice(decodeTwice(text)))
  if (b64Decoded) forms.push(b64Decoded)
  return forms.some((f) => /\.env(\b|\W)/.test(f) || RISKY.some((r) => r.test(f)))
}

/** Why Cursor's prompt link would refuse this text, or undefined if it would show the dialog. */
export function linkRefusal(text: string): string | undefined {
  if (!text.trim()) return 'it is empty'
  if (!ALLOWED.test(text)) return 'it has characters the link does not allow'
  if (21 + encodeURIComponent(text).length > LIMIT) return `it is over ${LIMIT.toLocaleString('en-US')} characters as a link`
  if (looksRisky(text)) return 'Cursor flags its wording (such as a .env path) as unsafe'
  return undefined
}
