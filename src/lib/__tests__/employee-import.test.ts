import { describe, it, expect } from 'vitest'
import {
  previewImport, parseJoinDate, fieldForHeader, templateHeaders, nameKey, IMPORT_COLUMNS,
  type ImportContext, type SheetRow,
} from '@/lib/employee-import'

const ctx: ImportContext = {
  departments: [
    { id: 1, name: 'Finance' },
    { id: 2, name: 'الموارد البشرية' },
  ],
  employees: [
    { name: 'Ahmed Al Said', is_active: true },
    { name: 'Former Person', is_active: false },
  ],
  defaultBalance: 30,
}

/** A row as SheetJS produces it: __rowNum__ is non-enumerable and 0-based. */
function sheetRow(values: Record<string, unknown>, rowNum?: number): SheetRow {
  const row: SheetRow = { ...values }
  if (rowNum !== undefined) Object.defineProperty(row, '__rowNum__', { value: rowNum, enumerable: false })
  return row
}

const codes = (issues: { code: string }[]) => issues.map(i => i.code)

describe('headings', () => {
  it('reads the template back in either language', () => {
    for (const lang of ['en', 'ar'] as const) {
      expect(templateHeaders(lang).map(fieldForHeader)).toEqual(IMPORT_COLUMNS.map(c => c.field))
    }
  })

  it('ignores case, spacing and underscores, and matches either half of a two-language heading', () => {
    expect(fieldForHeader('  LEAVE_balance ')).toBe('leave_balance')
    expect(fieldForHeader('Join  Date')).toBe('join_date')
    expect(fieldForHeader('Name / الاسم')).toBe('name')
    expect(fieldForHeader('القسم (Department)')).toBe('department')
    expect(fieldForHeader('Notes')).toBeNull()
  })
})

describe('parseJoinDate', () => {
  it('converts an Excel date serial', () => {
    expect(parseJoinDate(46037)).toBe('2026-01-15')
    expect(parseJoinDate(45351)).toBe('2024-02-29')
  })

  it('accepts ISO and day-first text', () => {
    expect(parseJoinDate('2026-1-5')).toBe('2026-01-05')
    expect(parseJoinDate('15/01/2026')).toBe('2026-01-15')
    expect(parseJoinDate('15.01.2026')).toBe('2026-01-15')
  })

  it('refuses dates that do not exist or cannot be read', () => {
    expect(parseJoinDate('2026-02-30')).toBeNull()
    expect(parseJoinDate('31/04/2026')).toBeNull()
    expect(parseJoinDate('01/13/2026')).toBeNull() // month-first is not how dates are written here
    expect(parseJoinDate('next week')).toBeNull()
    expect(parseJoinDate(0)).toBeNull()
  })
})

describe('previewImport', () => {
  it('builds the full create payload, join date and contact details included', () => {
    const { rows, missingColumns } = previewImport([
      sheetRow({ Name: ' Sara  Khan ', Department: 'finance', Email: 'sara@example.com', Phone: 96891234567, Position: 'Accountant', 'Join Date': 46037 }, 1),
    ], ctx)
    expect(missingColumns).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0].rowNumber).toBe(2)
    expect(rows[0].errors).toEqual([])
    expect(rows[0].input).toEqual({
      name: 'Sara Khan',
      department_id: 1,
      leave_balance: 30,
      join_date: '2026-01-15',
      email: 'sara@example.com',
      phone: '96891234567',
      position: 'Accountant',
    })
  })

  it('reads Arabic headings and matches an Arabic department name', () => {
    const { rows } = previewImport([sheetRow({ 'الاسم': 'فاطمة', 'القسم': 'الموارد البشرية', 'رصيد الإجازات': '12.5' })], ctx)
    expect(rows[0].input).toMatchObject({ name: 'فاطمة', department_id: 2, leave_balance: 12.5 })
  })

  it('refuses an unknown department instead of guessing one', () => {
    const { rows } = previewImport([sheetRow({ Name: 'X', Department: 'Logistics' })], ctx)
    expect(rows[0].input).toBeNull()
    expect(rows[0].errors).toEqual([{ code: 'unknownDepartment', value: 'Logistics' }])
  })

  it('flags a missing name and a missing department', () => {
    const { rows } = previewImport([sheetRow({ Name: '', Department: 'Finance', Position: 'Clerk' }), sheetRow({ Name: 'Y' })], ctx)
    expect(codes(rows[0].errors)).toEqual(['missingName'])
    expect(codes(rows[1].errors)).toEqual(['missingDepartment'])
    expect(rows.every(r => r.input === null)).toBe(true)
  })

  it('refuses an unreadable balance or join date', () => {
    const { rows } = previewImport([
      sheetRow({ Name: 'A', Department: 'Finance', 'Leave Balance': 'thirty' }),
      sheetRow({ Name: 'B', Department: 'Finance', 'Leave Balance': -2 }),
      sheetRow({ Name: 'C', Department: 'Finance', 'Join Date': '2026-13-01' }),
    ], ctx)
    expect(rows.map(r => codes(r.errors))).toEqual([['invalidBalance'], ['invalidBalance'], ['invalidJoinDate']])
  })

  it('keeps an opening balance of 0', () => {
    const { rows } = previewImport([sheetRow({ Name: 'Z', Department: 'Finance', 'Leave Balance': 0 })], ctx)
    expect(rows[0].input?.leave_balance).toBe(0)
  })

  it('warns, without blocking, about a likely duplicate of an active employee', () => {
    const { rows } = previewImport([
      sheetRow({ Name: 'ahmed  al said', Department: 'Finance' }),
      sheetRow({ Name: 'Former Person', Department: 'Finance' }), // inactive: not a clash
    ], ctx)
    expect(codes(rows[0].warnings)).toEqual(['duplicateExisting'])
    expect(rows[0].input).not.toBeNull()
    expect(rows[1].warnings).toEqual([])
  })

  it('warns about the same name twice in the file, pointing at the first row', () => {
    const { rows } = previewImport([
      sheetRow({ Name: 'Omar', Department: 'Finance' }, 1),
      sheetRow({ Name: 'OMAR', Department: 'Finance' }, 4),
    ], ctx)
    expect(rows[0].warnings).toEqual([])
    expect(rows[1].warnings).toEqual([{ code: 'duplicateInFile', value: '2' }])
  })

  it('treats Arabic letter variants as the same name', () => {
    expect(nameKey('أحمد')).toBe(nameKey('احمد'))
    expect(nameKey('فاطمة')).toBe(nameKey('فاطمه'))
  })

  it('warns that a balance given with a join date will be pro-rated instead', () => {
    const { rows } = previewImport([sheetRow({ Name: 'P', Department: 'Finance', 'Leave Balance': 30, 'Join Date': '2026-06-01' })], ctx)
    expect(codes(rows[0].warnings)).toEqual(['balanceProrated'])
  })

  it('skips blank rows and reports required columns the sheet lacks', () => {
    const { rows, missingColumns } = previewImport([
      sheetRow({ Name: 'Q' }),
      sheetRow({ Name: '   ', Notes: 'ignored column' }),
    ], ctx)
    expect(rows).toHaveLength(1)
    expect(missingColumns).toEqual(['department'])
  })

  it('numbers rows by their position when SheetJS gives no row number', () => {
    const { rows } = previewImport([sheetRow({ Name: 'R', Department: 'Finance' }), sheetRow({ Name: 'S', Department: 'Finance' })], ctx)
    expect(rows.map(r => r.rowNumber)).toEqual([2, 3])
  })
})
