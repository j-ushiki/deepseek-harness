/** Native ChatGPT refresh retains the verified registration while rotating one grant under the store lock. */
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { credentialStoreFrom, authContextFrom, recordKeyFor } from '../src/auth.ts'
import { createModels } from '../src/models.ts'
import { catalogProvider } from '../src/catalog.ts'

afterEach(() => { vi.unstubAllGlobals() })

it('refreshes once, retains registration, and confines subscription inference to OpenAI', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-chatgpt-refresh-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.credentials.modifyRecord(recordKeyFor('openai'), () => Promise.resolve({ kind: 'grant', payload: {
    type: 'oauth', access: 'expired-access', refresh: 'old-refresh', expires: 1,
    clientId: 'oaiapp_test', subject: 'account', idToken: 'verified-id-token',
  } }))
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('https://auth.openai.com/api/accounts/oauth/token')
    const body = init?.body
    if (!(body instanceof URLSearchParams)) throw new Error('Expected URL-encoded refresh request')
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('client_id')).toBe('oaiapp_test')
    expect(body.get('refresh_token')).toBe('old-refresh')
    return Response.json({ access_token: 'new-access', refresh_token: 'rotated-refresh', expires_in: 7200,
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct' })
  })
  vi.stubGlobal('fetch', fetch)
  const models = createModels({ credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) })
  const provider = catalogProvider('openai')
  if (!provider) throw new Error('No OpenAI provider')
  models.setProvider(provider)
  const auth = await Promise.all([models.getAuth('openai'), models.getAuth('openai')])
  expect(auth.map(one => one?.auth.apiKey)).toEqual(['new-access', 'new-access'])
  expect(fetch).toHaveBeenCalledOnce()
  expect(await ctx.credentials.readRecord(recordKeyFor('openai'))).toMatchObject({ kind: 'grant', payload: {
    access: 'new-access', refresh: 'rotated-refresh', clientId: 'oaiapp_test', subject: 'account', idToken: 'verified-id-token',
  } })
  const inference = vi.fn<typeof globalThis.fetch>(async () => new Response(
    JSON.stringify({ error: { message: 'Fixture refusal', type: 'invalid_request_error' } }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  ))
  vi.stubGlobal('fetch', inference)
  const model = models.getModel('openai', 'gpt-6.1-sol')
  if (!model) throw new Error('No OpenAI model')
  await models.complete({ ...model, baseUrl: 'https://other.example/v1' }, { messages: [] }, { maxRetries: 0 })
  expect(inference).toHaveBeenCalledOnce()
  const input = inference.mock.calls[0]?.[0]
  expect(input instanceof Request ? input.url : String(input)).toBe('https://api.openai.com/v1/responses')
})
