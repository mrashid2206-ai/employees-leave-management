import { test, expect, type Page } from '@playwright/test'
import { E2E } from './global-setup'

// The app defaults to Arabic with RTL layout — that is what employees actually see. Every
// other spec forces English, so the primary experience was the untested one. A missing
// translation key or a layout ignoring `dir` would have shipped unnoticed.
//
// Deliberately LOGIN-LIGHT: one login for the whole file. Login is rate-limited to 20
// attempts per IP per 15 minutes (correct behaviour — it is brute-force protection), and a
// spec that logs in for every case eats that budget and starts failing the suite for
// reasons that have nothing to do with the code.
//
// Check-in behaviour is NOT retested here. The English spec already covers it and the
// logic does not vary by language; repeating it would only add another login and another
// 25-second wait for a GPS fix.

async function useArabic(page: Page) {
  // Arabic is already the default; set it explicitly so this does not silently depend on
  // that default staying put.
  await page.addInitScript(() => window.localStorage.setItem('app-lang', 'ar'))
}

/**
 * A missing translation falls back to the key itself, so a camelCase word with no spaces
 * appearing as visible text is the signature of an untranslated string.
 */
function untranslatedKeys(text: string): string[] {
  return text
    .split(/\s+/)
    .filter(w => /^[a-z]+[A-Z][a-zA-Z]+$/.test(w))
    .filter(w => !/^https?/.test(w))
}

test.describe('Arabic (RTL) experience', () => {
  test('the employee login renders right-to-left, in Arabic, with no missing keys', async ({ page }) => {
    await useArabic(page)
    await page.goto('/employee-login')

    // Direction is applied to the document, not just to individual components.
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')

    await expect(page.getByText('اسم المستخدم')).toBeVisible()
    await expect(page.getByText('كلمة المرور')).toBeVisible()

    const missing = untranslatedKeys(await page.locator('body').innerText())
    expect(missing, `untranslated keys on the login page: ${missing.join(', ')}`).toHaveLength(0)
  })

  test('the admin login renders right-to-left in Arabic', async ({ page }) => {
    await useArabic(page)
    await page.goto('/login')

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByText('اسم المستخدم')).toBeVisible()
  })

  test('the dashboard renders in Arabic with no missing keys', async ({ page }) => {
    await useArabic(page)
    await page.goto('/login')

    await page.getByPlaceholder('أدخل اسم المستخدم').fill(E2E.admin.username)
    await page.getByPlaceholder('أدخل كلمة المرور').fill(E2E.admin.password)
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click()
    await page.waitForURL(url => !url.pathname.includes('/login'))

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    // Navigation is translated, not showing raw keys.
    await expect(page.getByText('الموظفين').first()).toBeVisible()

    const missing = untranslatedKeys(await page.locator('body').innerText())
    expect(missing, `untranslated keys on the dashboard: ${missing.join(', ')}`).toHaveLength(0)
  })
})
