/** Real pi-ai login and queued durable writes share the authorization commit decision. */
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import AuthorizationController from '../../../api/settings-controller/src/authorization.ts'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { credentialStoreFrom, authContextFrom, recordKeyFor } from '../src/auth.ts'
import { registerPiAiFlows } from '../src/login.ts'
import { catalogProvider } from '../src/catalog.ts'

const KEY = recordKeyFor('openai-codex')
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function boot() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-auth-commit-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(AuthorizationController)
  registerPiAiFlows(ctx, { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) })
  return ctx
}

it('refuses a cancelled store mutation after it waits in the real write queue', async () => {
  const ctx = await boot()
  const old = { kind: 'grant' as const, payload: { type: 'oauth', access: 'old-access', refresh: 'old-refresh', expires: 1 } }
  await ctx.credentials.modifyRecord(KEY, () => Promise.resolve(old))
  const gate = Promise.withResolvers<undefined>()
  const holding = Promise.withResolvers<undefined>()
  onTestFinished(() => { gate.resolve(undefined) })
  const lock = ctx.credentials.modifyRecord(credentialKey('review', 'lock'), async () => {
    holding.resolve(undefined); await gate.promise; return undefined
  })
  await holding.promise
  const abort = new AbortController()
  const mutation = credentialStoreFrom(ctx).modify('openai-codex', () => Promise.resolve({
    type: 'oauth', access: 'new-access', refresh: 'new-refresh', expires: 2,
  }), { signal: abort.signal })
  const rejected = expect(mutation).rejects.toThrow()
  abort.abort()
  gate.resolve(undefined)
  await lock
  await rejected
  expect(await ctx.credentials.readRecord(KEY)).toEqual(old)
})

it('waits for an admitted durable login commit rather than reporting cancellation', async () => {
  const ctx = await boot()
  const oauth = catalogProvider('openai-codex')?.auth.oauth
  if (!oauth) throw new Error('Codex OAuth missing')
  vi.spyOn(oauth, 'login').mockResolvedValue({ type: 'oauth', access: 'new-access', refresh: 'new-refresh', expires: 2 })
  const queued = Promise.withResolvers<undefined>()
  const gate = Promise.withResolvers<undefined>()
  onTestFinished(() => { gate.resolve(undefined) })
  const original = ctx.credentials.modifyRecord.bind(ctx.credentials)
  vi.spyOn(ctx.credentials, 'modifyRecord').mockImplementation(async (key, mutate) => {
    queued.resolve(undefined); await gate.promise; return original(key, mutate)
  })
  const abort = new AbortController()
  const attempt = ctx.authorization.begin({ key: KEY, signal: abort.signal, interaction: {
    notify: () => {}, prompt: () => Promise.resolve('device_code'),
  } })
  await queued.promise
  abort.abort()
  gate.resolve(undefined)
  expect(await attempt).toEqual({ status: 'authorized' })
  expect(await ctx.credentials.readRecord(KEY)).toMatchObject({ kind: 'grant', payload: { access: 'new-access' } })
})

it('does not expose a partial native OAuth response in the Remote error', async () => {
  const ctx = await boot()
  const responses = [
    { device_auth_id: 'dummy-device', user_code: 'DUMMY-CODE', interval: 0 },
    { authorization_code: 'dummy-code', code_verifier: 'dummy-verifier' },
    { access_token: 'REVIEW_ACCESS_SECRET', expires_in: 3600 },
  ]
  const fetch = vi.fn(async () => Response.json(responses.shift()))
  vi.stubGlobal('fetch', fetch)
  let failure: unknown
  try {
    for await (const event of ctx.authorizationController.begin(KEY, undefined, new AbortController().signal)) {
      if (event.type === 'prompt') ctx.authorizationController.answer(event.prompt.promptId, 'device_code')
    }
  } catch (error) { failure = error }
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(failure).toMatchObject({ code: 'authorization/failed' })
  expect(failure instanceof Error && failure.message).not.toContain('REVIEW_ACCESS_SECRET')
})

it('does not commit a mutation that returns after cancellation', async () => {
  const ctx = await boot()
  const gate = Promise.withResolvers<undefined>()
  const started = Promise.withResolvers<undefined>()
  onTestFinished(() => { gate.resolve(undefined) })
  const abort = new AbortController()
  const mutation = credentialStoreFrom(ctx).modify('openai-codex', async () => {
    started.resolve(undefined); await gate.promise
    return { type: 'oauth', access: 'new-access', refresh: 'new-refresh', expires: 2 }
  }, { signal: abort.signal })
  const rejected = expect(mutation).rejects.toThrow()
  await started.promise
  abort.abort()
  gate.resolve(undefined)
  await rejected
  expect(await ctx.credentials.readRecord(KEY)).toBeUndefined()
})

it('refuses a mutation cancelled before it starts', async () => {
  const ctx = await boot()
  await expect(credentialStoreFrom(ctx).modify('openai-codex', () => Promise.resolve({
    type: 'oauth', access: 'new-access', refresh: 'new-refresh', expires: 2,
  }), { signal: AbortSignal.abort() })).rejects.toThrow()
  expect(await ctx.credentials.readRecord(KEY)).toBeUndefined()
})
