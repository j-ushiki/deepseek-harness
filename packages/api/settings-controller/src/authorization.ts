/**
 * Host owner of the `authorization` Remote namespace: the human-guided sign-in
 * flows of `ctx.authorization` as a browser configuration page runs them.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/src/authorization.ts
 */

import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { Context } from '@deepseek-ai/cordis'
import { AuthorizationDeclinedError, AuthorizationError } from '@deepseek-ai/dsh-authorization'
import type { AuthorizationInteraction, AuthorizationService } from '@deepseek-ai/dsh-authorization'
import type { AuthorizationEntry } from '@deepseek-ai/dsh-authorization/types'
import { parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { AuthorizationEvent, AuthorizationPromptId } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `authorization` Remote namespace. */
    authorizationController: AuthorizationController
  }
}

/** One question waiting for the page's answer. */
interface PendingPrompt {
  resolve(value: string): void
  reject(error: Error): void
}

/**
 * Host service backing the generated `ctx.remote.authorization` namespace.
 * An attempt lives exactly as long as its `begin` stream: the page ends it by
 * closing the stream, and notices and questions travel back on that stream.
 */
export class AuthorizationController extends TypertRemoteService {
  private readonly pending = new Map<AuthorizationPromptId, PendingPrompt>()

  /** @param ctx - Host context where the authorization service may be mounted. */
  constructor(ctx: Context) {
    super(ctx, 'authorizationController', { namespace: 'authorization' })
  }

  /**
   * List every registered flow.
   * @returns each flow's key, label, methods, and whether an attempt is running.
   * @throws RemoteError when no authorization service is mounted.
   */
  @Remote
  list(): readonly AuthorizationEntry[] {
    return this.service().list()
  }

  /**
   * Run one attempt and stream what it says to the human. The stream ends with
   * `settled`; a failed attempt ends it with an `authorization/failed` error.
   * @param key - the credential record to authorize, as `<scope>/<id>`.
   * @param method - the flow's method to run; `undefined` runs its first.
   * @param signal - stream lifetime; closing the stream withdraws the attempt.
   * @returns notices, questions, and finally the outcome.
   * @throws RemoteError when the key is malformed or the attempt fails.
   */
  @Remote({ mode: 'stream' })
  async *begin(key: string, method: string | undefined, signal: AbortSignal): AsyncIterable<AuthorizationEvent> {
    const service = this.service()
    const credentialKey = this.parse(key)
    const attemptPrompts = new Set<AuthorizationPromptId>()
    const controller = new AbortController()
    const abort = (): void => { controller.abort() }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    const queue: AuthorizationEvent[] = []
    let wake: (() => void) | undefined
    const attempt: { finished: boolean; failure?: { readonly error: unknown } } = { finished: false }
    const push = (event: AuthorizationEvent): void => { queue.push(event); wake?.() }
    const interaction: AuthorizationInteraction = {
      notify: (notice) => { push({ type: 'notice', notice }) },
      prompt: prompt => new Promise<string>((resolve, reject) => {
        const promptId = brandString<AuthorizationPromptId>(randomUUID())
        attemptPrompts.add(promptId)
        const release = (): void => {
          attemptPrompts.delete(promptId)
          prompt.signal?.removeEventListener('abort', withdraw)
        }
        const withdraw = (): void => {
          this.pending.delete(promptId)
          push({ type: 'prompt-withdrawn', promptId })
          release()
          reject(new AuthorizationError('the authorization prompt was withdrawn', 'WITHDRAWN'))
        }
        this.pending.set(promptId, {
          resolve: (value) => { release(); resolve(value) },
          reject: (error) => { release(); reject(error) },
        })
        prompt.signal?.addEventListener('abort', withdraw, { once: true })
        if (prompt.signal?.aborted === true) { withdraw(); return }
        push({
          type: 'prompt',
          prompt: prompt.kind === 'select'
            ? { promptId, kind: prompt.kind, message: prompt.message, options: prompt.options }
            : {
              promptId,
              kind: prompt.kind,
              message: prompt.message,
              ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
            },
        })
      }),
    }
    const completion = service.begin({
      key: credentialKey,
      ...method === undefined ? {} : { method },
      interaction,
      signal: controller.signal,
    }).then(
      (outcome) => { push({ type: 'settled', status: outcome.status }) },
      (error: unknown) => { attempt.failure = { error } },
    ).finally(() => { attempt.finished = true; wake?.() })
    try {
      while (true) {
        const event = queue.shift()
        if (event !== undefined) { yield event; continue }
        if (attempt.finished) break
        await new Promise<void>((resolve) => { wake = resolve })
      }
      const { failure } = attempt
      if (failure !== undefined) {
        throw new RemoteError(
          'authorization/failed',
          failure.error instanceof Error ? failure.error.message : String(failure.error),
          { key },
          { cause: failure.error },
        )
      }
    } finally {
      signal.removeEventListener('abort', abort)
      controller.abort()
      for (const promptId of attemptPrompts) this.answer(promptId, null)
      await completion
    }
  }

  /**
   * Answer one question a running attempt asked.
   * @param promptId - the `promptId` of a `prompt` event.
   * @param value - the typed text or chosen option id; `null` declines.
   * @returns whether the question was still waiting.
   */
  @Remote
  answer(promptId: AuthorizationPromptId, value: string | null): boolean {
    const waiting = this.pending.get(promptId)
    if (waiting === undefined) return false
    this.pending.delete(promptId)
    if (value === null) waiting.reject(new AuthorizationDeclinedError())
    else waiting.resolve(value)
    return true
  }

  /** Brand a wire key, reporting a malformed one as a bad request. */
  private parse(key: string): ReturnType<typeof parseCredentialKey> {
    try {
      return parseCredentialKey(key)
    } catch (error: unknown) {
      throw new RemoteError('gateway/bad-request', `invalid authorization key "${key}"`, { issues: [] }, { cause: error })
    }
  }

  /** Resolve the optional service or report how to supply it. */
  private service(): AuthorizationService {
    const service = this.ctx.get('authorization')
    if (service === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'authorization service is absent: this deployment does not mount @deepseek-ai/dsh-authorization in its composition',
        {},
      )
    }
    return service
  }
}

export default AuthorizationController
