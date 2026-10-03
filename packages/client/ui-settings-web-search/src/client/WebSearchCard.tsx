/**
 * The web-search provider's settings page: the search provider selected in
 * this deployment, that provider's endpoint and per-request bound, and the key
 * — which is written through the credentials domain, never into the settings
 * section, so the literal never rides a response.
 */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { SegmentedControl, SettingsForm, SettingsSecretField, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formLabels } from './locales.ts'
import type { WebSearchCardFace } from './web-search-card-controller.ts'
import css from './WebSearchCard.module.css'

/** Props the renderer binds for the web-search page. */
export type WebSearchCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.webSearch'>
  & InjectFace<WebSearchCardFace>

/** Base id of the provider selector; each tab is `<id>-<value>`. */
const SELECTOR_ID = 'plugin-config-web-search-provider'

/**
 * Render the web-search provider's one-liner or its settings form, as the Plugins page asks.
 * @param props - the view asked for, locale copy, the form snapshot, and its actions.
 * @returns the one-liner, or the form.
 */
export function WebSearchCard(props: WebSearchCardProps) {
  const { t } = props
  const state = props.useWebSearchCard(snapshot => snapshot)
  if (props.view === 'summary') return t('description')
  const disabled = !state.writable
  const fields = (
    <>
      <SettingsSecretField
        id="plugin-config-web-search-key"
        label={t('apiKey')}
        hint={t('apiKeyHint')}
        // The credentials domain accepts a key even when the settings document
        // itself is read-only; they are separate stores with separate refusals.
        // Its own writability is what disables this control — a key sourced
        // from the process environment cannot be written from here.
        disabled={!state.apiKeyWritable}
        text={state.apiKey.text}
        configured={state.apiKeyConfigured}
        stateLabel={state.apiKeyConfigured ? t('apiKeySet') : t('apiKeyUnset')}
        onEdit={(text) => { props.edit('apiKey', text) }}
      />
      <SettingsValueField
        id="plugin-config-web-search-endpoint"
        label={t('baseUrl')}
        hint={t('baseUrlHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        placeholder={state.endpointPlaceholder}
        disabled={disabled}
        {...state.baseURL}
        onEdit={(text) => { props.edit('baseURL', text) }}
        onReset={() => { props.resetField('baseURL') }}
      />
      <SettingsValueField
        id="plugin-config-web-search-limit"
        label={t(state.limitLabelKey)}
        hint={t(state.limitHintKey)}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.limit}
        onEdit={(text) => { props.edit(state.limitField, text) }}
        onReset={() => { props.resetField(state.limitField) }}
      />
    </>
  )
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      {state.showSelector
        ? (
          <div className={css.provider}>
            <span className={css.label}>{t('providerLabel')}</span>
            <SegmentedControl
              id={SELECTOR_ID}
              label={t('providerLabel')}
              value={state.selectedProviderId}
              disabled={!state.selectorWritable}
              options={state.providers.map(provider => ({ value: provider.value, label: t(provider.labelKey) }))}
              onChange={(next) => { props.selectProvider(next) }}
            />
          </div>
        )
        : null}
      {state.showSelector
        ? (
          <div
            id={`${SELECTOR_ID}-${state.selectedProviderId}-panel`}
            role="tabpanel"
            aria-labelledby={`${SELECTOR_ID}-${state.selectedProviderId}`}
          >
            {fields}
          </div>
        )
        : fields}
    </SettingsForm>
  )
}
