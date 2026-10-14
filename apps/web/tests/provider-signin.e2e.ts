/** Provider sign-in through the shipped Web composition and Remote stream, with a synthetic exchange. */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-authorization'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode,
} from './scaffold.ts'
import { openSettings } from './support.ts'

it('stores a sign-in grant and releases a cancelled attempt through the browser', async () => {
  const scaffold = await launchWebScaffold({})
  onTestFinished(() => scaffold.close())
  const key = credentialKey('llm-pi-ai', 'signin-smoke')
  let finished = 0
  scaffold.ctx.effect(() => scaffold.ctx.authorization.registerFlow({
    key,
    label: 'Fixture account',
    methods: [{ id: 'oauth', label: 'Sign in' }],
    async run(session) {
      try {
        session.notify({ message: 'Continue in your browser', url: 'https://auth.example/start', code: 'TEST-CODE' })
        const code = await session.prompt({ kind: 'secret', message: 'Exchange code' })
        if (code === 'fixture-error') throw new Error('REVIEW_ACCESS_SECRET')
        await session.commit({ kind: 'grant', payload: { code } })
      } finally {
        finished += 1
      }
    },
  }))
  await scaffold.ctx.settings.mutate('llm-pi-ai', [{
    op: 'set', path: ['providers', 'signin-smoke'],
    value: { api: 'openai-completions', baseURL: 'https://model.example/v1',
      models: [{ id: 'fixture', contextWindow: 4096, maxTokens: 256, input: ['text'] }] },
  }])
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 1000 } })
  await page.goto(scaffold.authenticatedUrl)
  await openSettings(page, 'en')
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await dialog.getByRole('button', { name: 'Models', exact: true }).click()
  await dialog.getByRole('button', { name: 'Edit signin-smoke', exact: true }).click()
  const signIn = dialog.getByRole('button', { name: 'Sign in', exact: true })
  await signIn.click()
  const prompt = dialog.getByLabel('Exchange code', { exact: true })
  await prompt.waitFor()
  expect(await prompt.getAttribute('type')).toBe('password')
  expect(await dialog.getByRole('link', { name: 'https://auth.example/start' }).getAttribute('rel')).toBe('noreferrer')
  const golden = fileURLToPath(new URL('./expected/provider-signin/prompt.expected.md', import.meta.url))
  await compareOrRefreshGolden(golden, await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), webSnapshotMode())
  await prompt.fill('fixture-exchange')
  await dialog.getByRole('button', { name: 'Submit', exact: true }).click()
  await dialog.getByRole('status').filter({ hasText: 'Signed in.' }).waitFor()
  expect(await scaffold.ctx.credentials.readRecord(key)).toEqual({ kind: 'grant', payload: { code: 'fixture-exchange' } })
  await signIn.click()
  await prompt.waitFor()
  await dialog.getByRole('button', { name: 'Cancel sign-in', exact: true }).click()
  await dialog.getByRole('status').filter({ hasText: 'Sign-in was cancelled.' }).waitFor()
  await expect.poll(() => finished).toBe(2)
  expect(scaffold.ctx.authorization.describe(key)?.inFlight).toBe(false)
  await signIn.click()
  await prompt.waitFor()
  await prompt.fill('fixture-error')
  await dialog.getByRole('button', { name: 'Submit', exact: true }).click()
  const failure = dialog.getByRole('alert').filter({ hasText: 'Sign-in failed. Try again or check the Host configuration.' })
  await failure.waitFor()
  expect(await failure.textContent()).not.toContain('REVIEW_ACCESS_SECRET')
  const failedGolden = fileURLToPath(new URL('./expected/provider-signin/failed.expected.md', import.meta.url))
  await compareOrRefreshGolden(failedGolden, await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), webSnapshotMode())
  expect(await scaffold.ctx.credentials.readRecord(key)).toEqual({ kind: 'grant', payload: { code: 'fixture-exchange' } })
})
