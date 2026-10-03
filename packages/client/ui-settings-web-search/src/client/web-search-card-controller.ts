/**
 * The web-search page's staged form over the selected provider's settings
 * namespace, plus the selector that writes `web.searchProvider`.
 *
 * The page serves whichever search providers this deployment composed: the
 * selector lists only the namespaces the Host currently describes, and the
 * form below it binds to the selected provider's namespace. The selected id
 * is not staged — choosing a provider is the choice itself, so it is written
 * immediately — while the provider's own fields keep the page's usual
 * stage-then-save behavior.
 *
 * The key is the one control that does not live in any section: its literal
 * never rides a response, so the page learns only whether one is configured
 * and writes it through the credentials domain, addressed by the reference the
 * selected provider's section names.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.configForms Context merge and the ConfigForm face.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsNumberField, settingsTextField,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SettingsFieldState, SettingsFormActions, SettingsFormPathOp,
  SettingsFormShell, SettingsFormScope, SettingsFormScopeSnapshot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WebSearchSettingsLocaleKey } from './locales.ts'

/** Settings namespace the selector writes `searchProvider` into. */
export const WEB_NAMESPACE = 'web'

/** Settings namespace of the DeepSeek search provider, the page's original owner. */
export const WEB_SEARCH_NS = 'web-search-deepseek'

/** Credential reference the page falls back to when no provider is selected. */
const DEFAULT_API_KEY_REF = 'DEEPSEEK_API_KEY'

/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey'

/** One selectable search provider this page can configure. */
interface SearchProviderView {
  /** Value written to `web.searchProvider`. */
  readonly id: string
  /** Settings namespace (the Loader row id) this provider registers. */
  readonly ns: string
  /** Localized provider name for the selector. */
  readonly labelKey: WebSearchSettingsLocaleKey
  /** Section field holding the provider's per-request bound. */
  readonly limitField: string
  /** Localized label of the bound field. */
  readonly limitLabelKey: WebSearchSettingsLocaleKey
  /** Localized hint of the bound field. */
  readonly limitHintKey: WebSearchSettingsLocaleKey
  /** Credential reference the provider resolves when its section names none. */
  readonly keyRef: string
  /** Endpoint the provider uses when its section names none, shown as the field's placeholder. */
  readonly defaultEndpoint: string
}

/**
 * Selectable providers, in display order. Spelled here rather than imported:
 * a client package must not depend on a Host package, so the namespace, bound
 * field, and credential reference of each provider are duplicated from its
 * Host declaration.
 */
const SEARCH_PROVIDERS: readonly SearchProviderView[] = [
  {
    id: 'deepseek-official', ns: 'web-search-deepseek', labelKey: 'providerDeepseek',
    limitField: 'maxUses', limitLabelKey: 'maxUses', limitHintKey: 'maxUsesHint', keyRef: 'DEEPSEEK_API_KEY',
    defaultEndpoint: 'https://api.deepseek.com/anthropic/v1/messages',
  },
  {
    id: 'ollama-cloud', ns: 'web-search-ollama', labelKey: 'providerOllamaCloud',
    limitField: 'maxResults', limitLabelKey: 'maxResults', limitHintKey: 'maxResultsHint', keyRef: 'OLLAMA_CLOUD_API_KEY',
    defaultEndpoint: 'https://ollama.com/api/web_search',
  },
  {
    id: 'exa', ns: 'web-search-exa', labelKey: 'providerExa',
    limitField: 'numResults', limitLabelKey: 'maxResults', limitHintKey: 'maxResultsHint', keyRef: 'EXA_API_KEY',
    defaultEndpoint: 'https://api.exa.ai/search',
  },
  {
    id: 'perplexity', ns: 'web-search-perplexity', labelKey: 'providerPerplexity',
    limitField: 'maxTokens', limitLabelKey: 'maxTokens', limitHintKey: 'maxTokensHint', keyRef: 'PERPLEXITY_API_KEY',
    defaultEndpoint: 'https://api.perplexity.ai/chat/completions',
  },
]

/**
 * The provider namespaces whose presence registers this page. A deployment
 * that composes no search provider shows no trace of the card.
 */
export const SEARCH_PROVIDER_NAMESPACES: readonly string[] = SEARCH_PROVIDERS.map(provider => provider.ns)

/** The selected provider's fields this page edits. */
export interface WebSearchSettings {
  /** Credential reference naming the environment key. */
  apiKeyEnv?: string
  /** Provider endpoint; blank inherits the provider default. */
  baseURL?: string
  /** DeepSeek's maximum searches served within one request. */
  maxUses?: number
  /** Ollama's and Perplexity's default result count. */
  maxResults?: number
  /** Exa's default result count. */
  numResults?: number
  /** Perplexity's upper bound on generated answer tokens. */
  maxTokens?: number
}

/** The `web` section's selection field. */
export interface WebProviderSelection {
  /** Pinned search provider id. */
  searchProvider?: string
}

/** One selector option as the view renders it. */
export interface WebSearchProviderOption {
  /** Value written to `web.searchProvider`. */
  readonly value: string
  /** Localized provider name. */
  readonly labelKey: WebSearchSettingsLocaleKey
}

/** What the credentials domain last reported, and for which reference. */
interface CredentialState {
  /** Reference this answer describes; a stale response for another one is dropped. */
  ref: string
  /** Whether any layer supplies a value for it. */
  configured: boolean
  /** Whether `credentials/set` can affect it; false disables the control. */
  writable: boolean
}

/** What the web-search page renders. */
export interface WebSearchCardState extends SettingsFormShell {
  /** Provider endpoint. */
  baseURL: SettingsFieldState
  /** Endpoint the selected provider uses when its section names none, shown faintly while the field is empty. */
  endpointPlaceholder: string
  /** Section field the active provider's bound is stored under. */
  limitField: string
  /** The active provider's per-request bound. */
  limit: SettingsFieldState
  /** Localized label of the bound field. */
  limitLabelKey: WebSearchSettingsLocaleKey
  /** Localized hint of the bound field. */
  limitHintKey: WebSearchSettingsLocaleKey
  /** The staged credential, which starts blank on every load. */
  apiKey: SettingsFieldState
  /** Whether the Host reports a credential configured for the referenced key. */
  apiKeyConfigured: boolean
  /** Whether the credentials domain accepts a write for it; false disables the control. */
  apiKeyWritable: boolean
  /** Providers this deployment serves, in display order. */
  providers: readonly WebSearchProviderOption[]
  /** Whether two or more providers are served, so a selector is meaningful. */
  showSelector: boolean
  /** Selected provider id; empty string when none is served. */
  selectedProviderId: string
  /** Whether `web.searchProvider` accepts writes. */
  selectorWritable: boolean
}

/** The registration-side face the web-search page's slot entry injects. */
export interface WebSearchCardFace extends SettingsFormActions {
  hooks: {
    /** Page snapshot bound by the renderer as useWebSearchCard. */
    webSearchCard: SnapshotStore<WebSearchCardState>
  }
  /** Write `web.searchProvider`; the choice is not staged. */
  selectProvider: (value: string) => void
}

/**
 * A form scope that follows the selected provider's namespace. The staged form
 * model binds to this wrapper once and never sees the switch; the controller
 * clears its staged edits before pointing it at another section.
 */
class SwitchableScope<T> implements SettingsFormScope<T> {
  private current: SettingsFormScope<T>
  private detach: () => void
  private readonly listeners = new Set<() => void>()

  /**
   * @param scope - the initial namespace's shared form.
   */
  constructor(scope: SettingsFormScope<T>) {
    this.current = scope
    this.detach = scope.subscribe(() => { this.emit() })
  }

  getSnapshot(): SettingsFormScopeSnapshot<T> {
    return this.current.getSnapshot()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  mutate(ops: readonly SettingsFormPathOp[], expectedRevision?: number): Promise<boolean> {
    return this.current.mutate(ops, expectedRevision)
  }

  /**
   * Point the scope at another namespace's form.
   * @param scope - the shared form of the newly selected provider.
   */
  switchTo(scope: SettingsFormScope<T>): void {
    this.detach()
    this.current = scope
    this.detach = scope.subscribe(() => { this.emit() })
    this.emit()
  }

  /** Release the subscription to the section currently in force. */
  dispose(): void {
    this.detach()
    this.listeners.clear()
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

/** Bridges the selected providers' scopes and the credentials domain onto the page. */
export class WebSearchCardController {
  private readonly providerScope: SwitchableScope<WebSearchSettings>
  private readonly form: SettingsFormModel<WebSearchSettings>
  private readonly store: SnapshotStore<WebSearchCardState>
  private readonly webForm: SettingsFormScope<WebProviderSelection>
  private readonly unsubscribeDescribe: () => void
  private readonly unsubscribeSelection: () => void
  private readonly unsubscribeSection: () => void
  private credential: CredentialState = { ref: '', configured: false, writable: true }
  private served: readonly SearchProviderView[] = []
  private selectedNs: string | undefined

  /**
   * @param ctx - the page plugin's context: `configForms` supplies every
   * namespace's shared form and the describe mirror, and `remote.credentials`
   * answers for the reference the selected provider's section names.
   */
  constructor(private readonly ctx: ClientContext) {
    this.providerScope = new SwitchableScope(
      this.ctx.configForms.get<WebSearchSettings>(WEB_SEARCH_NS),
    )
    this.webForm = this.ctx.configForms.get<WebProviderSelection>(WEB_NAMESPACE)
    this.form = new SettingsFormModel(
      this.providerScope,
      [
        settingsTextField('baseURL'),
        settingsNumberField('maxUses'),
        settingsNumberField('maxResults'),
        settingsNumberField('numResults'),
        settingsNumberField('maxTokens'),
      ],
      [{ field: API_KEY_FIELD, write: text => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    this.unsubscribeSection = this.providerScope.subscribe(() => { void this.readCredential() })
    this.unsubscribeDescribe = this.ctx.configForms.describe().subscribe(() => { this.sync() })
    this.unsubscribeSelection = this.webForm.subscribe(() => { this.sync() })
    this.sync()
    void this.readCredential()
  }

  private projection(): WebSearchCardState {
    const provider = this.activeProvider()
    const limitField = provider?.limitField ?? 'maxResults'
    return {
      ...this.form.shell(),
      baseURL: this.form.field('baseURL'),
      endpointPlaceholder: provider?.defaultEndpoint ?? '',
      limitField,
      limit: this.form.field(limitField),
      limitLabelKey: provider?.limitLabelKey ?? 'maxResults',
      limitHintKey: provider?.limitHintKey ?? 'maxResultsHint',
      apiKey: this.form.field(API_KEY_FIELD),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
      providers: this.served.map(entry => ({ value: entry.id, labelKey: entry.labelKey })),
      showSelector: this.served.length > 1,
      selectedProviderId: provider?.id ?? '',
      selectorWritable: this.webForm.getSnapshot().writable,
    }
  }

  /**
   * Re-derive the served providers and the selected one from the describe
   * mirror and the `web` section. Switching the scope drops staged edits: a
   * draft typed for one provider must never be saved into another's section.
   */
  private sync(): void {
    const namespaces = this.ctx.configForms.describe().getSnapshot().view?.namespaces ?? []
    const servedNamespaces = new Set(namespaces.map(entry => entry.ns))
    this.served = SEARCH_PROVIDERS.filter(provider => servedNamespaces.has(provider.ns))
    const selectedId = this.webForm.getSnapshot().value?.searchProvider
    const selected = this.served.find(provider => provider.id === selectedId) ?? this.served[0]
    if (selected !== undefined && selected.ns !== this.selectedNs) {
      this.selectedNs = selected.ns
      this.form.actions().discard()
      this.providerScope.switchTo(this.ctx.configForms.get<WebSearchSettings>(selected.ns))
    }
    this.store.set(this.projection())
  }

  /** @returns the provider entry the selector chose, if any. */
  private activeProvider(): SearchProviderView | undefined {
    return this.served.find(provider => provider.ns === this.selectedNs)
  }

  /**
   * Write the chosen provider immediately; the choice is not a draft.
   * @param value - the provider id the selector reported.
   */
  selectProvider(value: string): void {
    if (value === this.activeProvider()?.id) return
    void this.webForm.mutate([{ op: 'set', path: ['searchProvider'], value }])
  }

  /**
   * Ask the credentials domain about the reference the selected section names.
   *
   * The answer is stored with the reference it describes: the provider or
   * `apiKeyEnv` can change between the request and its response, and two reads
   * can settle out of order, so a response is published only while it still
   * answers for the reference in force.
   */
  private async readCredential(): Promise<void> {
    const ref = this.activeRef()
    if (ref !== this.credential.ref) {
      // A new reference knows nothing yet; keeping the old answer would claim
      // the key is configured under a name nobody has checked.
      this.credential = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    const response = await this.ctx.remote.credentials.describe([ref])
    if (!response.ok || ref !== this.activeRef()) return
    const view = response.value[ref]
    const next: CredentialState = {
      ref,
      configured: view?.configured ?? false,
      // An unknown reference is treated as writable: the control stays usable
      // and the Host is what refuses, rather than the page guessing a refusal.
      writable: view?.writable ?? true,
    }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.store.set(this.projection())
  }

  /**
   * Re-read after the Host reports a change to the reference this page watches.
   *
   * A key can be written from somewhere else — the Models page addresses the
   * same reference — and the settings section does not change when it is, so
   * without this the badge keeps reporting a state the Host already replaced.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    if (ref !== this.activeRef()) return
    void this.readCredential()
  }

  /**
   * Build the face the page's slot registration injects.
   * @returns the page's snapshot, its form actions, and the provider selector.
   */
  inject(): WebSearchCardFace {
    return {
      hooks: { webSearchCard: this.store },
      ...this.form.actions(),
      selectProvider: (value) => { this.selectProvider(value) },
    }
  }

  /** Release configuration and credential subscriptions. */
  dispose(): void {
    this.unsubscribeDescribe()
    this.unsubscribeSelection()
    this.unsubscribeSection()
    this.providerScope.dispose()
    this.form.dispose()
  }

  /**
   * Write the staged key, then re-read whether the Host now holds one.
   * @param value - the staged credential literal.
   * @returns whether the Host reports a configured credential afterwards.
   */
  private async writeKey(value: string): Promise<boolean> {
    // Refusals surface through the re-read below: the Host is the only
    // authority on whether the key now exists.
    await this.ctx.remote.credentials.set(this.activeRef(), value)
    await this.readCredential()
    return this.credential.configured
  }

  /** @returns the credential reference the selected provider's section names, or its default. */
  private activeRef(): string {
    return refOf(this.providerScope.getSnapshot(), this.activeProvider()?.keyRef ?? DEFAULT_API_KEY_REF)
  }
}

/**
 * The credential reference the section names, or the provider's default.
 * @param snapshot - the current scope snapshot.
 * @param keyRef - the selected provider's default reference.
 * @returns the reference to address.
 */
function refOf(snapshot: SettingsFormScopeSnapshot<WebSearchSettings>, keyRef: string): string {
  const declared = snapshot.value?.apiKeyEnv
  return declared !== undefined && declared.length > 0 ? declared : keyRef
}
