/**
 * Browser-safe failure vocabulary of the configuration surfaces this package
 * serves. The redacted views themselves live with their seam in
 * `@deepseek-ai/dsh-settings/types`, whose Cordis event declarations already
 * register that file for the Client compilation face.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type {
  AuthorizationNotice, AuthorizationPromptOption, AuthorizationStatus,
} from '@deepseek-ai/dsh-authorization/types'

export type { AuthorizationEntry } from '@deepseek-ai/dsh-authorization/types'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** One authorization attempt failed, was refused up front, or has no registered flow. */
    'authorization/failed': { readonly key: string }
    /**
     * Every seam refusal that is not a stale write: an unregistered or malformed
     * namespace, a read-only provider, schema validation, storage.
     */
    'settings/rejected': { readonly ns: string }
    /**
     * The stored revision moved after the caller read it. Its own outcome rather
     * than an invalid request: the caller must re-read and re-apply.
     */
    'settings/conflict': { readonly ns: string; readonly expected: number; readonly actual: number }
    /**
     * The provider refused a valid credential write, for example because the
     * stored document no longer parses. The details name only the reference,
     * never the value.
     */
    'credential/rejected': { readonly ref: string }
  }
}

/** Confirmation that the settings document was handed to the native editor. */
export interface SettingsDocumentOpenValue {
  readonly opened: true
}

/** An id assigned to one pending browser authorization question. */
export type AuthorizationPromptId = Branded<'authorization-prompt-id'>

/** One question a running authorization flow put to the human, addressable by `promptId`. */
export type AuthorizationPromptView = {
  readonly promptId: AuthorizationPromptId
  readonly message: string
} & ({
  readonly kind: 'text' | 'secret'
  readonly placeholder?: string
} | {
  readonly kind: 'select'
  readonly options: readonly AuthorizationPromptOption[]
})

/**
 * Progress from `authorization.begin`; `settled` ends successful or cancelled
 * attempts, while failures reject the stream.
 */
export type AuthorizationEvent =
  | { readonly type: 'notice'; readonly notice: AuthorizationNotice }
  | { readonly type: 'prompt'; readonly prompt: AuthorizationPromptView }
  | { readonly type: 'prompt-withdrawn'; readonly promptId: AuthorizationPromptId }
  | { readonly type: 'settled'; readonly status: AuthorizationStatus }
