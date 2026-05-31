type ExcelRow = Record<string, string | number>
type ParsedRow = Record<string, string>

// xlsx is large and has unpatched advisories, so it is loaded on demand (only when an
// admin actually exports/imports) rather than in the initial bundle.

export async function exportToExcel<T extends ExcelRow>(data: T[], filename: string, sheetName: string = 'Sheet1') {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

export async function parseExcelFile(file: File): Promise<ParsedRow[]> {
  const XLSX = await import('xlsx')
  const data = new Uint8Array(await file.arrayBuffer())
  const workbook = XLSX.read(data, { type: 'array' })
  const firstSheet = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[firstSheet]
  return XLSX.utils.sheet_to_json<ParsedRow>(worksheet)
}
