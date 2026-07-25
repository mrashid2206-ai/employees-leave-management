import { test, expect, type Page } from '@playwright/test'
import { E2E } from './global-setup'

async function useEnglish(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('app-lang', 'en'))
}

// Full-stack leave lifecycle: an employee's half-day request must survive the API, the
// approval UI, and land as an exact 0.5-day balance deduction.
test('half-day request → admin approval → balance drops by 0.5', async ({ page, browser }) => {
  await useEnglish(page)

  // --- employee submits (UI login for the real cookie, API for the form itself) ---
  await page.goto('/employee-login')
  await page.getByPlaceholder('Enter username').fill(E2E.employee.username)
  await page.getByPlaceholder('Enter password').fill(E2E.employee.password)
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL('**/check-in')

  const me = await (await page.request.get('/api/auth/employee-me')).json()
  const employeeId = me.user.id

  const types = await (await page.request.get('/api/leave-types')).json()
  const annual = types.find((t: { name_en: string }) => t.name_en === 'Annual')

  // A future single day, flagged half-day.
  const day = new Date()
  day.setDate(day.getDate() + 14)
  const date = day.toISOString().split('T')[0]

  const created = await page.request.post('/api/leaves', {
    data: {
      employee_id: employeeId,
      leave_type_id: annual.id,
      start_date: date,
      end_date: date,
      days_count: 0.5,
      is_half_day: true,
    },
  })
  expect(created.ok()).toBeTruthy()
  expect(parseFloat((await created.json()).days_count)).toBe(0.5)

  // --- admin approves from the dashboard inbox ---
  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  await useEnglish(admin)

  await admin.goto('/login')
  await admin.getByPlaceholder('Enter username').fill(E2E.admin.username)
  await admin.getByPlaceholder('Enter password').fill(E2E.admin.password)
  await admin.getByRole('button', { name: 'Login' }).click()
  await admin.waitForURL(url => !url.pathname.includes('/login'))

  await admin.goto('/')
  await expect(admin.getByText('Requests awaiting approval')).toBeVisible()
  await admin.getByRole('button', { name: 'Approve' }).first().click()

  // --- the deduction is exactly half a day ---
  await expect(async () => {
    const employees = await (await admin.request.get('/api/employees')).json()
    const emp = employees.find((e: { id: number }) => e.id === employeeId)
    expect(Number(emp.leave_balance)).toBe(29.5)
  }).toPass({ timeout: 15_000 })

  await adminContext.close()
})
