/** Native pi-ai OAuth, PKCE, ID-token verification, returning sign-in, and durable commit. */
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { credentialStoreFrom, authContextFrom, recordKeyFor } from '../src/auth.ts'
import { registerPiAiFlows } from '../src/login.ts'

const ISSUER = 'https://auth.openai.com'
const CLIENT = 'oaiapp_test'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = { ...await exportJWK(publicKey), kid: 'oauth-test', alg: 'RS256', use: 'sig' }
afterEach(() => { vi.unstubAllGlobals() })

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-chatgpt-oauth-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(AuthorizationService)
  registerPiAiFlows(ctx, { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) }, join(dir, 'host-id'))
  return ctx
}

async function signIn(ctx: Context, invalid?: 'scope' | 'resource' | 'signature' | 'state' | 'client') {
  let authorization: URL | undefined
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === `${ISSUER}/.well-known/jwks.json`) return Response.json({ keys: [jwk] })
    expect(url).toBe(`${ISSUER}/api/accounts/oauth/token`)
    if (!authorization) throw new Error('No authorization request')
    const body = init?.body
    if (!(body instanceof URLSearchParams)) throw new Error('Expected URL-encoded OAuth request')
    expect(body.get('client_id')).toBe(CLIENT)
    expect(body.get('resource')).toBe('https://api.openai.com/v1')
    expect(body.get('redirect_uri')).toBe(authorization.searchParams.get('redirect_uri'))
    expect(createHash('sha256').update(body.get('code_verifier') ?? '').digest('base64url'))
      .toBe(authorization.searchParams.get('code_challenge'))
    const jwt = await new SignJWT({ nonce: authorization.searchParams.get('nonce') })
      .setProtectedHeader({ alg: 'RS256', kid: 'oauth-test' }).setIssuer(ISSUER).setAudience(CLIENT)
      .setSubject('account').setIssuedAt().setExpirationTime('5m')
      .sign(invalid === 'signature' ? (await generateKeyPair('RS256')).privateKey : privateKey)
    return Response.json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 7200,
      id_token: jwt, scope: invalid === 'scope' ? 'openid profile email' : invalid === 'resource' ? 'openid chatgpt.tokens.use.direct' : 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct' })
  }))
  const outcome = await ctx.authorization.begin({ key: recordKeyFor('openai'), method: 'oauth', interaction: {
    notify: (notice) => { if (notice.url) authorization = new URL(notice.url) },
    prompt: () => {
      if (!authorization) throw new Error('No authorization request')
      const callback = new URL(authorization.searchParams.get('redirect_uri') ?? '')
      callback.searchParams.set('code', 'fixture-code')
      callback.searchParams.set('state', invalid === 'state' ? 'wrong' : authorization.searchParams.get('state') ?? '')
      if (authorization.searchParams.get('client_id') === 'dynamic_agent_client') callback.searchParams.set('client_id', CLIENT)
      if (invalid === 'client') callback.searchParams.set('client_id', 'different-client')
      return Promise.resolve(callback.toString())
    },
  } })
  return { outcome, authorization }
}

it('registers the actual app once and reuses its client, account, and host on returning sign-in', async () => {
  const ctx = await fixture()
  const first = await signIn(ctx)
  expect(first.outcome).toEqual({ status: 'authorized' })
  expect(first.authorization?.searchParams.get('agent_name_hint')).toBe('DeepSeek Harness')
  expect(first.authorization?.searchParams.get('client_id')).toBe('dynamic_agent_client')
  expect(first.authorization?.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/)
  const grant = await ctx.credentials.readRecord(recordKeyFor('openai'))
  expect(grant).toMatchObject({ kind: 'grant', payload: { clientId: CLIENT, subject: 'account', access: 'fixture-access' } })
  const second = await signIn(ctx)
  expect(second.outcome).toEqual({ status: 'authorized' })
  expect(second.authorization?.searchParams.get('client_id')).toBe(CLIENT)
  expect(second.authorization?.searchParams.has('agent_name_hint')).toBe(false)
  expect(second.authorization?.searchParams.get('ext_agent_host_id')).toBe(first.authorization?.searchParams.get('ext_agent_host_id'))
  expect(second.authorization?.searchParams.get('id_token_hint')).toBe(grant?.kind === 'grant' && typeof grant.payload === 'object'
    && grant.payload !== null && 'idToken' in grant.payload ? grant.payload.idToken : undefined)
})

it.each(['scope', 'resource', 'signature', 'state'] as const)('does not commit a new grant after invalid %s', async (invalid) => {
  const ctx = await fixture()
  await expect(signIn(ctx, invalid)).rejects.toThrow()
  expect(await ctx.credentials.readRecord(recordKeyFor('openai'))).toBeUndefined()
})

it('keeps the current registration when a returning callback changes its client', async () => {
  const ctx = await fixture()
  await signIn(ctx)
  const old = await ctx.credentials.readRecord(recordKeyFor('openai'))
  await expect(signIn(ctx, 'client')).rejects.toThrow('changed the selected client ID')
  expect(await ctx.credentials.readRecord(recordKeyFor('openai'))).toEqual(old)
})
