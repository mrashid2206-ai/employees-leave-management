type ExcelRow = Record<string, string | number>

// xlsx is large and has unpatched advisories, so it is loaded on demand (only when an
// admin actually exports/imports) rather than in the initial bundle.

export async function exportToExcel<T extends ExcelRow>(data: T[], filename: string, sheetName: string = 'Sheet1') {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

/**
 * A sheet from explicit rows, the first being the headings. Unlike exportToExcel this
 * writes the headings even with no data rows, which is what an import template needs.
 */
export async function exportRows(rows: (string | number)[][], filename: string, sheetName: string = 'Sheet1') {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

/**
 * The first sheet as heading → value objects. Values are left as Excel stored them: a
 * date cell arrives as its serial day number, a numeric cell as a number. Each row also
 * carries SheetJS's non-enumerable `__rowNum__` (0-based), so errors can name the row the
 * admin sees in Excel.
 */
export async function readSpreadsheet(file: File): Promise<Record<string, unknown>[]> {
  const XLSX = await import('xlsx')
  const data = new Uint8Array(await file.arrayBuffer())
  const workbook = XLSX.read(data, { type: 'array' })
  const firstSheet = workbook.SheetNames[0]
  if (!firstSheet) return []
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet])
}
