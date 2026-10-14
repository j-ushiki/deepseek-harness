/** Sign-in operations retain Host outcomes and release the Remote stream on every exit. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { streamHandle } from '@deepseek-ai/dsh-remote-mock'
import type { AuthorizationEntry, AuthorizationEvent, AuthorizationPromptId } from '@deepseek-ai/dsh-api-remotes/client'
import { createModelsOperations } from '../src/client/operations.ts'

const FLOW: AuthorizationEntry = {
  key: 'llm-pi-ai/openai-codex' as AuthorizationEntry['key'], label: 'Codex',
  methods: [{ id: 'oauth', label: 'Sign in' }], inFlight: false,
}

it('finds registered flows and leaves unavailable providers without a sign-in action', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const list = vi.fn<Context['remote']['authorization']['list']>(() => Promise.resolve({ ok: true as const, value: [FLOW] }))
  new TestRemote(ctx, { authorization: { list } })
  const operations = createModelsOperations(ctx)
  expect(await operations.describeSignIn(FLOW.key)).toEqual(FLOW)
  expect(await operations.describeSignIn('llm-pi-ai/openai')).toBeUndefined()
  list.mockImplementationOnce(() => Promise.resolve({ ok: false as const, error: new RemoteError('gateway/internal', 'Unavailable', {}) }))
  expect(await operations.describeSignIn(FLOW.key)).toBeUndefined()
})

it.each(['authorized', 'cancelled'] as const)('forwards progress and returns the Host %s outcome', async (status) => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const event: AuthorizationEvent = { type: 'notice', notice: { message: 'Continue in your browser' } }
  const stream = streamHandle((async function* () { yield event; yield { type: 'settled' as const, status } })())
  const dispose = vi.spyOn(stream, 'dispose')
  new TestRemote(ctx, { authorization: { begin: () => stream } })
  const progress = vi.fn()
  expect(await createModelsOperations(ctx).signIn(FLOW.key, progress, new AbortController().signal)).toEqual({ kind: status })
  expect(progress).toHaveBeenCalledExactlyOnceWith(event)
  expect(dispose).toHaveBeenCalledOnce()
})

it.each([
  { failure: new Error('Host refused'), aborted: false, outcome: { kind: 'failed', message: 'Host refused' } },
  { failure: 'transport closed', aborted: false, outcome: { kind: 'failed', message: 'transport closed' } },
  { failure: new Error('cancelled'), aborted: true, outcome: { kind: 'cancelled' } },
])('releases a failed stream and reports $outcome.kind', async ({ failure, aborted, outcome }) => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const stream = streamHandle((async function* (): AsyncIterable<AuthorizationEvent> { throw failure })())
  const dispose = vi.spyOn(stream, 'dispose')
  new TestRemote(ctx, { authorization: { begin: () => stream } })
  const signal = aborted ? AbortSignal.abort() : new AbortController().signal
  expect(await createModelsOperations(ctx).signIn(FLOW.key, vi.fn(), signal)).toEqual(outcome)
  expect(dispose).toHaveBeenCalledOnce()
})

it('treats an ended stream as cancelled and forwards declined answers', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const stream = streamHandle((async function* (): AsyncIterable<AuthorizationEvent> {})())
  const answer = vi.fn(() => Promise.resolve({ ok: true as const, value: true }))
  new TestRemote(ctx, { authorization: { begin: () => stream, answer } })
  const operations = createModelsOperations(ctx)
  expect(await operations.signIn(FLOW.key, vi.fn(), new AbortController().signal)).toEqual({ kind: 'cancelled' })
  await operations.answerSignIn('question' as AuthorizationPromptId, null)
  expect(answer).toHaveBeenCalledExactlyOnceWith('question', null)
})
