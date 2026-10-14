// @vitest-environment jsdom
/** The sign-in control appears only for a registered flow and relays its notice, question, and outcome. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AuthorizationEntry, AuthorizationPromptId } from '@deepseek-ai/dsh-api-remotes/client'
import { ProviderSignIn } from '../src/client/ProviderSignIn.tsx'
import type { ModelsOperations, SignInOutcome, SignInProgressEvent } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const FLOW: AuthorizationEntry = {
  key: 'llm-pi-ai/openai-codex' as AuthorizationEntry['key'], label: 'ChatGPT (Codex)',
  methods: [{ id: 'oauth', label: 'Sign in' }], inFlight: false,
}

function operations(overrides: Partial<ModelsOperations>): ModelsOperations {
  return {
    storeCredential: vi.fn(), removeCredential: vi.fn(),
    writeSettings: vi.fn(), discoverModels: vi.fn(),
    describeSignIn: () => Promise.resolve(FLOW), signIn: vi.fn(), answerSignIn: vi.fn(), ...overrides,
  }
}

it('renders nothing when no flow is registered for the provider', async () => {
  const describeSignIn = vi.fn(() => Promise.resolve(undefined))
  const { container } = render(<ProviderSignIn provider="openai" t={key => en[key]} operations={operations({ describeSignIn })} />)
  await waitFor(() => { expect(describeSignIn).toHaveBeenCalledWith('llm-pi-ai/openai') })
  expect(container.textContent).toBe('')
})

it('shows the notice and question, sends the answer, and reports success', async () => {
  let release: () => void = () => {}
  const answerSignIn = vi.fn(() => { release(); return Promise.resolve() })
  const signIn = vi.fn((_key: string, onEvent: (event: SignInProgressEvent) => void) => new Promise<{ kind: 'authorized' }>((resolve) => {
    release = () => { resolve({ kind: 'authorized' }) }
    onEvent({ type: 'notice', notice: { message: 'open the page', url: 'https://auth.example/start' } })
    onEvent({ type: 'prompt', prompt: { promptId: 'p1' as AuthorizationPromptId, kind: 'text', message: 'Paste the code' } })
  }))
  render(<ProviderSignIn provider="openai-codex" t={key => en[key]} operations={operations({ signIn: signIn, answerSignIn })} />)

  fireEvent.click(await screen.findByRole('button', { name: en.signIn }))
  expect(await screen.findByText('open the page')).toBeTruthy()
  fireEvent.change(await screen.findByLabelText('Paste the code'), { target: { value: '123' } })
  fireEvent.click(screen.getByRole('button', { name: en.signInSubmit }))

  expect(answerSignIn).toHaveBeenCalledWith('p1', '123')
  expect((await screen.findByRole('status')).textContent).toBe(en.signInDone)
})

it('reports a failed attempt with the Host message', async () => {
  const signIn = vi.fn(() => Promise.resolve({ kind: 'failed' as const, message: 'exchange failed' }))
  render(<ProviderSignIn provider="openai-codex" t={key => en[key]} operations={operations({ signIn })} />)
  fireEvent.click(await screen.findByRole('button', { name: en.signIn }))
  expect((await screen.findByRole('alert')).textContent).toBe(`${en.signInFailed}: exchange failed`)
})

it('shows a device code, accepts an account choice, and reports a declined question', async () => {
  let finish: (value: SignInOutcome) => void = () => {}
  const answerSignIn = vi.fn(() => { finish({ kind: 'cancelled' }); return Promise.resolve() })
  const signIn: ModelsOperations['signIn'] = (_key, onEvent) => new Promise((resolve) => {
    finish = resolve
    onEvent({ type: 'notice', notice: { message: 'Enter this code', code: 'TEST-CODE' } })
    onEvent({ type: 'prompt', prompt: {
      promptId: 'choice' as AuthorizationPromptId, kind: 'select', message: 'Choose account',
      options: [{ id: 'personal', label: 'Personal' }],
    } })
  })
  render(<ProviderSignIn provider="openai-codex" t={key => en[key]} operations={operations({ signIn, answerSignIn })} />)
  fireEvent.click(await screen.findByRole('button', { name: en.signIn }))
  expect(await screen.findByText('TEST-CODE')).toBeTruthy()
  fireEvent.change(await screen.findByRole('combobox', { name: 'Choose account' }), { target: { value: 'personal' } })
  expect(screen.getByRole('button', { name: en.signInSubmit }).hasAttribute('disabled')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: en.cancel }))
  expect(answerSignIn).toHaveBeenCalledWith('choice', null)
  expect((await screen.findByRole('status')).textContent).toBe(en.signInCancelled)
})

it('keeps a newer question when a previous one is withdrawn and masks secret answers', async () => {
  let emit: (event: SignInProgressEvent) => void = () => {}
  const signIn: ModelsOperations['signIn'] = (_key, onEvent, signal) => new Promise((resolve) => {
    emit = onEvent
    signal.addEventListener('abort', () => { resolve({ kind: 'cancelled' }) }, { once: true })
    onEvent({ type: 'prompt', prompt: { promptId: 'old' as AuthorizationPromptId, kind: 'text', message: 'Old code' } })
  })
  render(<ProviderSignIn provider="openai-codex" t={key => en[key]} operations={operations({ signIn })} />)
  fireEvent.click(await screen.findByRole('button', { name: en.signIn }))
  await screen.findByLabelText('Old code')
  act(() => {
    emit({ type: 'prompt', prompt: { promptId: 'new' as AuthorizationPromptId, kind: 'secret', message: 'New code', placeholder: 'Secret' } })
    emit({ type: 'prompt-withdrawn', promptId: 'old' as AuthorizationPromptId })
  })
  expect(screen.getByLabelText('New code').getAttribute('type')).toBe('password')
  expect(screen.getByLabelText('New code').getAttribute('placeholder')).toBe('Secret')
  act(() => { emit({ type: 'prompt-withdrawn', promptId: 'new' as AuthorizationPromptId }) })
  expect(screen.queryByLabelText('New code')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.signInCancel }))
  expect((await screen.findByRole('status')).textContent).toBe(en.signInCancelled)
})

it('withdraws an active attempt on unmount and ignores its late completion', async () => {
  let finish: (value: SignInOutcome) => void = () => {}
  let signal: AbortSignal | undefined
  const done = new Promise<SignInOutcome>((resolve) => { finish = resolve })
  const signIn: ModelsOperations['signIn'] = (_key, _onEvent, attempt) => { signal = attempt; return done }
  const { unmount } = render(<ProviderSignIn provider="openai-codex" t={key => en[key]} operations={operations({ signIn })} />)
  fireEvent.click(await screen.findByRole('button', { name: en.signIn }))
  unmount()
  expect(signal?.aborted).toBe(true)
  await act(async () => { finish({ kind: 'authorized' }); await done })
  expect(screen.queryByRole('status')).toBeNull()
})

it('ignores a flow description that arrives after unmount', async () => {
  let finish: (value: AuthorizationEntry) => void = () => {}
  const done = new Promise<AuthorizationEntry>((resolve) => { finish = resolve })
  const { unmount } = render(<ProviderSignIn provider="openai-codex" t={key => en[key]} operations={operations({ describeSignIn: () => done })} />)
  unmount()
  await act(async () => { finish(FLOW); await done })
  expect(screen.queryByRole('button')).toBeNull()
})
