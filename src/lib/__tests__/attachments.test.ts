import { describe, it, expect } from 'vitest'
import { contentDisposition, looksLikeAllowedFile, sanitizeFilename, sniffContentType } from '@/lib/attachments'

const bytes = (...b: number[]) => new Uint8Array(b)
const text = (s: string) => new TextEncoder().encode(s)

describe('sniffContentType', () => {
  it('recognises the three allowed signatures', () => {
    expect(sniffContentType(text('%PDF-1.7\n...'))).toBe('application/pdf')
    expect(sniffContentType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe('image/jpeg')
    expect(sniffContentType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('image/png')
  })

  it('rejects anything else, whatever it is called', () => {
    expect(sniffContentType(text('<html><script>alert(1)</script></html>'))).toBeNull()
    expect(sniffContentType(text('GIF89a'))).toBeNull()
    expect(sniffContentType(bytes())).toBeNull()
    // A signature that only appears after a prefix is not accepted.
    expect(sniffContentType(text(' %PDF-1.4'))).toBeNull()
    // Truncated PNG signature.
    expect(sniffContentType(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull()
  })
})

describe('sanitizeFilename', () => {
  it('keeps Arabic names and a matching extension', () => {
    expect(sanitizeFilename('شهادة طبية.pdf', 'application/pdf')).toBe('شهادة طبية.pdf')
    expect(sanitizeFilename('scan.JPEG', 'image/jpeg')).toBe('scan.jpeg')
  })

  it('drops any directory part', () => {
    expect(sanitizeFilename('C:\\fakepath\\report.pdf', 'application/pdf')).toBe('report.pdf')
    expect(sanitizeFilename('../../etc/passwd', 'application/pdf')).toBe('passwd.pdf')
  })

  it('makes the extension match the bytes', () => {
    expect(sanitizeFilename('page.html', 'application/pdf')).toBe('page.pdf')
    expect(sanitizeFilename('photo', 'image/png')).toBe('photo.png')
  })

  it('removes control and bidi-override characters', () => {
    expect(sanitizeFilename('a\u0000b\r\n.pdf', 'application/pdf')).toBe('ab.pdf')
    // "‮fdp.exe" renders as "exe.pdf" in a file list.
    expect(sanitizeFilename('x\u202Efdp.exe', 'application/pdf')).toBe('xfdp.pdf')
  })

  it('neutralises header-breaking characters and hidden-file names', () => {
    expect(sanitizeFilename('a"b;c.pdf', 'application/pdf')).toBe('a_b_c.pdf')
    expect(sanitizeFilename('.hidden.pdf', 'application/pdf')).toBe('hidden.pdf')
    expect(sanitizeFilename('', 'application/pdf')).toBe('attachment.pdf')
    expect(sanitizeFilename('....pdf', 'application/pdf')).toBe('attachment.pdf')
  })

  it('caps the length', () => {
    const name = sanitizeFilename('ش'.repeat(500) + '.pdf', 'application/pdf')
    expect(Array.from(name).length).toBe(104)
  })
})

describe('contentDisposition', () => {
  it('is always attachment, with an ASCII fallback and the UTF-8 name', () => {
    const h = contentDisposition('شهادة.pdf')
    expect(h.startsWith('attachment; ')).toBe(true)
    expect(h).toContain(`filename*=UTF-8''${encodeURIComponent('شهادة')}.pdf`)
    expect(h).toContain('filename="attachment.pdf"')
    expect(contentDisposition('scan 2.png')).toContain('filename="scan 2.png"')
    expect(contentDisposition('تقرير lab.pdf')).toContain('filename="_ lab.pdf"')
  })

  it('escapes characters RFC 5987 does not allow', () => {
    expect(contentDisposition("it's (1).pdf")).toContain("filename*=UTF-8''it%27s%20%281%29.pdf")
  })
})

describe('looksLikeAllowedFile', () => {
  it('goes by extension, as a pre-check only', () => {
    expect(looksLikeAllowedFile({ name: 'a.PDF' })).toBe(true)
    expect(looksLikeAllowedFile({ name: 'a.jpeg' })).toBe(true)
    expect(looksLikeAllowedFile({ name: 'a.exe' })).toBe(false)
    expect(looksLikeAllowedFile({ name: 'noext' })).toBe(false)
  })
})
