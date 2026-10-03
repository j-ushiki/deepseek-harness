import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError, stubConfigForm, type StubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { WebSearchCardController } from '../src/client/web-search-card-controller.ts'

type Section = Record<string, unknown>

/** Make the stub behave like a Host that accepts every write. */
function acceptWrites(host: StubConfigForm<Section>): void {
  const section = (): Section => ({ ...host.scope.getSnapshot().value as Section })
  const layer = (): Section => ({ ...host.scope.getSnapshot().user as Section })
  host.set.mockImplementation((field: string, value: unknown) => {
    host.publish({ value: { ...section(), [field]: value }, user: { ...layer(), [field]: value } })
  })
  host.mutate.mockImplementation((ops: readonly SettingsPathOpView[]) => {
    const value = { ...section() }
    const user = { ...layer() }
    for (const op of ops) {
      const field = op.path[0]!
      if (op.op === 'set') {
        value[field] = op.value
        user[field] = op.value
      } else {
        Reflect.deleteProperty(user, field)
        value[field] = (host.scope.getSnapshot().base as Section | undefined)?.[field]
      }
    }
    host.publish({ value, user })
    return Promise.resolve(true)
  })
  host.unset.mockImplementation((field: string) => {
    const user = Object.fromEntries(Object.entries(layer()).filter(([key]) => key !== field))
    const base = host.scope.getSnapshot().base as Section | undefined
    host.publish({ value: { ...section(), [field]: base?.[field] }, user })
  })
}

/** The credentials domain, answering for whichever reference the page asks about. */
function credentialsApi(configured: boolean) {
  const describe = vi.fn((refs: readonly string[]) => Promise.resolve({
    ok: true as const,
    value: Object.fromEntries(refs.map(ref => [ref, { configured, writable: true }])),
  }))
  const set = vi.fn(() => Promise.resolve({ ok: true as const, value: undefined }))
  return { api: { describe, set }, describe, set }
}

/** A configForms service over per-namespace stubs and a mutable served list. */
function configForms(served: readonly string[], values: Record<string, Section> = {}) {
  const stubs = new Map<string, StubConfigForm<Section>>()
  const mount = (ns: string, value: Section, status: 'ready' | 'loading' = 'ready'): void => {
    const host = stubConfigForm<Section>()
    host.publish({ status, writable: status === 'ready', value, base: {}, user: {} })
    stubs.set(ns, host)
  }
  for (const ns of served) mount(ns, values[ns] ?? {})
  let namespaces = [...served]
  const listeners = new Set<() => void>()
  const service = {
    get: (ns: string) => {
      if (!stubs.has(ns)) mount(ns, {}, 'loading')
      return stubs.get(ns)!.scope
    },
    describe: () => ({
      getSnapshot: () => ({
        status: 'ready' as const,
        view: { namespaces: namespaces.map(ns => ({ ns })), writable: true, hasDocument: true },
        error: null,
      }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      ensure: () => Promise.resolve(),
      acceptView: () => {},
    }),
  }
  const setServed = (next: readonly string[]): void => {
    namespaces = [...next]
    for (const ns of next) if (!stubs.has(ns)) mount(ns, {})
    for (const listener of [...listeners]) listener()
  }
  return { service, stubs, setServed }
}

/** A controller over the served namespaces, with accepting credentials. */
function controllerFor(served: readonly string[], values?: Record<string, Section>) {
  const forms = configForms(served, values)
  const credentials = credentialsApi(true)
  const ctx = { configForms: forms.service, remote: { credentials: credentials.api } } as never
  const controller = new WebSearchCardController(ctx)
  return { controller, forms, credentials, state: () => controller.inject().hooks.webSearchCard.getSnapshot() }
}

const DEEPSEEK = 'web-search-deepseek'
const OLLAMA = 'web-search-ollama'

describe('WebSearchCardController', () => {
  it('reads the credential state for the reference the selected provider names', async () => {
    const bench = controllerFor([DEEPSEEK, OLLAMA], { web: { searchProvider: 'deepseek-official' }, [DEEPSEEK]: { baseURL: 'https://search.test/v1' } })
    await vi.waitFor(() => { expect(bench.credentials.describe).toHaveBeenCalled() })
    await vi.waitFor(() => { expect(bench.state().apiKeyConfigured).toBe(true) })

    expect(bench.state()).toMatchObject({
      baseURL: { text: 'https://search.test/v1', overridden: false },
      endpointPlaceholder: 'https://api.deepseek.com/anthropic/v1/messages',
      apiKey: { text: '', overridden: false },
      selectedProviderId: 'deepseek-official',
      limitField: 'maxUses',
    })
  })

  it('lists only the providers the Host serves and shows the selector for two or more', () => {
    const bench = controllerFor([DEEPSEEK, OLLAMA, 'web'], { web: { searchProvider: 'deepseek-official' } })

    expect(bench.state().providers.map(provider => provider.value)).toEqual(['deepseek-official', 'ollama-cloud'])
    expect(bench.state().showSelector).toBe(true)
  })

  it('hides the selector when only one provider is served', () => {
    const bench = controllerFor([DEEPSEEK, 'web'], { web: { searchProvider: 'deepseek-official' } })

    expect(bench.state().providers.map(provider => provider.value)).toEqual(['deepseek-official'])
    expect(bench.state().showSelector).toBe(false)
  })

  it('writes web.searchProvider immediately when the selector changes', async () => {
    const bench = controllerFor([DEEPSEEK, OLLAMA, 'web'], { web: { searchProvider: 'deepseek-official' } })
    const face = bench.controller.inject()

    face.selectProvider('ollama-cloud')

    expect(bench.forms.stubs.get('web')!.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['searchProvider'], value: 'ollama-cloud' },
    ])

    bench.forms.stubs.get('web')!.publish({ value: { searchProvider: 'ollama-cloud' } })
    expect(bench.state()).toMatchObject({ selectedProviderId: 'ollama-cloud', limitField: 'maxResults' })
    await Promise.resolve()
  })

  it('discards staged edits when the selected provider changes', () => {
    const bench = controllerFor([DEEPSEEK, OLLAMA, 'web'], { web: { searchProvider: 'deepseek-official' } })
    const face = bench.controller.inject()

    face.edit('baseURL', 'https://other.test')
    expect(bench.state().dirty).toBe(true)

    bench.forms.stubs.get('web')!.publish({ value: { searchProvider: 'ollama-cloud' } })

    expect(bench.state().dirty).toBe(false)
  })

  it('follows a newly served provider without remounting the card', () => {
    const bench = controllerFor([DEEPSEEK, 'web'], { web: { searchProvider: 'deepseek-official' } })
    expect(bench.state().showSelector).toBe(false)

    bench.forms.setServed([DEEPSEEK, OLLAMA, 'web'])

    expect(bench.state().providers.map(provider => provider.value)).toEqual(['deepseek-official', 'ollama-cloud'])
    expect(bench.state().showSelector).toBe(true)
  })

  it('writes the staged key through the credentials domain, never the settings section', async () => {
    const bench = controllerFor([DEEPSEEK, 'web'])
    bench.credentials.describe.mockImplementation((refs: readonly string[]) => Promise.resolve({
      ok: true as const,
      value: Object.fromEntries(refs.map(ref => [ref, { configured: false, writable: true }])),
    }))
    bench.forms.stubs.get(DEEPSEEK)!.publish({ value: {}, user: {} })
    const face = bench.controller.inject()

    face.edit('apiKey', ' ds-secret ')
    expect(bench.state().dirty).toBe(true)
    expect(bench.credentials.set).not.toHaveBeenCalled()

    bench.credentials.describe.mockImplementation((refs: readonly string[]) => Promise.resolve({
      ok: true as const,
      value: Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true }])),
    }))
    face.save()
    await vi.waitFor(() => { expect(bench.credentials.set).toHaveBeenCalled() })

    expect(bench.credentials.set).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'ds-secret')
    expect(bench.forms.stubs.get(DEEPSEEK)!.set).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(bench.state()).toMatchObject({ dirty: false, apiKeyConfigured: true })
    })
  })

  it('keeps the stored key when the draft is left blank', () => {
    const bench = controllerFor([DEEPSEEK, 'web'])
    const face = bench.controller.inject()

    face.edit('apiKey', '   ')

    expect(bench.state().dirty).toBe(false)
    face.save()

    expect(bench.credentials.set).not.toHaveBeenCalled()
  })

  it('re-reads when the Host reports the watched reference changed', async () => {
    const bench = controllerFor([DEEPSEEK, 'web'])
    await vi.waitFor(() => { expect(bench.credentials.describe).toHaveBeenCalled() })
    bench.credentials.describe.mockClear()

    // Another reference is not this card's business.
    bench.controller.refreshCredential('OTHER_KEY')
    expect(bench.credentials.describe).not.toHaveBeenCalled()

    // A key written on another surface reaches this card only through this signal.
    bench.credentials.describe.mockImplementation((refs: readonly string[]) => Promise.resolve({
      ok: true as const,
      value: Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true }])),
    }))
    bench.controller.refreshCredential('DEEPSEEK_API_KEY')

    await vi.waitFor(() => {
      expect(bench.state().apiKeyConfigured).toBe(true)
    })
  })

  it('addresses the reference the selected section declares rather than the default', async () => {
    const bench = controllerFor([DEEPSEEK, 'web'], { [DEEPSEEK]: { apiKeyEnv: 'SEARCH_KEY' } })
    const face = bench.controller.inject()

    face.edit('apiKey', 'ds-secret')
    face.save()
    await vi.waitFor(() => { expect(bench.credentials.set).toHaveBeenCalled() })

    expect(bench.credentials.set).toHaveBeenCalledWith('SEARCH_KEY', 'ds-secret')
  })

  it('reports a key the Host did not store as a failed save', async () => {
    const bench = controllerFor([DEEPSEEK, 'web'])
    bench.credentials.describe.mockImplementation((refs: readonly string[]) => Promise.resolve({
      ok: true as const,
      value: Object.fromEntries(refs.map(ref => [ref, { configured: false, writable: true }])),
    }))
    bench.forms.stubs.get(DEEPSEEK)!.publish({ value: {}, user: {} })
    const face = bench.controller.inject()

    face.edit('apiKey', 'ds-secret')
    face.save()

    await vi.waitFor(() => {
      expect(bench.state()).toMatchObject({ failed: true, dirty: true })
    })
  })

  it('keeps the card usable when the credential read is refused', async () => {
    const forms = configForms([DEEPSEEK, 'web'])
    const refusal = () => Promise.resolve({
      ok: false as const,
      error: new RemoteError('credential/rejected', 'offline', { ref: 'DEEPSEEK_API_KEY' }),
    })
    const describe = vi.fn(refusal)
    const set = vi.fn(refusal)
    const ctx = { configForms: forms.service, remote: { credentials: { describe, set } } } as never
    const controller = new WebSearchCardController(ctx)
    const face = controller.inject()
    await vi.waitFor(() => { expect(describe).toHaveBeenCalled() })

    forms.stubs.get(DEEPSEEK)!.publish({ value: { baseURL: 'https://search.test/v1' }, user: {} })
    face.edit('apiKey', 'ds-secret')
    face.save()
    await vi.waitFor(() => { expect(set).toHaveBeenCalled() })

    expect(face.hooks.webSearchCard.getSnapshot()).toMatchObject({
      available: true,
      apiKeyConfigured: false,
      baseURL: { text: 'https://search.test/v1' },
    })
  })

  it('ignores a credential read the Host refused', async () => {
    const forms = configForms([DEEPSEEK, 'web'])
    const describe = vi.fn(() => Promise.resolve({
      ok: false as const,
      error: new RemoteError('gateway/internal', 'no credential provider', {}),
    }))
    const ctx = { configForms: forms.service, remote: { credentials: { describe, set: vi.fn() } } } as never
    const controller = new WebSearchCardController(ctx)
    await vi.waitFor(() => { expect(describe).toHaveBeenCalled() })

    expect(controller.inject().hooks.webSearchCard.getSnapshot().apiKeyConfigured).toBe(false)
  })

  it('saves the endpoint and the search budget together', async () => {
    const bench = controllerFor([DEEPSEEK, 'web'])
    acceptWrites(bench.forms.stubs.get(DEEPSEEK)!)
    bench.forms.stubs.get(DEEPSEEK)!.publish({ value: {}, base: {}, user: {} })
    const face = bench.controller.inject()

    face.edit('baseURL', 'https://other.test')
    face.edit('maxUses', '3')
    face.save()
    await vi.waitFor(() => { expect(bench.forms.stubs.get(DEEPSEEK)!.mutate).toHaveBeenCalledTimes(1) })

    expect(bench.forms.stubs.get(DEEPSEEK)!.mutate.mock.calls.map(([ops]) => ops)).toEqual([
      [{ op: 'set', path: ['baseURL'], value: 'https://other.test' }, { op: 'set', path: ['maxUses'], value: 3 }],
    ])
    expect(bench.credentials.set).not.toHaveBeenCalled()
  })
})
