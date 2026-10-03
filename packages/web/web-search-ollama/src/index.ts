/**
 * Register an Ollama Cloud-backed provider in `ctx.web`. It calls Ollama Cloud's
 * `POST /api/web_search` with a bearer key. The provider contributes to the
 * `ctx.web` registry without owning the service; its endpoint and result count
 * are live Config fields the Web search settings page edits.
 * @module @deepseek-ai/dsh-web-search-ollama
 */

import type { Volatile } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-web'
import {
  OLLAMA_DEFAULT_API_KEY_ENV,
  OLLAMA_DEFAULT_BASE_URL,
  OLLAMA_DEFAULT_MAX_RESULTS,
  OllamaSearchProvider,
} from './provider.ts'
import type { OllamaSearchProviderOptions } from './provider.ts'

export {
  OLLAMA_DEFAULT_API_KEY_ENV,
  OLLAMA_DEFAULT_BASE_URL,
  OLLAMA_DEFAULT_MAX_RESULTS,
  OLLAMA_PROVIDER_ID,
  OllamaSearchProvider,
} from './provider.ts'
export type { OllamaSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-ollama'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Live plugin config (the settings page edits these references in place). */
export interface Config {
  /** Literal Ollama Cloud API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey: Volatile<string | undefined>
  /** Credential reference resolved for each search; defaults to `OLLAMA_CLOUD_API_KEY`. */
  apiKeyEnv: Volatile<string>
  /**
   * Ollama Cloud endpoint base or full endpoint; `/api/web_search` is appended
   * when the value is not already it. Falls back to `$OLLAMA_SEARCH_BASE_URL`.
   */
  baseURL: Volatile<string | undefined>
  /** Default result count when a request carries no `maxResults`. Defaults to 5. */
  maxResults: Volatile<number>
}

export const Config = z.object({
  apiKey: z.string().role('secret').volatile(),
  apiKeyEnv: z.string().role('credential-ref').default(OLLAMA_DEFAULT_API_KEY_ENV).volatile(),
  // Declared here rather than only at the use site: a configuration surface
  // renders the resolved section, so a default the schema does not carry reads
  // there as no value at all.
  baseURL: z.string().volatile(),
  maxResults: z.number().step(1).min(1).default(OLLAMA_DEFAULT_MAX_RESULTS).volatile(),
})

/** Auxiliary-search endpoint override, independent of any conversation adapter endpoint. */
const SEARCH_BASE_URL_ENV = 'OLLAMA_SEARCH_BASE_URL'

/** Settings namespace carrying this provider's endpoint and result count. */
export const WEB_SEARCH_OLLAMA_SETTINGS_NAMESPACE = 'web-search-ollama'

/**
 * Project one resolved section into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
function resolveOptions(
  ctx: Context, config: { [K in keyof Config]: ReturnType<Config[K]['get']> },
): OllamaSearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL
      ?? launchEnvironmentOf(ctx).get(SEARCH_BASE_URL_ENV)?.value
      ?? OLLAMA_DEFAULT_BASE_URL,
    maxResults: config.maxResults,
  }
}

/** Register the Ollama Cloud search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new OllamaSearchProvider(() => resolveOptions(ctx, {
    apiKey: config.apiKey.get(), apiKeyEnv: config.apiKeyEnv.get(), baseURL: config.baseURL.get(), maxResults: config.maxResults.get(),
  })))
}
