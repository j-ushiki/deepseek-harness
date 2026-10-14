import { describe, expect, it, onTestFinished } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import AuthorizationController from '../src/authorization.ts'
import type { AuthorizationEvent, AuthorizationPromptId } from '../src/types.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'

const KEY = credentialKey('test-plugin', 'demo')

/** A mounted controller whose single flow asks one question, then commits a grant. */
async function boot(): Promise<{ ctx: Context; controller: AuthorizationController }> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(MemoryCredentials, {})
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(AuthorizationController)
  ctx.effect(() => ctx.authorization.registerFlow({
    key: KEY,
    label: 'Demo',
    methods: [{ id: 'oauth', label: 'Sign in' }],
    async run(session) {
      session.notify({ message: 'open the page', url: 'https://auth.example/start' })
      const code = await session.prompt({ kind: 'text', message: 'Paste the code' })
      if (code === 'boom') throw new Error('exchange failed')
      await session.commit({ kind: 'grant', payload: { code } })
    },
  }))
  return { ctx, controller: ctx.authorizationController }
}

/** Drain a begin stream, answering each question with `answer`. */
async function drive(
  controller: AuthorizationController,
  key: string,
  answer: string | null,
): Promise<AuthorizationEvent[]> {
  const events: AuthorizationEvent[] = []
  for await (const event of controller.begin(key, undefined, new AbortController().signal)) {
    events.push(event)
    if (event.type === 'prompt') controller.answer(event.prompt.promptId, answer)
  }
  return events
}

describe('AuthorizationController', () => {
  it('lists registered flows', async () => {
    const { controller } = await boot()
    expect(controller.list()).toEqual([
      { key: KEY, label: 'Demo', methods: [{ id: 'oauth', label: 'Sign in' }], inFlight: false },
    ])
  })

  it('streams the notice and question, then settles authorized', async () => {
    const { controller } = await boot()
    const events = await drive(controller, KEY, '123456')
    expect(events.map(event => event.type)).toEqual(['notice', 'prompt', 'settled'])
    expect(events.at(-1)).toEqual({ type: 'settled', status: 'authorized' })
  })

  it('settles cancelled when the question is declined', async () => {
    const { controller } = await boot()
    const events = await drive(controller, KEY, null)
    expect(events.at(-1)).toEqual({ type: 'settled', status: 'cancelled' })
  })

  it('ends with authorization/failed when the flow throws', async () => {
    const { controller } = await boot()
    const error = await drive(controller, KEY, 'boom').catch((e: unknown) => e)
    expect(remoteErrorOf(error)?.code).toBe('authorization/failed')
  })

  it('withdraws the attempt when the stream closes early', async () => {
    const { ctx, controller } = await boot()
    const stream = controller.begin(KEY, undefined, new AbortController().signal)[Symbol.asyncIterator]()
    onTestFinished(async () => { await stream.return?.() })
    await stream.next()
    await stream.next()
    await stream.return?.()
    expect(ctx.authorization.describe(KEY)?.inFlight).toBe(false)
  })

  it('settles a previously cancelled stream without running the flow', async () => {
    const { ctx, controller } = await boot()
    const signal = AbortSignal.abort()
    const events: AuthorizationEvent[] = []
    for await (const event of controller.begin(KEY, undefined, signal)) events.push(event)
    expect(events).toEqual([{ type: 'settled', status: 'cancelled' }])
    expect(ctx.authorization.describe(KEY)?.inFlight).toBe(false)
  })

  it('withdraws a question without accepting a late answer or reporting a decline', async () => {
    const { ctx, controller } = await boot()
    const prompt = new AbortController()
    const key = credentialKey('test-plugin', 'withdrawn')
    ctx.effect(() => ctx.authorization.registerFlow({
      key, label: 'Withdrawn', methods: [{ id: 'oauth', label: 'Sign in' }],
      async run(session) {
        await session.prompt({ kind: 'text', message: 'Answer', signal: prompt.signal })
      },
    }))
    const stream = controller.begin(key, undefined, new AbortController().signal)[Symbol.asyncIterator]()
    onTestFinished(async () => { await stream.return?.() })
    const question = await stream.next()
    if (question.done === true || question.value.type !== 'prompt') throw new Error('Expected a prompt')
    const { promptId } = question.value.prompt
    prompt.abort()
    expect((await stream.next()).value).toEqual({ type: 'prompt-withdrawn', promptId })
    expect(controller.answer(promptId, 'late')).toBe(false)
    await expect(stream.next()).rejects.toMatchObject({ code: 'authorization/failed' })
    expect(ctx.authorization.describe(key)?.inFlight).toBe(false)
  })

  it('carries secret and selection questions and forgets an answered question before its signal aborts', async () => {
    const { ctx, controller } = await boot()
    const key = credentialKey('test-plugin', 'questions')
    const prompt = new AbortController()
    ctx.effect(() => ctx.authorization.registerFlow({
      key, label: 'Questions', methods: [{ id: 'oauth', label: 'Sign in' }],
      async run(session) {
        const secret = await session.prompt({ kind: 'secret', message: 'Secret', placeholder: 'Code' })
        const choice = await session.prompt({
          kind: 'select', message: 'Account', signal: prompt.signal,
          options: [{ id: 'account', label: 'Account' }],
        })
        await session.commit({ kind: 'grant', payload: { secret, choice } })
      },
    }))
    const events: AuthorizationEvent[] = []
    for await (const event of controller.begin(key, 'oauth', new AbortController().signal)) {
      events.push(event)
      if (event.type !== 'prompt') continue
      expect(controller.answer(event.prompt.promptId, event.prompt.kind === 'select' ? 'account' : 'secret')).toBe(true)
      expect(controller.answer(event.prompt.promptId, 'late')).toBe(false)
      if (event.prompt.kind === 'select') prompt.abort()
    }
    expect(events.map(event => event.type)).toEqual(['prompt', 'prompt', 'settled'])
    expect(events[0]).toMatchObject({ prompt: { kind: 'secret', placeholder: 'Code' } })
    expect(events[1]).toMatchObject({ prompt: { kind: 'select', options: [{ id: 'account', label: 'Account' }] } })
    expect(await ctx.credentials.readRecord(key)).toEqual({ kind: 'grant', payload: { secret: 'secret', choice: 'account' } })
  })

  it('rejects an already withdrawn question without displaying it', async () => {
    const { ctx, controller } = await boot()
    const key = credentialKey('test-plugin', 'already-withdrawn')
    ctx.effect(() => ctx.authorization.registerFlow({
      key, label: 'Withdrawn', methods: [{ id: 'oauth', label: 'Sign in' }],
      async run(session) {
        await session.prompt({ kind: 'text', message: 'Answer', signal: AbortSignal.abort() })
      },
    }))
    const stream = controller.begin(key, undefined, new AbortController().signal)[Symbol.asyncIterator]()
    onTestFinished(async () => { await stream.return?.() })
    expect((await stream.next()).value).toMatchObject({ type: 'prompt-withdrawn' })
    await expect(stream.next()).rejects.toMatchObject({ code: 'authorization/failed' })
  })

  it('hides a literal provider refusal in the Remote diagnostic', async () => {
    const { ctx, controller } = await boot()
    const key = credentialKey('test-plugin', 'literal-refusal')
    ctx.effect(() => ctx.authorization.registerFlow({
      key, label: 'Refusal', methods: [{ id: 'oauth', label: 'Sign in' }],
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- a foreign login library may reject with a literal.
      run: () => Promise.reject('provider refused'),
    }))
    await expect(drive(controller, key, '')).rejects.toMatchObject({ code: 'authorization/failed', message: 'Sign-in failed. Try again or check the Host configuration.' })
  })

  it('keeps a safe missing-flow refusal actionable', async () => {
    const { controller } = await boot()
    await expect(drive(controller, 'test-plugin/missing', '')).rejects.toMatchObject({
      code: 'authorization/failed', message: 'no authorization flow is registered for "test-plugin/missing"',
    })
  })

  it('redacts an authorization failure outside the public refusal set', async () => {
    const { ctx, controller } = await boot()
    const key = credentialKey('test-plugin', 'uncommitted')
    ctx.effect(() => ctx.authorization.registerFlow({
      key, label: 'Uncommitted', methods: [{ id: 'oauth', label: 'Sign in' }],
      run: () => Promise.resolve(),
    }))
    await expect(drive(controller, key, '')).rejects.toMatchObject({
      code: 'authorization/failed', message: 'Sign-in failed. Try again or check the Host configuration.',
    })
  })

  it('rejects a malformed key and reports an unanswered id as stale', async () => {
    const { controller } = await boot()
    const error = await drive(controller, 'no-slash', 'x').catch((e: unknown) => e)
    expect(remoteErrorOf(error)?.code).toBe('gateway/bad-request')
    expect(controller.answer(brandString<AuthorizationPromptId>('missing'), 'x')).toBe(false)
  })

  it('reports an absent authorization service', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(AuthorizationController)
    expect(() => ctx.authorizationController.list()).toThrow(/authorization service is absent/)
  })
})
