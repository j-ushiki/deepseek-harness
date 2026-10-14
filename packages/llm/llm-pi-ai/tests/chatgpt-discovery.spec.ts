/** Account-specific ChatGPT discovery uses the stored grant only at the public endpoint. */
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { recordKeyFor } from '../src/auth.ts'

async function boot(apiKeyEnv?: string) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(MemoryCredentials, {})
  await ctx.credentials.modifyRecord(recordKeyFor('openai'), () => Promise.resolve({ kind: 'grant', payload: {
    type: 'oauth', access: 'fixture-access', refresh: 'fixture-refresh', expires: Date.now() + 3_600_000,
    clientId: 'oaiapp_test', idToken: 'fixture-id-token', subject: 'account',
  } }))
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, { providers: { openai: { ...apiKeyEnv === undefined ? {} : { apiKeyEnv } } } })
  return ctx
}
afterEach(() => { vi.unstubAllGlobals() })

it('preserves visible slugs and server order and enriches known capacities', async () => {
  const ctx = await boot()
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('https://api.openai.com/v1/models')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-access')
    return Response.json({ models: [
      { slug: 'new-model', display_name: 'New model', visibility: 'list' },
      { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' },
      { slug: 'hidden-model', display_name: 'Hidden', visibility: 'hidden' },
      null,
    ] })
  })
  vi.stubGlobal('fetch', fetch)
  const models = await ctx.llm.discoverModels('llm-pi-ai', { provider: 'openai' })
  expect(models.map(model => model.id)).toEqual(['new-model', 'gpt-6.1-sol'])
  expect(models[0]).toEqual({ id: 'new-model', name: 'New model' })
  expect(models[1]?.contextWindow).toBeGreaterThan(0)
  expect(fetch).toHaveBeenCalledOnce()
})

it('does not forward a subscription token to a custom endpoint', async () => {
  const ctx = await boot()
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await expect(ctx.llm.discoverModels('llm-pi-ai', { provider: 'openai', baseURL: 'https://other.example/v1' }))
    .rejects.toThrow('public OpenAI endpoint')
  expect(fetch).not.toHaveBeenCalled()
})

it.each(['draft', 'reference'] as const)('keeps API-key %s discovery on the ordinary catalog path', async (override) => {
  const ctx = await boot(override === 'reference' ? 'OWN_OPENAI_KEY' : undefined)
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const models = await ctx.llm.discoverModels('llm-pi-ai', {
    provider: 'openai', ...override === 'draft' ? { apiKey: 'typed-key' } : {},
  })
  expect(models.length).toBeGreaterThan(0)
  expect(fetch).not.toHaveBeenCalled()
})
