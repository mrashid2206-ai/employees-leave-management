import { test, expect, type Page } from '@playwright/test'
import { E2E } from './global-setup'

async function useEnglish(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('app-lang', 'en'))
}

// A security gate: a new hire on the default password must not be able to use the
// portal until they set their own password.
test('new hire is forced to change password before using the portal', async ({ page }) => {
  await useEnglish(page)

  await page.goto('/employee-login')
  await page.getByPlaceholder('Enter username').fill(E2E.newHire.username)
  await page.getByPlaceholder('Enter password').fill(E2E.newHire.password)
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL('**/check-in')

  // Gate is shown and the normal portal (check-in button) is NOT reachable.
  await expect(page.getByText('Password Change Required')).toBeVisible()
  await expect(page.getByTestId('btn-check-in')).toHaveCount(0)

  await page.getByPlaceholder('Current password').fill(E2E.newHire.password)
  await page.getByPlaceholder('New password').fill('brand-new-pass-1')
  await page.getByPlaceholder('Confirm password').fill('brand-new-pass-1')
  await page.getByRole('button', { name: 'Change Password' }).click()

  // Gate clears and the portal becomes usable.
  await expect(page.getByTestId('btn-check-in')).toBeVisible()
})
