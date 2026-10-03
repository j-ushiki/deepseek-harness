// @vitest-environment jsdom
/** The model row's peak-routing control: destination, window, and clearing. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelListEditor } from '../src/client/ModelListEditor.tsx'
import { routingDraftOf } from '../src/client/ModelRow.tsx'
import type { ModelsOperations } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const operations: ModelsOperations = {
  discoverModels: vi.fn(),
  storeCredential: vi.fn(),
  removeCredential: vi.fn(),
  writeSettings: vi.fn(),
}

const providers = [
  { id: 'opencode-go', name: 'OpenCode Go', models: ['deepseek-v4.1-flash'] },
  { id: 'opencode', name: 'OpenCode Zen', models: ['deepseek-v4.1-flash'] },
  { id: 'ollama-cloud', name: 'Ollama Cloud', models: ['deepseek-v4.1-flash'] },
]

/** Render one pi-ai model list and expand one row. */
function editor(
  models: Record<string, unknown>[],
  onChange: (next: Record<string, unknown>[]) => void,
  provider = 'ollama-cloud',
  row = 1,
): void {
  render(<ModelListEditor
    models={models}
    onChange={onChange}
    routingProviders={providers}
    probe={{ settingsNs: 'llm-pi-ai', provider }}
    disabled={false}
    t={key => en[key]}
    onBusyChange={() => {}}
    operations={operations}
  />)
  fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} ${String(row)}` }))
}

describe('routingDraftOf', () => {
  it('reads a declared window', () => {
    expect(routingDraftOf({
      peak: [{ from: '21:00', to: '03:00', timeZone: 'Asia/Tokyo', providers: [{ provider: 'opencode-go' }] }],
    })).toEqual({ provider: 'opencode-go', from: '21:00', to: '03:00', timeZone: 'Asia/Tokyo' })
  })

  it('carries the destination credential reference', () => {
    expect(routingDraftOf({
      peak: [{
        from: '21:00',
        to: '03:00',
        providers: [{ provider: 'opencode-go', apiKeyEnv: 'OPENCODE_GO_API_KEY' }],
      }],
    })).toEqual({
      provider: 'opencode-go',
      from: '21:00',
      to: '03:00',
      timeZone: '',
      apiKeyEnv: 'OPENCODE_GO_API_KEY',
    })
  })

  it('reads an absent or malformed declaration as none', () => {
    const none = { provider: '', from: '', to: '', timeZone: '' }
    expect(routingDraftOf({})).toEqual(none)
    expect(routingDraftOf({ peak: [] })).toEqual(none)
    expect(routingDraftOf({ peak: [{}] })).toEqual(none)
    expect(routingDraftOf({ peak: [{ providers: [] }] })).toEqual(none)
    expect(routingDraftOf({ peak: [{ providers: [{}] }] })).toEqual(none)
  })
})

describe('peak routing control', () => {
  it('writes a window with default hours when a destination is chosen', () => {
    const onChange = vi.fn()
    editor([{ id: 'deepseek-v4.1-flash' }], onChange)
    fireEvent.change(screen.getByLabelText(`${en.routingProvider} 1`), { target: { value: 'opencode-go' } })
    expect(onChange).toHaveBeenCalledWith([{
      id: 'deepseek-v4.1-flash',
      peak: [{ from: '21:00', to: '03:00', providers: [{ provider: 'opencode-go' }] }],
    }])
  })

  it('edits an existing window and clears it when the destination is removed', () => {
    const model = {
      id: 'deepseek-v4.1-flash',
      peak: [{ from: '21:00', to: '03:00', timeZone: 'Asia/Tokyo', providers: [{ provider: 'opencode-go' }] }],
    }
    const onChange = vi.fn()
    editor([model], onChange)

    fireEvent.change(screen.getByLabelText(`${en.routingFrom} 1`), { target: { value: '22:00' } })
    expect(onChange).toHaveBeenLastCalledWith([{
      ...model,
      peak: [{ from: '22:00', to: '03:00', timeZone: 'Asia/Tokyo', providers: [{ provider: 'opencode-go' }] }],
    }])
    fireEvent.change(screen.getByLabelText(`${en.routingTo} 1`), { target: { value: '04:00' } })
    fireEvent.change(screen.getByLabelText(`${en.routingTimeZone} 1`), { target: { value: 'UTC' } })
    fireEvent.change(screen.getByLabelText(`${en.routingProvider} 1`), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'deepseek-v4.1-flash' }])
  })

  it('keeps the destination credential while the same destination is edited', () => {
    const model = {
      id: 'deepseek-v4.1-flash',
      peak: [{
        from: '21:00',
        to: '03:00',
        timeZone: 'Asia/Tokyo',
        providers: [{ provider: 'opencode-go', apiKeyEnv: 'OPENCODE_GO_API_KEY' }],
      }],
    }
    const onChange = vi.fn()
    editor([model], onChange)
    fireEvent.change(screen.getByLabelText(`${en.routingFrom} 1`), { target: { value: '22:00' } })
    expect(onChange).toHaveBeenLastCalledWith([{
      ...model,
      peak: [{
        from: '22:00',
        to: '03:00',
        timeZone: 'Asia/Tokyo',
        providers: [{ provider: 'opencode-go', apiKeyEnv: 'OPENCODE_GO_API_KEY' }],
      }],
    }])
  })

  it('drops the destination credential when the destination changes', () => {
    const model = {
      id: 'deepseek-v4.1-flash',
      peak: [{
        from: '21:00',
        to: '03:00',
        timeZone: 'Asia/Tokyo',
        providers: [{ provider: 'opencode-go', apiKeyEnv: 'OPENCODE_GO_API_KEY' }],
      }],
    }
    const onChange = vi.fn()
    editor([model], onChange)
    fireEvent.change(screen.getByLabelText(`${en.routingProvider} 1`), { target: { value: 'opencode' } })
    expect(onChange).toHaveBeenLastCalledWith([{
      ...model,
      peak: [{
        from: '21:00',
        to: '03:00',
        timeZone: 'Asia/Tokyo',
        providers: [{ provider: 'opencode' }],
      }],
    }])
  })

  it('appears only on the Ollama Cloud DeepSeek V4.1 Flash row', () => {
    editor([{ id: 'deepseek-v4.1-flash' }], vi.fn(), 'opencode-go')
    expect(screen.queryByText(en.peakRouting)).toBeNull()
    cleanup()
    editor([{ id: 'glm-5.3-flash' }], vi.fn())
    expect(screen.queryByText(en.peakRouting)).toBeNull()
  })

  it('excludes the source provider and keeps providers serving the model', () => {
    editor([{ id: 'deepseek-v4.1-flash' }], vi.fn())
    expect(screen.getByRole('option', { name: 'OpenCode Go', hidden: true })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Ollama Cloud', hidden: true })).toBeNull()
  })

  it('keeps a stored destination the catalog no longer lists', () => {
    const model = {
      id: 'deepseek-v4.1-flash',
      peak: [{ from: '21:00', to: '03:00', providers: [{ provider: 'retired' }] }],
    }
    editor([model], vi.fn())
    expect(screen.getByLabelText<HTMLSelectElement>(`${en.routingProvider} 1`).value).toBe('retired')
    expect(screen.getByRole('option', { name: 'retired', hidden: true })).toBeTruthy()
  })

  it('leaves rows other than the edited one untouched', () => {
    const onChange = vi.fn()
    editor([{ id: 'deepseek-v4.1-flash' }, { id: 'deepseek-v4.1-flash' }], onChange, 'ollama-cloud', 2)
    fireEvent.change(screen.getByLabelText(`${en.routingProvider} 2`), { target: { value: 'opencode-go' } })
    expect(onChange).toHaveBeenCalledWith([
      { id: 'deepseek-v4.1-flash' },
      {
        id: 'deepseek-v4.1-flash',
        peak: [{ from: '21:00', to: '03:00', providers: [{ provider: 'opencode-go' }] }],
      },
    ])
  })

  it('offers no control when the card has no destination list', () => {
    render(<ModelListEditor
      models={[{ id: 'deepseek-v4.1-flash' }]}
      onChange={vi.fn()}
      probe={{ settingsNs: 'llm-pi-ai', provider: 'ollama-cloud' }}
      disabled={false}
      t={key => en[key]}
      onBusyChange={() => {}}
      operations={operations}
    />)
    fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
    expect(screen.queryByText(en.peakRouting)).toBeNull()
  })
})
