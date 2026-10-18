// Turning spreadsheet rows into employees to create, and saying what is wrong with each.
//
// The old import read only name, department and balance, sent every row straight to the
// server, and counted a row "imported" whether or not the server accepted it. A
// department it didn't recognise quietly became the first department in the list, and the
// join date (which pro-rates the starting balance) was dropped, so every imported person
// got a full year's leave. This checks everything up front so the admin sees, before
// anything is written, exactly what will happen to each row.
//
// Pure (no DOM, no fetch) so it is unit-tested directly.

import type { EmployeeCreate } from '@/lib/api'

export type ImportField = 'name' | 'department' | 'leave_balance' | 'email' | 'phone' | 'position' | 'join_date'

/**
 * The columns, in template order. `ar`/`en` are the template headings; `aliases` are the
 * other spellings accepted on import (compared case- and spacing-insensitively). Both
 * languages are always accepted, whichever language the template was downloaded in.
 */
export const IMPORT_COLUMNS: { field: ImportField; en: string; ar: string; required: boolean; aliases: string[] }[] = [
  { field: 'name', en: 'Name', ar: 'الاسم', required: true, aliases: ['employee name', 'full name', 'اسم الموظف'] },
  { field: 'department', en: 'Department', ar: 'القسم', required: true, aliases: ['dept'] },
  { field: 'leave_balance', en: 'Leave Balance', ar: 'رصيد الإجازات', required: false, aliases: ['leave_balance', 'balance', 'الرصيد'] },
  { field: 'email', en: 'Email', ar: 'البريد الإلكتروني', required: false, aliases: ['e-mail', 'البريد'] },
  { field: 'phone', en: 'Phone', ar: 'الهاتف', required: false, aliases: ['mobile', 'phone number', 'رقم الهاتف', 'الجوال'] },
  { field: 'position', en: 'Position', ar: 'المنصب', required: false, aliases: ['job title', 'title', 'الوظيفة', 'المسمى الوظيفي'] },
  { field: 'join_date', en: 'Join Date', ar: 'تاريخ الالتحاق', required: false, aliases: ['join_date', 'joining date', 'start date', 'تاريخ التعيين'] },
]

/** Template headings in one language. */
export function templateHeaders(lang: 'ar' | 'en'): string[] {
  return IMPORT_COLUMNS.map(c => c[lang])
}

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/[\s_]+/g, ' ')
}

const HEADER_LOOKUP = new Map<string, ImportField>()
for (const c of IMPORT_COLUMNS) {
  for (const h of [c.en, c.ar, c.field, ...c.aliases]) HEADER_LOOKUP.set(normalise(h), c.field)
}

/**
 * Which field a heading names, or null. A two-language heading such as "Name / الاسم" or
 * "الاسم (Name)" is matched on either half.
 */
export function fieldForHeader(header: string): ImportField | null {
  const whole = HEADER_LOOKUP.get(normalise(header))
  if (whole) return whole
  for (const part of header.split(/[/()|]/)) {
    const hit = part.trim() && HEADER_LOOKUP.get(normalise(part))
    if (hit) return hit
  }
  return null
}

export type IssueCode =
  | 'missingName'
  | 'missingDepartment'
  | 'unknownDepartment'
  | 'invalidBalance'
  | 'invalidJoinDate'
  | 'duplicateExisting'
  | 'duplicateInFile'
  | 'balanceProrated'

export interface ImportIssue {
  code: IssueCode
  /** The offending value, or for duplicateInFile the earlier row's number. */
  value?: string
}

export interface ImportRow {
  /** The row's number in the spreadsheet as Excel shows it (the heading is row 1). */
  rowNumber: number
  name: string
  departmentName: string
  joinDate: string | null
  balance: number | null
  /** What will be sent to POST /api/employees; null when the row has errors. */
  input: EmployeeCreate | null
  errors: ImportIssue[]
  warnings: ImportIssue[]
}

export interface ImportPreview {
  rows: ImportRow[]
  /** Required columns the sheet has no heading for (every row will then fail on it). */
  missingColumns: ImportField[]
}

export interface ImportContext {
  departments: { id: number; name: string }[]
  /** Current employees, to flag likely duplicates. */
  employees: { name: string; is_active: boolean }[]
  /** Starting balance for a row that gives none (the annual allowance in settings). */
  defaultBalance: number
}

/** A spreadsheet row as SheetJS hands it over: heading → cell value. */
export type SheetRow = Record<string, unknown> & { __rowNum__?: number }

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

const pad = (n: number) => String(n).padStart(2, '0')

function isRealDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return y >= 1900 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/**
 * A join date cell as YYYY-MM-DD, or null if it can't be read as one.
 *
 * Excel stores a date cell as a serial day number (days since 1899-12-30, which absorbs
 * Excel's fictional 29 Feb 1900), so that is what arrives for a cell formatted as a date.
 * Typed text is accepted as YYYY-MM-DD or day-first DD/MM/YYYY, as dates are written here.
 */
export function parseJoinDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 1 || value > 2958465) return null // beyond 9999-12-31
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000)
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
  }
  const text = cellText(value)
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return isRealDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text)
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return isRealDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null
  }
  return null
}

/** Names compared the way a person would: case, spacing and Arabic letter variants aside. */
export function nameKey(name: string): string {
  return normalise(name)
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ً-ْـ]/g, '') // harakat and tatweel
}

export function previewImport(sheetRows: SheetRow[], ctx: ImportContext): ImportPreview {
  const deptByName = new Map(ctx.departments.map(d => [normalise(d.name), d]))
  const activeNames = new Set(ctx.employees.filter(e => e.is_active).map(e => nameKey(e.name)))
  const firstRowFor = new Map<string, number>()

  const headersSeen = new Set<ImportField>()
  const rows: ImportRow[] = []

  sheetRows.forEach((raw, index) => {
    const values: Partial<Record<ImportField, unknown>> = {}
    for (const [header, value] of Object.entries(raw)) {
      const field = fieldForHeader(header)
      if (!field) continue
      headersSeen.add(field)
      // First matching column wins, so a stray second "Name" column can't overwrite it.
      if (values[field] === undefined || cellText(values[field]) === '') values[field] = value
    }
    // A row with nothing in any recognised column is padding, not a person.
    if (Object.values(values).every(v => cellText(v) === '')) return

    const rowNumber = typeof raw.__rowNum__ === 'number' ? raw.__rowNum__ + 1 : index + 2
    const errors: ImportIssue[] = []
    const warnings: ImportIssue[] = []

    const name = cellText(values.name).replace(/\s+/g, ' ')
    if (!name) errors.push({ code: 'missingName' })

    const departmentName = cellText(values.department)
    const department = departmentName ? deptByName.get(normalise(departmentName)) : undefined
    if (!departmentName) errors.push({ code: 'missingDepartment' })
    // Refused rather than guessed: the old import put an unrecognised department's people
    // in whichever department happened to be first.
    else if (!department) errors.push({ code: 'unknownDepartment', value: departmentName })

    const balanceText = cellText(values.leave_balance)
    let balance: number | null = null
    if (balanceText !== '') {
      const n = Number(balanceText)
      if (Number.isFinite(n) && n >= 0) balance = n
      else errors.push({ code: 'invalidBalance', value: balanceText })
    }

    let joinDate: string | null = null
    if (cellText(values.join_date) !== '') {
      joinDate = parseJoinDate(values.join_date)
      if (!joinDate) errors.push({ code: 'invalidJoinDate', value: cellText(values.join_date) })
    }
    // The server pro-rates the starting balance from the join date and ignores any balance
    // sent with it, so say so rather than let the figure in the sheet silently not apply.
    if (joinDate && balance !== null) warnings.push({ code: 'balanceProrated' })

    if (name) {
      const key = nameKey(name)
      if (activeNames.has(key)) warnings.push({ code: 'duplicateExisting' })
      const earlier = firstRowFor.get(key)
      if (earlier !== undefined) warnings.push({ code: 'duplicateInFile', value: String(earlier) })
      else firstRowFor.set(key, rowNumber)
    }

    const email = cellText(values.email)
    const phone = cellText(values.phone)
    const position = cellText(values.position)

    rows.push({
      rowNumber,
      name,
      departmentName,
      joinDate,
      balance,
      input: errors.length > 0 || !department
        ? null
        : {
            name,
            department_id: department.id,
            leave_balance: balance ?? ctx.defaultBalance,
            ...(joinDate ? { join_date: joinDate } : {}),
            ...(email ? { email } : {}),
            ...(phone ? { phone } : {}),
            ...(position ? { position } : {}),
          },
      errors,
      warnings,
    })
  })

  const missingColumns = IMPORT_COLUMNS
    .filter(c => c.required && !headersSeen.has(c.field))
    .map(c => c.field)

  return { rows, missingColumns }
}
