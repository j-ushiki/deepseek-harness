import { afterEach, describe, expect, it } from 'vitest'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiPeakProvider, PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { Config, resolveProfiles } from '../src/config.ts'
import { selectPeakWindow } from '../src/peak.ts'
import { memoryAuth } from './auth-double.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

afterEach(async () => {
  await closeMockServers()
})

/** One adapter over the real profile resolver with a fixed key and clock. */
function adapter(providers: Record<string, PiAiProviderProfile>, now: () => number): PiAiAdapter {
  return new PiAiAdapter({
    profiles: () => resolveProfiles(providers),
    resolveApiKey: () => Promise.resolve('test-key'),
    auth: memoryAuth(),
    now,
  })
}

/** Drain one adapter stream so its request reaches the mock server. */
async function drain(adapter: PiAiAdapter, provider: string, model: string): Promise<void> {
  for await (const _chunk of adapter.stream({ provider, model, messages: [] })) {
    // The mock server's response is fully consumed by the loop.
  }
}

describe('peak window selection', () => {
  const windows = [
    { from: '21:00', to: '03:00', timeZone: 'Asia/Tokyo', providers: [{ provider: 'opencode-go' }] },
    { from: '03:00', to: '21:00', timeZone: 'Asia/Tokyo', providers: [{ provider: 'day' }] },
  ]

  it('matches an instant inside an overnight window', () => {
    // 12:00Z is 21:00 JST, the inclusive start.
    expect(selectPeakWindow(windows, Date.UTC(2026, 0, 1, 12, 0))?.providers[0]?.provider).toBe('opencode-go')
    // 00:00Z is 09:00 JST the next day.
    expect(selectPeakWindow(windows, Date.UTC(2026, 0, 2, 0, 0))?.providers[0]?.provider).toBe('day')
  })

  it('treats the window end as exclusive', () => {
    // 18:00Z is 03:00 JST, which the overnight window does not include.
    expect(selectPeakWindow(windows, Date.UTC(2026, 0, 1, 18, 0))?.providers[0]?.provider).toBe('day')
  })

  it('evaluates each window in its own zone', () => {
    const utc = [{ from: '21:00', to: '23:00', timeZone: 'UTC', providers: [{ provider: 'utc-window' }] }]
    expect(selectPeakWindow(utc, Date.UTC(2026, 0, 1, 21, 30))?.providers[0]?.provider).toBe('utc-window')
    expect(selectPeakWindow(utc, Date.UTC(2026, 0, 1, 12, 0))).toBeUndefined()
  })

  it('reads the process zone when a window names none', () => {
    const day = [{ from: '00:00', to: '23:59', providers: [{ provider: 'process-zone' }] }]
    expect(selectPeakWindow(day, Date.UTC(2026, 0, 1, 12, 0))?.providers[0]?.provider).toBe('process-zone')
  })
})

describe('peak configuration validation', () => {
  const base = (peak: unknown): Record<string, PiAiProviderProfile> => ({
    opencode: { models: [{ id: 'deepseek-v4.1-flash', peak } as never] },
  })

  it('accepts a window over an installed catalog provider', () => {
    const profiles = resolveProfiles(base([
      { from: '21:00', to: '03:00', timeZone: 'Asia/Tokyo', providers: [{ provider: 'opencode-go' }] },
    ]))
    expect(profiles.get('opencode')?.peak.get('deepseek-v4.1-flash')).toHaveLength(1)
  })

  it('refuses a malformed clock time', () => {
    expect(() => resolveProfiles(base([
      { from: '9:00', to: '03:00', providers: [{ provider: 'opencode-go' }] },
    ]))).toThrow(/from .* must be a 24-hour HH:mm time/)
  })

  it('refuses an unknown time zone', () => {
    expect(() => resolveProfiles(base([
      { from: '21:00', to: '03:00', timeZone: 'Mars/Olympus', providers: [{ provider: 'opencode-go' }] },
    ]))).toThrow(/is not a known IANA zone/)
  })

  it('refuses a candidate the installed catalog does not describe', () => {
    expect(() => resolveProfiles(base([
      { from: '21:00', to: '03:00', providers: [{ provider: 'not-a-provider' }] },
    ]))).toThrow(/is not an installed pi-ai catalog provider/)
  })

  it('refuses a candidate that does not serve the model', () => {
    expect(() => resolveProfiles(base([
      { from: '21:00', to: '03:00', providers: [{ provider: 'openai' }] },
    ]))).toThrow(/does not serve that model/)
  })

  it('refuses a window that names no providers', () => {
    expect(() => resolveProfiles(base([
      { from: '21:00', to: '03:00', providers: [] },
    ]))).toThrow(/names no providers/)
  })

  it('survives schema validation and resolves against the bundled route', () => {
    const parsed = Config({ providers: {
      'ollama-cloud': {
        apiKeyEnv: 'OLLAMA_CLOUD_API_KEY',
        models: [{
          id: 'deepseek-v4.1-flash',
          name: 'DeepSeek V4.1 Flash',
          contextWindow: 1_048_576,
          maxTokens: 384_000,
          input: ['text', 'image'],
          peak: [{
            from: '21:00',
            to: '03:00',
            timeZone: 'Asia/Tokyo',
            providers: [{ provider: 'opencode-go', apiKeyEnv: 'OPENCODE_GO_API_KEY' }],
          }],
        }],
      },
    } }).providers.get()
    const profiles = resolveProfiles(parsed as Record<string, PiAiProviderProfile>)
    expect(profiles.get('ollama-cloud')?.peak.get('deepseek-v4.1-flash')).toHaveLength(1)
  })

  it('refuses a malformed end time', () => {
    expect(() => resolveProfiles(base([
      { from: '21:00', to: '24:00', providers: [{ provider: 'opencode-go' }] },
    ]))).toThrow(/to .* must be a 24-hour HH:mm time/)
  })

  it('refuses an empty candidate id', () => {
    expect(() => resolveProfiles(base([
      { from: '21:00', to: '03:00', providers: [{ provider: '' }] },
    ]))).toThrow(/has an empty provider/)
  })
})

describe('peak request routing', () => {
  /** Two routes serving the same catalog model, with the primary naming a peak alternate. */
  function routes(primaryURL: string, alternateURL: string): Record<string, PiAiProviderProfile> {
    return {
      opencode: {
        apiKeyEnv: 'PI_TEST_KEY',
        baseURL: primaryURL,
        models: [{
          id: 'deepseek-v4.1-flash',
          peak: [{
            from: '21:00',
            to: '03:00',
            timeZone: 'Asia/Tokyo',
            providers: [{ provider: 'opencode-go', apiKeyEnv: 'PI_TEST_KEY' }],
          }],
        }],
      },
      'opencode-go': { apiKeyEnv: 'PI_TEST_KEY', baseURL: alternateURL },
    }
  }

  it('dispatches to the alternate inside the window and to the route outside it', async () => {
    const primary = await mockServer([{ events: textEvents }])
    const alternate = await mockServer([{ events: textEvents }])
    const routes_ = routes(primary.url, alternate.url)

    const night = Date.UTC(2026, 0, 1, 12, 0) // 21:00 JST
    await drain(adapter(routes_, () => night), 'opencode', 'deepseek-v4.1-flash')
    expect(alternate.requests).toHaveLength(1)
    expect(primary.requests).toHaveLength(0)

    const day = Date.UTC(2026, 0, 1, 0, 0) // 09:00 JST
    await drain(adapter(routes_, () => day), 'opencode', 'deepseek-v4.1-flash')
    expect(primary.requests).toHaveLength(1)
    expect(alternate.requests).toHaveLength(1)
  })

  it('advertises the routing windows to selectors', async () => {
    const primary = await mockServer([{ events: textEvents }])
    const alternate = await mockServer([{ events: textEvents }])
    const pi = adapter(routes(primary.url, alternate.url), () => Date.UTC(2026, 0, 1, 0, 0))
    const windows = [{ from: '21:00', to: '03:00', timeZone: 'Asia/Tokyo', provider: 'opencode-go' }]
    const [listed] = await pi.listModels('opencode')
    expect(listed?.id).toBe('deepseek-v4.1-flash')
    expect(listed?.routing).toEqual({ windows })
    expect((await pi.resolveModel('opencode', 'deepseek-v4.1-flash')).routing).toEqual({ windows })
  })

  it('omits the zone when a window declares none', async () => {
    const providers: Record<string, PiAiProviderProfile> = {
      opencode: {
        apiKeyEnv: 'PI_TEST_KEY',
        models: [{
          id: 'deepseek-v4.1-flash',
          peak: [{ from: '21:00', to: '03:00', providers: [{ provider: 'opencode-go' }] }],
        }],
      },
    }
    const [listed] = await adapter(providers, () => Date.UTC(2026, 0, 1, 12, 0)).listModels('opencode')
    expect(listed?.routing).toEqual({ windows: [{ from: '21:00', to: '03:00', provider: 'opencode-go' }] })
  })

  it('reports the requested route while describing the dispatched model', async () => {
    const primary = await mockServer([{ events: textEvents }])
    const alternate = await mockServer([{ events: textEvents }])
    const pi = adapter(routes(primary.url, alternate.url), () => Date.UTC(2026, 0, 1, 12, 0))
    const prepared = await pi.prepareCall('opencode', 'deepseek-v4.1-flash')
    expect(prepared.model.provider).toBe('opencode')
    expect(prepared.model.id).toBe('deepseek-v4.1-flash')
  })

  it('serves a candidate that is not itself a configured route', async () => {
    const providers: Record<string, PiAiProviderProfile> = {
      opencode: {
        apiKeyEnv: 'PI_TEST_KEY',
        models: [{
          id: 'deepseek-v4.1-flash',
          name: 'Primary Name',
          peak: [{
            from: '21:00',
            to: '03:00',
            timeZone: 'Asia/Tokyo',
            providers: [{ provider: 'opencode-go' }],
          }],
        }],
      },
    }
    const night = adapter(providers, () => Date.UTC(2026, 0, 1, 12, 0))
    expect((await night.prepareCall('opencode', 'deepseek-v4.1-flash')).model.name).toBe('DeepSeek V4.1 Flash')

    const day = adapter(providers, () => Date.UTC(2026, 0, 1, 0, 0))
    expect((await day.prepareCall('opencode', 'deepseek-v4.1-flash')).model.name).toBe('Primary Name')
  })

  it('registers a shared candidate once across windows', async () => {
    const providers: Record<string, PiAiProviderProfile> = {
      opencode: {
        apiKeyEnv: 'PI_TEST_KEY',
        models: [{
          id: 'deepseek-v4.1-flash',
          peak: [
            { from: '00:00', to: '12:00', timeZone: 'Asia/Tokyo', providers: [{ provider: 'opencode-go' }] },
            { from: '12:00', to: '00:00', timeZone: 'Asia/Tokyo', providers: [{ provider: 'opencode-go' }] },
          ],
        }],
      },
    }
    const prepared = await adapter(providers, () => Date.UTC(2026, 0, 1, 12, 0))
      .prepareCall('opencode', 'deepseek-v4.1-flash')
    expect(prepared.model.name).toBe('DeepSeek V4.1 Flash')
  })

  /** A primary route whose window names `opencode-go`, itself configured with its own credential. */
  function credentialRoutes(
    primaryURL: string,
    alternateURL: string,
    candidate: PiAiPeakProvider,
  ): Record<string, PiAiProviderProfile> {
    return {
      opencode: {
        apiKeyEnv: 'PI_TEST_KEY',
        baseURL: primaryURL,
        models: [{
          id: 'deepseek-v4.1-flash',
          peak: [{
            from: '21:00',
            to: '03:00',
            timeZone: 'Asia/Tokyo',
            providers: [candidate],
          }],
        }],
      },
      'opencode-go': { apiKeyEnv: 'PI_ALT_KEY', baseURL: alternateURL },
    }
  }

  it('authenticates a configured candidate with that route credential', async () => {
    const primary = await mockServer([{ events: textEvents }])
    const alternate = await mockServer([{ events: textEvents }])
    const refs: string[] = []
    const pi = new PiAiAdapter({
      profiles: () => resolveProfiles(credentialRoutes(primary.url, alternate.url, { provider: 'opencode-go' })),
      resolveApiKey: (_provider, ref) => {
        if (ref !== undefined) refs.push(ref)
        return Promise.resolve('test-key')
      },
      auth: memoryAuth(),
      now: () => Date.UTC(2026, 0, 1, 12, 0), // 21:00 JST
    })
    await drain(pi, 'opencode', 'deepseek-v4.1-flash')
    expect(alternate.requests).toHaveLength(1)
    expect(refs).toEqual(['PI_ALT_KEY'])
  })

  it('prefers the window credential reference over the candidate route credential', async () => {
    const primary = await mockServer([{ events: textEvents }])
    const alternate = await mockServer([{ events: textEvents }])
    const refs: string[] = []
    const pi = new PiAiAdapter({
      profiles: () => resolveProfiles(credentialRoutes(primary.url, alternate.url, {
        provider: 'opencode-go',
        apiKeyEnv: 'PI_PEAK_KEY',
      })),
      resolveApiKey: (_provider, ref) => {
        if (ref !== undefined) refs.push(ref)
        return Promise.resolve('test-key')
      },
      auth: memoryAuth(),
      now: () => Date.UTC(2026, 0, 1, 12, 0), // 21:00 JST
    })
    await drain(pi, 'opencode', 'deepseek-v4.1-flash')
    expect(alternate.requests).toHaveLength(1)
    expect(refs).toEqual(['PI_PEAK_KEY'])
  })
})
