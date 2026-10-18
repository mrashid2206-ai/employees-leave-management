// Leave attachments (medical certificates): the limits and the byte-level checks, shared
// by the upload service and the forms that pre-check a file before sending it. Nothing
// here touches the database, so the portal can import it.
//
// The server never trusts what the client says a file is. The browser's content type and
// the file's extension are both chosen by the sender; the first bytes are not.

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_LEAVE = 5

export type AttachmentContentType = 'application/pdf' | 'image/jpeg' | 'image/png'

// Canonical extension first: it is what a renamed file gets.
const EXTENSIONS: Record<AttachmentContentType, string[]> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
}

/** For `<input type="file" accept>`. A convenience only; the server checks the bytes. */
export const ATTACHMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

/** Identify a file by its signature, or null when it is none of the three allowed types. */
export function sniffContentType(bytes: Uint8Array): AttachmentContentType | null {
  const b = bytes
  // "%PDF-" at offset 0. Readers tolerate junk before it, but a certificate from a
  // scanner or a phone never has any, and accepting a prefix is how polyglots get in.
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) {
    return 'application/pdf'
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'image/png'
  }
  return null
}

const MAX_BASE_CHARS = 100

/**
 * The name to store and to offer on download. The client's name is display text only
 * (the bytes live in Postgres, so it never becomes a path), but it still reaches a
 * Content-Disposition header and other people's screens, so:
 *  - any directory part is dropped ("C:\fakepath\x.pdf" is what some browsers send);
 *  - control characters and bidi overrides go: "‮fdp.exe" displays as "exe.pdf";
 *  - the extension is made to match what the bytes actually are, so a PDF named
 *    "x.html" is offered back as "x.pdf".
 * Arabic names are kept as they are.
 */
export function sanitizeFilename(raw: string, contentType: AttachmentContentType): string {
  const allowed = EXTENSIONS[contentType]
  let name = (raw || '').normalize('NFC')
  name = name.split(/[\\/]/).pop() ?? ''
  name = name
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/["<>:*?|;]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()

  let ext = allowed[0]
  const m = name.match(/\.([A-Za-z0-9]{1,8})$/)
  if (m) {
    name = name.slice(0, -m[0].length)
    if (allowed.includes(m[1].toLowerCase())) ext = m[1].toLowerCase()
  }

  // Leading dots would make a hidden file on save; trailing dots/spaces are dropped by
  // Windows and would leave the name ending differently from what was shown.
  let base = Array.from(name.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')).slice(0, MAX_BASE_CHARS).join('')
  base = base.replace(/[.\s]+$/, '')
  if (!base) base = 'attachment'
  return `${base}.${ext}`
}

/**
 * RFC 6266 Content-Disposition, always `attachment`. `filename` is an ASCII fallback for
 * old clients; `filename*` carries the real (often Arabic) name, percent-encoded UTF-8.
 */
export function contentDisposition(filename: string): string {
  let fallback = filename.replace(/[^\x20-\x7e]+/g, '_').replace(/["\\]/g, '_')
  // An all-Arabic name leaves nothing readable ("_ _.pdf"); say what it is instead.
  const ext = fallback.match(/\.[A-Za-z0-9]+$/)?.[0] ?? ''
  if (!/[A-Za-z0-9]/.test(fallback.slice(0, fallback.length - ext.length))) fallback = `attachment${ext}`
  // encodeURIComponent leaves ' ( ) * unescaped, and RFC 5987 does not allow them.
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    c => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  )
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

/** Cheap client-side pre-check so an obviously wrong file is caught before upload. */
export function looksLikeAllowedFile(file: { name: string }): boolean {
  const ext = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return !!ext && Object.values(EXTENSIONS).some(list => list.includes(ext))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
