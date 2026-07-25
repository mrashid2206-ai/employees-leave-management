import { test, expect, type Page } from '@playwright/test'
import { E2E } from './global-setup'

// Force English so selectors are deterministic (the UI defaults to Arabic).
async function useEnglish(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('app-lang', 'en'))
}

async function loginAsEmployee(page: Page) {
  await page.goto('/employee-login')
  await page.getByPlaceholder('Enter username').fill(E2E.employee.username)
  await page.getByPlaceholder('Enter password').fill(E2E.employee.password)
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL('**/check-in')
}

test.describe('employee check-in', () => {
  test.use({
    permissions: ['geolocation'],
    geolocation: { latitude: 23.588, longitude: 58.3829 }, // Muscat
  })

  test('records a check-in and shows the time', async ({ page }) => {
    await useEnglish(page)
    // The portal confirms with window.confirm(); Playwright dismisses dialogs by default.
    page.on('dialog', d => d.accept())

    await loginAsEmployee(page)

    await page.getByTestId('btn-check-in').click()

    // Today's status panel only appears once a check-in exists.
    await expect(page.getByText("Today's Status")).toBeVisible()
    // Check-in is now recorded, so the button is disabled for the rest of the day.
    await expect(page.getByTestId('btn-check-in')).toBeDisabled()
  })

  test('a second check-in the same day is refused', async ({ page }) => {
    await useEnglish(page)
    page.on('dialog', d => d.accept())
    await loginAsEmployee(page)

    // Already checked in by the previous test (same seeded employee, same day).
    await expect(page.getByTestId('btn-check-in')).toBeDisabled()
  })
})
