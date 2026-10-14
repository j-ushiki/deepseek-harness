/** Installation identity and ID-token verification for Sign in with ChatGPT. */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose'
import type { CredentialStore, LoginOptions } from '@earendil-works/pi-ai'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

const ISSUER = 'https://auth.openai.com'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Read or atomically allocate the installation UUID; invalid or unreadable files fail sign-in. */
async function hostId(path: string, signal: AbortSignal): Promise<string> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  return withFileLock(path, async () => {
    signal.throwIfAborted()
    let value: string
    try {
      value = (await readFile(path, 'utf8')).trim()
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      value = randomUUID()
      await writeFileAtomic(path, `${value}\n`, { mode: 0o600, dirMode: 0o700 })
    }
    if (!UUID.test(value)) throw new Error('The ChatGPT host ID file must contain a UUID v4; restore the file before signing in.')
    return value
  })
}

/**
 * Prepare a stable installation ID, returning registration, and signature/claim verification.
 * @param store - provider credentials holding the previous verified ChatGPT registration.
 * @param path - UUID file; omission uses `<DSH_HOME>/.chatgpt-host-id`.
 * @param signal - cancels preparation and ID-token key retrieval.
 * @returns pi-ai login options; returning authorization URLs can include an ID-token hint.
 */
export async function chatgptLoginOptions(store: CredentialStore, path: string | undefined, signal: AbortSignal): Promise<LoginOptions> {
  signal.throwIfAborted()
  const deviceId = await hostId(path ?? join(resolveDshHome(), '.chatgpt-host-id'), signal)
  const previous = await store.read('openai', { signal })
  let client: LoginOptions['chatgptClient']
  if (previous?.type === 'oauth') {
    if (typeof previous.clientId !== 'string' || previous.clientId.length === 0
      || typeof previous.idToken !== 'string' || previous.idToken.length === 0
      || typeof previous.subject !== 'string' || previous.subject.length === 0) {
      throw new Error('The stored ChatGPT registration is incomplete; remove its credential record and sign in again.')
    }
    client = { clientId: previous.clientId, idToken: previous.idToken, subject: previous.subject }
  }
  const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`), {
    [customFetch]: (url, options) => fetch(url, { ...options, signal: AbortSignal.any([signal, options.signal]) }),
  })
  return {
    getDeviceId: () => deviceId,
    agentName: 'DeepSeek Harness',
    callbackPort: 0,
    ...client === undefined ? {} : { chatgptClient: client },
    verifyChatGPTIdToken: async (token, expected) => {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: ISSUER,
        audience: expected.clientId,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
      })
      if (payload.nonce !== expected.nonce || typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new Error('The ChatGPT ID token did not match the sign-in attempt.')
      }
      if (client !== undefined && payload.sub !== client.subject) {
        throw new Error('ChatGPT sign-in returned a different account; the existing credential was kept.')
      }
      return payload.sub
    },
  }
}
