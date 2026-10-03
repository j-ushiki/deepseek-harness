/**
 * `OllamaSearchProvider`: a `WebSearchProvider` backed by Ollama Cloud's
 * `POST /api/web_search`. It maps `results[]` to citeable sources, uses an
 * entry's trimmed `content` as `snippet`, drops entries without a URL, and
 * omits `content` because Ollama Cloud's search response carries no generated answer.
 * @module @deepseek-ai/dsh-web-search-ollama/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { OllamaError, OllamaResult, OllamaSearchResponse } from './types.ts'

/** Stable id this provider registers under. */
export const OLLAMA_PROVIDER_ID = 'ollama-cloud'

/** Default Ollama Cloud API base; `/api/web_search` is the operation. */
export const OLLAMA_DEFAULT_BASE_URL = 'https://ollama.com'

/** Default number of results requested per search. */
export const OLLAMA_DEFAULT_MAX_RESULTS = 5

/** Default credential reference resolved for each search. */
export const OLLAMA_DEFAULT_API_KEY_ENV = 'OLLAMA_CLOUD_API_KEY'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options, captured once at each operation's entry. */
export interface OllamaSearchProviderOptions {
  /** Literal Ollama Cloud API key; when present it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolve the current Ollama Cloud API key for one search operation. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv?: CredentialRef
  /** Endpoint base or the full `/api/web_search` endpoint. */
  baseURL: string
  /** Default result count when a request carries no `maxResults`. */
  maxResults: number
}

/**
 * Map one Ollama Cloud result to a normalized source, or `undefined` when it carries
 * no URL (the seam cannot cite an entry without one).
 *
 * @param result - one entry of Ollama Cloud's `results[]`.
 * @returns the normalized source, or `undefined` for an empty URL.
 */
export function mapOllamaResult(result: OllamaResult): WebSearchSource | undefined {
  if (result.url.length === 0) return undefined
  const snippet = result.content?.trim()
  return {
    url: result.url,
    ...result.title != null && result.title.length > 0 ? { title: result.title } : {},
    ...snippet !== undefined && snippet.length > 0 ? { snippet } : {},
  }
}

/**
 * Map an Ollama Cloud response envelope to a normalized search result.
 *
 * @param response - the parsed `POST /api/web_search` response body.
 * @returns the normalized result; URL-less entries are dropped
 *   ({@link mapOllamaResult}).
 */
export function mapOllamaResponse(response: OllamaSearchResponse): WebSearchResult {
  const sources = (response.results ?? [])
    .map(mapOllamaResult)
    .filter((source): source is WebSearchSource => source !== undefined)
  // Ollama Cloud returns no generated answer, so `content` is omitted. The web service owns the
  // final `maxResults` truncation, so this provider reports `truncated: false`.
  return { sources, truncated: false }
}

/** The Ollama Cloud-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class OllamaSearchProvider implements WebSearchProvider {
  readonly id = OLLAMA_PROVIDER_ID

  /**
   * @param resolveOptions - the options for the NEXT operation, snapshotted
   * once at each operation's entry so one search never mixes two sections. A
   * thunk rather than a value because the plugin's settings section can change
   * between searches.
   */
  constructor(private readonly resolveOptions: () => OllamaSearchProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && URL.canParse(options.baseURL)
      && isPositiveInteger(options.maxResults)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // One snapshot for the whole operation: credential resolution awaits, and a
    // settings write landing inside that await must not send the key resolved
    // from the old section to the endpoint named by the new one.
    const options = this.resolveOptions()
    const endpoint = options.baseURL.endsWith('/api/web_search') ? options.baseURL : `${options.baseURL}/api/web_search`
    const apiKey = await this.apiKey(options, signal)
    throwIfSearchAborted(signal)
    // A per-request bound wins over the configured default; either may be absent.
    const maxResults = request.maxResults ?? options.maxResults
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({ query: request.query, max_results: maxResults }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw searchEndpointError(
        endpoint,
        `Ollama Cloud search request failed: ${String(error)}`,
        error,
      )
    }

    if (!response.ok) {
      const status = response.status
      let message = `Ollama Cloud API error (HTTP ${status})`
      try {
        const parsed = await response.json() as OllamaError
        const detail = parsed.error ?? parsed.message
        if (detail !== undefined && detail.length > 0) message += `: ${detail}`
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
        // cost a richer provider message, never the real error.
      }
      throw searchEndpointError(endpoint, message)
    }

    try {
      const payload = await response.json() as OllamaSearchResponse
      return mapOllamaResponse(payload)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw searchEndpointError(endpoint, `Ollama Cloud returned an unprocessable response body: ${String(error)}`, error)
    }
  }

  /**
   * Resolve one operation's API key without retaining it on the provider.
   * @param options - the caller's snapshot, so the key and the endpoint it is sent to come from one section.
   * @param signal - abort signal for the surrounding search.
   * @returns the resolved key.
   */
  private async apiKey(options: OllamaSearchProviderOptions, signal?: AbortSignal): Promise<string> {
    throwIfSearchAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    const { resolveApiKey } = options
    const resolved = resolveApiKey === undefined ? undefined : await resolveCredential(resolveApiKey, signal)
    if (resolved !== undefined && resolved.length > 0) return resolved
    const ref = options.apiKeyEnv ?? OLLAMA_DEFAULT_API_KEY_ENV
    throw new WebError(
      `Ollama Cloud search has no API key for "${ref}"; store it through the credentials service`
      + ' (the web Models page writes it), export it in the launching environment, or set a literal'
      + ' "apiKey" in the web-search-ollama config',
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}

/**
 * Run one credential resolver under the search's cancellation signal. An
 * already-cancelled search never starts the resolver.
 * @param resolve - the resolver; a synchronous throw is mapped like a rejection.
 * @param signal - abort signal for the surrounding search.
 * @returns the resolved credential, or undefined when the resolver supplied none.
 * @throws {@link WebError} `WEB_ABORTED` on cancellation, `WEB_PROVIDER_ERROR` when the resolver fails.
 */
async function resolveCredential(
  resolve: () => Promise<string | undefined>, signal?: AbortSignal,
): Promise<string | undefined> {
  throwIfSearchAborted(signal)
  try {
    return await abortable(resolve(), signal)
  } catch (error: unknown) {
    if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
    throw new WebError(
      `Ollama Cloud search credential resolution failed: ${String(error)}`,
      'WEB_PROVIDER_ERROR',
      { cause: error },
    )
  }
}

/** Add endpoint recovery instructions to failures that occur after request dispatch begins. */
function searchEndpointError(endpoint: string, message: string, cause?: unknown): WebError {
  return new WebError(
    `${message}\n\nThe web search request used endpoint ${JSON.stringify(endpoint)}. `
    + 'Search endpoint configuration is separate from chat. If that endpoint is not intended, '
    + 'guide the user to Settings > Plugins > Plugin configuration > Web search, where they can '
    + 'change and save Endpoint. If that settings page is unavailable, the user can set '
    + 'OLLAMA_SEARCH_BASE_URL or configure web-search-ollama.baseURL to a trusted Ollama Cloud base. '
    + 'Only the user should choose or change the endpoint.',
    'WEB_PROVIDER_ERROR',
    cause === undefined ? undefined : { cause },
  )
}

/**
 * Race a same-process asynchronous preflight against caller cancellation. The
 * attached settlement handlers keep observing an uncooperative operation after
 * abort so a later rejection cannot become unhandled.
 */
function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(searchAborted(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(searchAborted(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(new Error(String(error).replace(/^Error: /u, ''), { cause: error }))
      },
    )
  })
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('Ollama Cloud search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** True for a result count that can be sent to Ollama Cloud (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}
