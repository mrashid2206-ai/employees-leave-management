'use client'

import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, FileSpreadsheet, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { createEmployee } from '@/lib/api'
import { DEFAULT_EMPLOYEE_PASSWORD } from '@/lib/constants'
import { exportRows, readSpreadsheet } from '@/lib/excel'
import {
  IMPORT_COLUMNS, previewImport, templateHeaders,
  type ImportIssue, type ImportPreview, type ImportRow, type IssueCode,
} from '@/lib/employee-import'
import { useLanguage, useT } from '@/lib/language-context'
import { qk } from '@/lib/query-keys'
import type { TranslationKey } from '@/lib/translations'
import type { Department, Employee } from '@/lib/types'

// Bound the parser's exposure (xlsx@0.18.5 has unpatched ReDoS/proto-pollution advisories).
const MAX_IMPORT_BYTES = 2 * 1024 * 1024 // 2 MB

const ISSUE_TEXT: Record<IssueCode, TranslationKey> = {
  missingName: 'importErrMissingName',
  missingDepartment: 'importErrMissingDepartment',
  unknownDepartment: 'importErrUnknownDepartment',
  invalidBalance: 'importErrInvalidBalance',
  invalidJoinDate: 'importErrInvalidJoinDate',
  duplicateExisting: 'importWarnDuplicateExisting',
  duplicateInFile: 'importWarnDuplicateInFile',
  balanceProrated: 'importWarnBalanceProrated',
}

interface Outcome {
  row: ImportRow
  /** Set when the server created the employee. */
  username?: string
  /** The server's refusal, verbatim, when it didn't. */
  error?: string
}

type Step =
  | { kind: 'pick' }
  | { kind: 'preview'; preview: ImportPreview; fileName: string }
  | { kind: 'importing'; done: number; total: number }
  | { kind: 'results'; outcomes: Outcome[]; skipped: ImportRow[] }

/**
 * Template → preview → import → results.
 *
 * Rows go to the ordinary POST /api/employees one at a time (fine for a few dozen people),
 * so an import gets exactly the same checks, username generation and join-date pro-rating
 * as adding someone by hand. The results list the generated usernames: nobody can sign in
 * without theirs, and the old import never showed them.
 */
export function ImportEmployeesDialog({
  open,
  onOpenChange,
  departments,
  employees,
  defaultBalance,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  departments: Department[]
  employees: Employee[]
  defaultBalance: number
}) {
  const t = useT()
  const { lang, dir } = useLanguage()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>({ kind: 'pick' })

  const issueText = (issue: ImportIssue) => t(ISSUE_TEXT[issue.code], { value: issue.value ?? '' })

  function close(next: boolean) {
    // An import in flight keeps going if the dialog closes, but the results would be lost,
    // so it stays open until it finishes.
    if (!next && step.kind === 'importing') return
    onOpenChange(next)
    if (!next) setStep({ kind: 'pick' })
  }

  function downloadTemplate() {
    exportRows([templateHeaders(lang === 'ar' ? 'ar' : 'en')], 'employees-template', t('employees'))
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // so choosing the same file again (after fixing it) still fires
    if (!file) return
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error(t('fileTooLargeMax2'))
      return
    }
    try {
      const sheetRows = await readSpreadsheet(file)
      const preview = previewImport(sheetRows, { departments, employees, defaultBalance })
      if (preview.rows.length === 0) {
        toast.error(t('importNoRows'))
        return
      }
      setStep({ kind: 'preview', preview, fileName: file.name })
    } catch {
      toast.error(t('error'))
    }
  }

  async function runImport(rows: ImportRow[], skipped: ImportRow[]) {
    const outcomes: Outcome[] = []
    setStep({ kind: 'importing', done: 0, total: rows.length })
    for (const row of rows) {
      try {
        const created = await createEmployee(row.input!)
        outcomes.push({ row, username: created.username })
      } catch (err) {
        outcomes.push({ row, error: err instanceof Error ? err.message : t('error') })
      }
      setStep({ kind: 'importing', done: outcomes.length, total: rows.length })
    }
    queryClient.invalidateQueries({ queryKey: qk.employees() })
    setStep({ kind: 'results', outcomes, skipped })
  }

  function downloadResults(outcomes: Outcome[], skipped: ImportRow[]) {
    const header = [t('importRow'), t('name'), t('department'), t('username'), t('initialPassword'), t('status'), t('importNotes')]
    const body: (string | number)[][] = [
      ...outcomes.map(o => [
        o.row.rowNumber,
        o.row.name,
        o.row.departmentName,
        o.username ?? '',
        o.username ? DEFAULT_EMPLOYEE_PASSWORD : '',
        o.username ? t('importCreated') : t('importFailed'),
        o.error ?? o.row.warnings.map(issueText).join('; '),
      ]),
      ...skipped.map(r => [
        r.rowNumber, r.name, r.departmentName, '', '', t('importSkipped'), r.errors.map(issueText).join('; '),
      ]),
    ].sort((a, b) => Number(a[0]) - Number(b[0]))
    exportRows([header, ...body], 'employees-import-results', t('employees'))
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col" dir={dir}>
        <DialogHeader>
          <DialogTitle>{t('importEmployees')}</DialogTitle>
        </DialogHeader>

        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />

        {step.kind === 'pick' && (
          <>
            <div className="space-y-3 text-sm">
              <p>{t('importStepHint')}</p>
              <p className="text-muted-foreground">{t('importDateHint')}</p>
              <p className="text-muted-foreground">
                {IMPORT_COLUMNS.map(c => `${c[lang === 'ar' ? 'ar' : 'en']}${c.required ? ' *' : ''}`).join(' · ')}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={downloadTemplate}>
                <Download className="h-4 w-4 me-2" />
                {t('downloadTemplate')}
              </Button>
              <Button onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 me-2" />
                {t('chooseFile')}
              </Button>
            </DialogFooter>
          </>
        )}

        {step.kind === 'preview' && (() => {
          const { rows, missingColumns } = step.preview
          const valid = rows.filter(r => r.input)
          const invalid = rows.filter(r => !r.input)
          const withWarnings = valid.filter(r => r.warnings.length > 0).length
          return (
            <>
              <div className="space-y-2 text-sm">
                <p className="font-medium flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 shrink-0" />
                  <span className="truncate">{step.fileName}</span>
                </p>
                <p className="text-muted-foreground">
                  {t('importSummary', { valid: valid.length, warnings: withWarnings, errors: invalid.length })}
                </p>
                {missingColumns.length > 0 && (
                  <p className="rounded-lg bg-rose-500/10 p-2 text-rose-600">
                    {t('importMissingColumns', {
                      columns: IMPORT_COLUMNS.filter(c => missingColumns.includes(c.field)).map(c => c[lang === 'ar' ? 'ar' : 'en']).join('، '),
                    })}
                  </p>
                )}
              </div>
              <div className="flex-1 min-h-0 overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-center w-14">{t('importRow')}</TableHead>
                      <TableHead className="text-start">{t('name')}</TableHead>
                      <TableHead className="text-start">{t('department')}</TableHead>
                      <TableHead className="text-center">{t('joinDate')}</TableHead>
                      <TableHead className="text-center">{t('balance')}</TableHead>
                      <TableHead className="text-start">{t('importNotes')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(r => (
                      <TableRow key={r.rowNumber} className={r.input ? '' : 'bg-rose-500/5'}>
                        <TableCell className="text-center font-mono text-xs">{r.rowNumber}</TableCell>
                        <TableCell className="font-medium">{r.name || '—'}</TableCell>
                        <TableCell>{r.departmentName || '—'}</TableCell>
                        <TableCell className="text-center font-mono text-xs">{r.joinDate ?? '—'}</TableCell>
                        <TableCell className="text-center">{r.input?.join_date ? '—' : (r.input?.leave_balance ?? r.balance ?? '—')}</TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-col items-start gap-1">
                            {r.errors.map((issue, i) => (
                              <Badge key={`e${i}`} className="bg-rose-500/10 text-rose-600 border-0 whitespace-normal h-auto text-start">{issueText(issue)}</Badge>
                            ))}
                            {r.warnings.map((issue, i) => (
                              <Badge key={`w${i}`} className="bg-amber-500/10 text-amber-600 border-0 whitespace-normal h-auto text-start">{issueText(issue)}</Badge>
                            ))}
                            {r.errors.length === 0 && r.warnings.length === 0 && (
                              <Badge className="bg-emerald-500/10 text-emerald-600 border-0">{t('importReady')}</Badge>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setStep({ kind: 'pick' })}>{t('goBack')}</Button>
                <Button disabled={valid.length === 0} onClick={() => runImport(valid, invalid)}>
                  {t('importValidRows', { count: valid.length })}
                </Button>
              </DialogFooter>
            </>
          )
        })()}

        {step.kind === 'importing' && (
          <div className="py-8 space-y-3 text-center text-sm">
            <p>{t('importProgress', { done: step.done, total: step.total })}</p>
            <div className="mx-auto h-2 w-64 max-w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${step.total ? (step.done / step.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}

        {step.kind === 'results' && (() => {
          const created = step.outcomes.filter(o => o.username !== undefined)
          const failed = step.outcomes.filter(o => o.error !== undefined)
          return (
            <>
              <div className="space-y-2 text-sm">
                <p className="font-medium">{t('importResultSummary', { created: created.length, failed: failed.length + step.skipped.length })}</p>
                {created.length > 0 && (
                  <p className="text-muted-foreground">{t('importPasswordNote', { password: DEFAULT_EMPLOYEE_PASSWORD })}</p>
                )}
              </div>
              <div className="flex-1 min-h-0 overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-center w-14">{t('importRow')}</TableHead>
                      <TableHead className="text-start">{t('name')}</TableHead>
                      <TableHead className="text-start">{t('username')}</TableHead>
                      <TableHead className="text-start">{t('status')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {created.map(o => (
                      <TableRow key={o.row.rowNumber}>
                        <TableCell className="text-center font-mono text-xs">{o.row.rowNumber}</TableCell>
                        <TableCell className="font-medium">{o.row.name}</TableCell>
                        <TableCell><code className="font-mono bg-muted px-1.5 py-0.5 rounded" dir="ltr">{o.username}</code></TableCell>
                        <TableCell><Badge className="bg-emerald-500/10 text-emerald-600 border-0">{t('importCreated')}</Badge></TableCell>
                      </TableRow>
                    ))}
                    {failed.map(o => (
                      <TableRow key={o.row.rowNumber} className="bg-rose-500/5">
                        <TableCell className="text-center font-mono text-xs">{o.row.rowNumber}</TableCell>
                        <TableCell className="font-medium">{o.row.name}</TableCell>
                        <TableCell>—</TableCell>
                        <TableCell className="text-xs text-rose-600">{t('importFailed')}: {o.error}</TableCell>
                      </TableRow>
                    ))}
                    {step.skipped.map(r => (
                      <TableRow key={r.rowNumber} className="opacity-60">
                        <TableCell className="text-center font-mono text-xs">{r.rowNumber}</TableCell>
                        <TableCell className="font-medium">{r.name || '—'}</TableCell>
                        <TableCell>—</TableCell>
                        <TableCell className="text-xs">{t('importSkipped')}: {r.errors.map(issueText).join('; ')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => downloadResults(step.outcomes, step.skipped)}>
                  <Download className="h-4 w-4 me-2" />
                  {t('downloadResults')}
                </Button>
                <Button onClick={() => close(false)}>{t('closeDialog')}</Button>
              </DialogFooter>
            </>
          )
        })()}
      </DialogContent>
    </Dialog>
  )
}
