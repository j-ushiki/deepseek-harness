/** Shared model fields and actions for both adapter catalog editors. */

import type { ReactNode } from 'react'
import {
  IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconTrashOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import type { RoutingProviderOption } from './store.ts'
import type { ModelsKey } from './locales.ts'
import { ModelInputTypes } from './ModelInputTypes.tsx'
import { ModelReasoningEfforts } from './ModelReasoningEfforts.tsx'
import styles from './ModelsSection.module.css'

/** A capacity's editable text and adapter-specific inherited hint. */
interface CapacityInput {
  value: string
  placeholder: string
  onChange: (value: string) => void
  onBlur?: () => void
}

export type { RoutingProviderOption } from './store.ts'

/** The editable peak route of one model row. */
export interface RoutingDraft {
  /** Destination provider route, or empty for no routing. */
  provider: string
  /** Inclusive local start `HH:mm`. */
  from: string
  /** Exclusive local end `HH:mm`. */
  to: string
  /** IANA time zone, or empty for the process zone. */
  timeZone: string
  /**
   * Credential reference the stored destination carries. The control neither
   * shows nor edits it: it rides along so rewriting the same destination keeps
   * it, and a destination this draft changes starts without it, because the
   * reference names a credential of the route that was there.
   */
  apiKeyEnv?: string
}

/**
 * Read one row's first peak window as the form edits it.
 * @param model - the drafted model entry.
 * @returns the editable route; an absent or malformed declaration reads as none.
 */
export function routingDraftOf(model: DeepSeekModelDraft): RoutingDraft {
  const windows = model['peak']
  const entry = Array.isArray(windows) && windows.length > 0
    ? windows[0] as Record<string, unknown>
    : undefined
  const providers = entry?.['providers']
  const candidate = Array.isArray(providers) && providers.length > 0
    ? providers[0] as Record<string, unknown>
    : undefined
  const provider = candidate?.['provider']
  const apiKeyEnv = candidate?.['apiKeyEnv']
  return {
    provider: typeof provider === 'string' ? provider : '',
    from: typeof entry?.['from'] === 'string' ? entry['from'] : '',
    to: typeof entry?.['to'] === 'string' ? entry['to'] : '',
    timeZone: typeof entry?.['timeZone'] === 'string' ? entry['timeZone'] : '',
    ...typeof apiKeyEnv === 'string' && apiKeyEnv !== '' ? { apiKeyEnv } : {},
  }
}

/** Adapter-owned data and actions for one model row. */
interface ModelRowProps {
  model: DeepSeekModelDraft
  position: number
  inputField: 'inputModalities' | 'input'
  inputFallback?: readonly string[] | undefined
  inputLoading?: boolean
  /** Levels the row's `reasoningEfforts` may declare; absent or empty shows no reasoning control. */
  reasoningLevels?: readonly string[] | undefined
  expanded: boolean
  disabled: boolean
  t: (key: ModelsKey) => string
  contextWindow: CapacityInput
  maxTokens: CapacityInput
  onFieldChange: (field: 'id' | 'name', value: string | undefined) => void
  onIdBlur?: (value: string) => void
  onChange: (model: DeepSeekModelDraft) => void
  onToggle: () => void
  onRemove: () => void
  /** Destination providers offered for peak routing; absent hides the control. */
  routingProviders?: readonly RoutingProviderOption[] | undefined
  /** Apply one peak route, or `undefined` to clear it. */
  onRoutingChange?: ((next: RoutingDraft | undefined) => void) | undefined
}

/**
 * Render consistent model identity, capacity, and input-type controls.
 * @param props - drafted fields and their owning editor's actions.
 * @returns one expandable model entry.
 */
export function ModelRow(props: ModelRowProps): ReactNode {
  const { model, position, t, disabled } = props
  const routing = props.onRoutingChange === undefined ? undefined : routingDraftOf(model)
  // A stored destination the catalog no longer lists stays selectable, so the
  // row shows what the profile actually says instead of blanking the select.
  const routingOptions = props.routingProviders === undefined || routing === undefined
    ? []
    : routing.provider !== '' && !props.routingProviders.some(option => option.id === routing.provider)
      ? [{ id: routing.provider, name: routing.provider, models: [] }, ...props.routingProviders]
      : props.routingProviders
  const editRouting = (next: Partial<RoutingDraft>): void => {
    /* v8 ignore next -- the control is only rendered when the draft exists */
    if (routing === undefined) return
    const destinationChanged = next.provider !== undefined && next.provider !== routing.provider
    const merged: RoutingDraft = {
      provider: next.provider ?? routing.provider,
      from: next.from ?? routing.from,
      to: next.to ?? routing.to,
      timeZone: next.timeZone ?? routing.timeZone,
      ...routing.apiKeyEnv === undefined || destinationChanged ? {} : { apiKeyEnv: routing.apiKeyEnv },
    }
    props.onRoutingChange?.(merged.provider === '' ? undefined : merged)
  }
  return (
    <div className={styles['modelEntry']}>
      <div className={styles['modelRow']}>
        {(['id', 'name'] as const).map(field => (
          <input
            key={field}
            className={styles['input']}
            type="text"
            value={typeof model[field] === 'string' ? model[field] : ''}
            placeholder={t(field === 'id' ? 'modelId' : 'modelName')}
            aria-label={`${t(field === 'id' ? 'modelId' : 'modelName')} ${String(position)}`}
            disabled={disabled}
            onChange={(event) => {
              const value = event.target.value
              props.onFieldChange(field, field === 'name' && value === '' ? undefined : value)
            }}
            onBlur={field === 'id' ? event => props.onIdBlur?.(event.target.value) : undefined}
          />
        ))}
        <button
          type="button"
          className={styles['iconButton']}
          aria-label={`${t('modelAdvanced')} ${String(position)}`}
          aria-expanded={props.expanded}
          title={t('modelAdvanced')}
          onClick={props.onToggle}
        >
          {props.expanded ? <IconChevronDownOutlineRegular /> : <IconChevronRightOutlineRegular />}
        </button>
        <button
          type="button"
          className={`${styles['iconButton']} ${styles['iconButtonDanger']}`}
          aria-label={`${t('removeModel')} ${String(position)}`}
          title={t('removeModel')}
          disabled={disabled}
          onClick={props.onRemove}
        >
          <IconTrashOutlineRegular size={14} />
        </button>
      </div>
      {props.expanded
        ? (
          <div className={styles['modelAdvanced']}>
            {(['contextWindow', 'maxTokens'] as const).map(field => (
              <label className={styles['modelField']} key={field}>
                <span className={styles['modelFieldLabel']}>{t(field)}</span>
                <input
                  className={styles['input']}
                  type="text"
                  inputMode="numeric"
                  value={props[field].value}
                  placeholder={props[field].placeholder}
                  aria-label={`${t(field)} ${String(position)}`}
                  disabled={disabled}
                  onChange={(event) => { props[field].onChange(event.target.value) }}
                  onBlur={props[field].onBlur}
                />
              </label>
            ))}
            <ModelInputTypes
              model={model} field={props.inputField} position={position}
              fallback={props.inputFallback} disabled={disabled || props.inputLoading === true} t={t} onChange={props.onChange}
            />
            {props.reasoningLevels !== undefined && props.reasoningLevels.length > 0
              ? (
                <ModelReasoningEfforts
                  model={model} levels={props.reasoningLevels} position={position} disabled={disabled} t={t} onChange={props.onChange}
                />
              )
              : null}
            {routing === undefined || routingOptions.length === 0
              ? null
              : (
                <div className={styles['routingFields']}>
                  <span className={styles['modelFieldLabel']}>{t('peakRouting')}</span>
                  <label className={styles['modelField']}>
                    <span className={styles['modelFieldLabel']}>{t('routingProvider')}</span>
                    <select
                      className={`${styles['input']} ${styles['selectInput']}`}
                      value={routing.provider}
                      aria-label={`${t('routingProvider')} ${String(position)}`}
                      disabled={disabled}
                      onChange={(event) => {
                        const provider = event.target.value
                        editRouting({
                          provider,
                          ...provider !== '' && routing.from === '' && routing.to === ''
                            ? { from: '21:00', to: '03:00' }
                            : {},
                        })
                      }}
                    >
                      <option value="">{t('routingNone')}</option>
                      {routingOptions.map(option => (
                        <option key={option.id} value={option.id}>{option.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className={styles['modelField']}>
                    <span className={styles['modelFieldLabel']}>{t('routingTimeZone')}</span>
                    <input
                      className={styles['input']}
                      type="text"
                      value={routing.timeZone}
                      placeholder={t('routingTimeZonePlaceholder')}
                      aria-label={`${t('routingTimeZone')} ${String(position)}`}
                      disabled={disabled}
                      onChange={(event) => { editRouting({ timeZone: event.target.value }) }}
                    />
                  </label>
                  {routing.provider === ''
                    ? <p className={styles['routingHint']}>{t('routingHint')}</p>
                    : (['from', 'to'] as const).map(field => (
                      <label className={styles['modelField']} key={field}>
                        <span className={styles['modelFieldLabel']}>
                          {t(field === 'from' ? 'routingFrom' : 'routingTo')}
                        </span>
                        <input
                          className={styles['input']}
                          type="text"
                          value={routing[field]}
                          placeholder={t('routingTimePlaceholder')}
                          aria-label={`${t(field === 'from' ? 'routingFrom' : 'routingTo')} ${String(position)}`}
                          disabled={disabled}
                          onChange={(event) => {
                            const value = event.target.value
                            editRouting(field === 'from' ? { from: value } : { to: value })
                          }}
                        />
                      </label>
                    ))}
                </div>
              )}
          </div>
        )
        : null}
    </div>
  )
}
