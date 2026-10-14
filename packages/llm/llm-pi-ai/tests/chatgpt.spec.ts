import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import type { CredentialStore, OAuthCredential } from '@earendil-works/pi-ai'
import { chatgptLoginOptions } from '../src/chatgpt.ts'

const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = { ...await exportJWK(publicKey), kid: 'review-key', alg: 'RS256', use: 'sig' }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function path() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-chatgpt-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  return join(dir, 'host-id')
}
function store(previous?: OAuthCredential): CredentialStore {
  return {
    read: () => Promise.resolve(previous), list: () => Promise.resolve([]),
    modify: (_id, fn) => fn(previous), delete: () => Promise.resolve(),
  }
}
function keys() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    expect(url).toBe('https://auth.openai.com/.well-known/jwks.json')
    return Response.json({ keys: [jwk] })
  }))
}
async function token(claims: Record<string, unknown> = {}, key = privateKey) {
  return new SignJWT({ nonce: 'nonce', ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'review-key' })
    .setIssuer('https://auth.openai.com').setAudience('oaiapp_test').setSubject('account')
    .setIssuedAt().setExpirationTime('5m').sign(key)
}

it('persists one private host UUID across simultaneous attempts and restarts', async () => {
  const file = await path()
  const signal = new AbortController().signal
  const options = await Promise.all([chatgptLoginOptions(store(), file, signal), chatgptLoginOptions(store(), file, signal)])
  expect(options[0].getDeviceId?.()).toBe(options[1].getDeviceId?.())
  expect((await readFile(file, 'utf8')).trim()).toBe(options[0].getDeviceId?.())
  expect((await chatgptLoginOptions(store(), file, signal)).getDeviceId?.()).toBe(options[0].getDeviceId?.())
  expect(options[0].agentName).toBe('DeepSeek Harness')
  if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600)
})

it('rejects a malformed host ID without replacing it', async () => {
  const file = await path()
  await writeFile(file, 'not-a-uuid\n')
  await expect(chatgptLoginOptions(store(), file, new AbortController().signal)).rejects.toThrow('UUID v4')
  expect(await readFile(file, 'utf8')).toBe('not-a-uuid\n')
})

it('does not turn an unreadable host file into a new identity', async () => {
  const file = await path()
  await mkdir(file)
  await expect(chatgptLoginOptions(store(), file, new AbortController().signal)).rejects.toMatchObject({ code: 'EISDIR' })
})

it('refuses an already cancelled sign-in before allocating identity', async () => {
  const file = await path()
  await expect(chatgptLoginOptions(store(), file, AbortSignal.abort())).rejects.toThrow()
  await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('keeps the saved client and account for returning sign-in', async () => {
  keys()
  const options = await chatgptLoginOptions(store({
    type: 'oauth', access: 'access', refresh: 'refresh', expires: 1,
    clientId: 'oaiapp_test', idToken: 'previous-token', subject: 'account',
  }), await path(), new AbortController().signal)
  expect(options.chatgptClient).toEqual({ clientId: 'oaiapp_test', idToken: 'previous-token', subject: 'account' })
  await expect(options.verifyChatGPTIdToken?.(await token(), { clientId: 'oaiapp_test', nonce: 'nonce' })).resolves.toBe('account')
  const other = await new SignJWT({ nonce: 'nonce' }).setProtectedHeader({ alg: 'RS256', kid: 'review-key' })
    .setIssuer('https://auth.openai.com').setAudience('oaiapp_test').setSubject('other').setIssuedAt().setExpirationTime('5m').sign(privateKey)
  await expect(options.verifyChatGPTIdToken?.(other, { clientId: 'oaiapp_test', nonce: 'nonce' })).rejects.toThrow('different account')
})

it.each([
  {}, { clientId: 'client' }, { clientId: 'client', idToken: 'token' },
])('refuses incomplete saved OAuth metadata: %j', async (metadata) => {
  await expect(chatgptLoginOptions(store({ type: 'oauth', access: 'access', refresh: 'refresh', expires: 1, ...metadata }),
    await path(), new AbortController().signal)).rejects.toThrow('incomplete')
})

it.each(['signature', 'issuer', 'audience', 'expiry', 'nonce', 'missing-nonce', 'empty-subject'] as const)(
  'refuses an ID token with invalid %s', async (invalid) => {
    keys()
    const options = await chatgptLoginOptions(store(), await path(), new AbortController().signal)
    const jwt = new SignJWT(invalid === 'missing-nonce' ? {} : { nonce: invalid === 'nonce' ? 'wrong' : 'nonce' })
      .setProtectedHeader({ alg: 'RS256', kid: 'review-key' }).setIssuedAt()
      .setIssuer(invalid === 'issuer' ? 'https://other.example' : 'https://auth.openai.com')
      .setAudience(invalid === 'audience' ? 'another-client' : 'oaiapp_test')
      .setSubject(invalid === 'empty-subject' ? '' : 'account')
      .setExpirationTime(invalid === 'expiry' ? 1 : '5m')
    const signingKey = invalid === 'signature' ? (await generateKeyPair('RS256')).privateKey : privateKey
    const signed = await jwt.sign(signingKey)
    await expect(options.verifyChatGPTIdToken?.(signed, { clientId: 'oaiapp_test', nonce: 'nonce' })).rejects.toThrow()
  },
)

it('uses the harness home for the default identity path', async () => {
  const file = await path()
  vi.stubEnv('DSH_HOME', join(file, '..'))
  onTestFinished(() => { vi.unstubAllEnvs() })
  const options = await chatgptLoginOptions(store(), undefined, new AbortController().signal)
  expect((await readFile(join(file, '..', '.chatgpt-host-id'), 'utf8')).trim()).toBe(options.getDeviceId?.())
})

it.each(['attempt', 'deadline'] as const)('aborts JWKS retrieval on the %s signal', async (owner) => {
  const attempt = new AbortController()
  const deadline = new AbortController()
  const started = Promise.withResolvers<undefined>()
  onTestFinished(() => { attempt.abort(); deadline.abort() })
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init.signal
    if (!signal) throw new Error('Missing JWKS request signal')
    signal.addEventListener('abort', () => { reject(new Error('JWKS retrieval stopped')) }, { once: true })
    started.resolve(undefined)
  })))
  const options = await chatgptLoginOptions(store(), await path(), attempt.signal)
  const verification = options.verifyChatGPTIdToken?.(await token(), { clientId: 'oaiapp_test', nonce: 'nonce' })
  const rejected = expect(verification).rejects.toThrow()
  await started.promise
  const controller = owner === 'attempt' ? attempt : deadline
  controller.abort(new Error('JWKS retrieval stopped'))
  await rejected
})
