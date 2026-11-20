/**
 * The desktop's cloud switch in a browser (design §12.1, Playwright).
 *
 * `?demo=cloud` mounts the real switch, chip, banners and overlay on the
 * hook the app uses. The test plays the shell: a stand-in for Tauri's
 * `invoke` answers `backend_state` and records the commands, and each
 * state is pushed as the shell pushes it — an `igni-host` event of type
 * `igni:backend-state` (what `init_script.js` turns `igni-backend-state`
 * into).
 */

import { expect, test, type Page } from '@playwright/test'

/** A snapshot with the shell's wire names. */
function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    side: 'local',
    state: 'local',
    reason: null,
    detail: null,
    credential_warning: false,
    mode: 'local_and_cloud',
    cloud: 'available',
    switch_visible: true,
    chip_visible: true,
    can_use_local: true,
    backend_key: 'local',
    local_activity: { runs: 0, approvals: 0 },
    notice: null,
    retry_in_ms: null,
    ...overrides,
  }
}

async function openAsDesktop(page: Page) {
  await page.addInitScript((first) => {
    const calls: Array<[string, unknown]> = []
    ;(window as unknown as { __shellCalls: typeof calls }).__shellCalls = calls
    ;(window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: {
        invoke: async (cmd: string, args?: unknown) => {
          calls.push([cmd, args ?? null])
          return cmd === 'backend_state' ? first : null
        },
      },
    }
  }, snapshot())
  await page.goto('/?demo=cloud')
}

async function push(page: Page, overrides: Record<string, unknown>) {
  await page.evaluate((payload) => {
    window.dispatchEvent(new CustomEvent('igni-host', { detail: { type: 'igni:backend-state', payload } }))
  }, snapshot(overrides))
}

const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __shellCalls: Array<[string, unknown]> }).__shellCalls)

test('the switch flips through the shell and the chip follows the state', async ({ page }) => {
  await openAsDesktop(page)
  const live = page.getByTestId('cloud-live')
  await expect(live.locator('.backend-chip')).toHaveText('This computer')

  await live.getByRole('radio', { name: 'Cloud' }).click()
  await expect.poll(async () => (await calls(page)).filter(([c]) => c === 'switch_backend')).toEqual([
    ['switch_backend', { side: 'cloud' }],
  ])

  await push(page, { side: 'cloud', state: 'dialing' })
  await expect(live.locator('.backend-chip')).toHaveText('Cloud · waking…')
  await push(page, { side: 'cloud', state: 'cloud_ready' })
  await expect(live.locator('.backend-chip')).toHaveText('Cloud')
  await expect(live.getByRole('radio', { name: 'Cloud' })).toHaveAttribute('aria-checked', 'true')
})

test('the waking overlay waits 800 ms and a ready VM never shows it', async ({ page }) => {
  await openAsDesktop(page)
  const live = page.getByTestId('cloud-live')
  await push(page, { side: 'cloud', state: 'waking' })
  await expect(live.getByText('Waking your cloud igni…')).toHaveCount(0)
  await expect(live.getByText('Waking your cloud igni…')).toBeVisible({ timeout: 3_000 })
  await push(page, { side: 'cloud', state: 'cloud_ready' })
  await expect(live.getByText('Waking your cloud igni…')).toHaveCount(0)

  await push(page, { side: 'cloud', state: 'dialing' })
  await push(page, { side: 'cloud', state: 'cloud_ready' })
  await page.waitForTimeout(1_000)
  await expect(live.getByText('Waking your cloud igni…')).toHaveCount(0)
})

test('each error state has its banner and its buttons reach the shell', async ({ page }) => {
  await openAsDesktop(page)
  const live = page.getByTestId('cloud-live')

  await push(page, { side: 'cloud', state: 'cloud_needs_sign_in' })
  await expect(live.getByText('Your cloud igni needs you to sign in again.')).toBeVisible()
  await live.getByRole('button', { name: 'Sign in', exact: true }).click()

  await push(page, { side: 'cloud', state: 'cloud_unreachable', reason: 'network' })
  await expect(live.getByText("Can't reach your cloud igni. Retrying…")).toBeVisible()
  await live.getByRole('button', { name: 'Retry' }).click()
  await live.getByRole('button', { name: 'Use this computer' }).click()

  await push(page, { side: 'cloud', state: 'cloud_unreachable', reason: 'busy', can_use_local: false })
  await expect(live.getByText('Your cloud is busy. Retrying…')).toBeVisible()
  await expect(live.getByRole('button', { name: 'Use this computer' })).toHaveCount(0)

  await push(page, { side: 'local', state: 'refused', reason: 'inactive' })
  await expect(live.getByText(/not active.*Using this computer instead/)).toBeVisible()
  await live.getByRole('button', { name: 'Dismiss' }).click()

  const made = (await calls(page)).map(([c, a]) => (c === 'switch_backend' ? `${c}:${JSON.stringify(a)}` : c))
  expect(made).toEqual(
    expect.arrayContaining(['cloud_sign_in', 'cloud_retry', 'switch_backend:{"side":"local"}', 'dismiss_backend_notice']),
  )
})

test('cloud mode shows Cloud with no control, and local mode nothing', async ({ page }) => {
  await openAsDesktop(page)
  const live = page.getByTestId('cloud-live')
  await push(page, { side: 'cloud', state: 'cloud_ready', mode: 'cloud', switch_visible: false })
  await expect(live.locator('.backend-chip')).toHaveText('Cloud')
  await expect(live.getByRole('radiogroup')).toHaveCount(0)
  await push(page, { mode: 'local', switch_visible: false, chip_visible: false, cloud: 'unavailable' })
  await expect(live.locator('.backend-chip')).toHaveCount(0)
  await expect(live.getByRole('radiogroup')).toHaveCount(0)
})

test('a cloud extension is framed from the shell origin, never the VM one, and its indicator shows', async ({ page }) => {
  const shellOrigin = 'http://127.0.0.1:59111'
  // The shell's page origin, as the frame would reach it.
  await page.route(`${shellOrigin}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      headers: { 'Content-Security-Policy': "default-src 'self'" },
      body: '<!doctype html><title>Reviews</title><h1 id="from-the-cloud">Reviews from the cloud</h1>',
    }),
  )
  await page.addInitScript(({ first, origin }) => {
    const calls: Array<[string, unknown]> = []
    ;(window as unknown as { __shellCalls: typeof calls }).__shellCalls = calls
    ;(window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: {
        invoke: async (cmd: string, args?: unknown) => {
          calls.push([cmd, args ?? null])
          if (cmd === 'backend_state') return first
          if (cmd === 'cloud_page_origin') return origin
          return null
        },
      },
    }
  }, { first: snapshot({ side: 'cloud', state: 'waking' }), origin: shellOrigin })
  await page.goto('/?demo=cloud&side=cloud&backend=cloud-0123456789ab&extension=1')
  const panel = page.getByTestId('cloud-extension')

  // Not ready: no frame loads against a VM that cannot answer.
  await expect(panel.getByText('Reviewer opens once your cloud igni is ready.')).toBeVisible()
  await expect(panel.locator('iframe')).toHaveCount(0)

  await push(page, { side: 'cloud', state: 'cloud_ready', backend_key: 'cloud-0123456789ab' })
  const frame = panel.locator('iframe')
  await expect(frame).toHaveAttribute('src', `${shellOrigin}/index.html`)
  await expect(page.frameLocator('[data-testid="cloud-extension"] iframe').locator('#from-the-cloud')).toHaveText(
    'Reviews from the cloud',
  )
  expect(await frame.getAttribute('src')).not.toContain('41234')
  await expect(panel.getByText('3 waiting')).toBeVisible()
  expect((await calls(page)).filter(([c]) => c === 'cloud_page_origin')).toEqual([
    ['cloud_page_origin', { extensionId: 'acme.reviewer' }],
  ])
})
