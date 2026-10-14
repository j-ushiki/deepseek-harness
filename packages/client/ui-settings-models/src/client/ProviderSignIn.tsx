/**
 * Sign-in control of one provider card, shown only when the Host registered an
 * authorization flow for the provider's credential record (`llm-pi-ai/<id>`).
 * The flow's notices and questions render inline; closing the card or pressing
 * Cancel withdraws the attempt.
 *
 * @module dsh-client-ui-settings-models/client/ProviderSignIn
 */

import { assertNever } from '@deepseek-ai/dsh-util-values'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AuthorizationEntry, AuthorizationPromptId, AuthorizationPromptView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelsOperations, SignInOutcome, SignInProgressEvent } from './operations.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Props of {@link ProviderSignIn}. */
export interface ProviderSignInProps {
  /** Provider route id; its credential record is `llm-pi-ai/<provider>`. */
  provider: string
  /** The Host operations the control invokes. */
  operations: ModelsOperations
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/** What one attempt has shown the human so far. */
interface Progress {
  notice?: { message: string; url?: string; code?: string }
  prompt?: AuthorizationPromptView
  result?: SignInOutcome
}

/**
 * Render the sign-in control, or nothing when the provider has no flow.
 * @param props - the provider, Host operations, and copy.
 * @returns the control.
 */
export function ProviderSignIn(props: ProviderSignInProps): ReactNode {
  const { operations, t } = props
  const key = `llm-pi-ai/${props.provider}`
  const [flow, setFlow] = useState<AuthorizationEntry | undefined>(undefined)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<Progress>({})
  const [answer, setAnswer] = useState('')
  const controller = useRef<AbortController | undefined>(undefined)

  useEffect(() => {
    let live = true
    void operations.describeSignIn(key).then((entry) => { if (live) setFlow(entry) })
    return () => { live = false; controller.current?.abort(); controller.current = undefined }
  }, [operations, key])

  if (flow === undefined) return null

  const onEvent = (event: SignInProgressEvent): void => {
    switch (event.type) {
      case 'notice': setProgress(previous => ({ ...previous, notice: event.notice })); break
      case 'prompt':
        setAnswer('')
        setProgress(previous => ({ ...previous, prompt: event.prompt }))
        break
      case 'prompt-withdrawn':
        setProgress((previous) => {
          if (previous.prompt?.promptId !== event.promptId) return previous
          const { prompt: _prompt, ...rest } = previous
          return rest
        })
        break
      /* v8 ignore next -- Remote decoding admits only the three progress variants handled above. */
      default: assertNever(event)
    }
  }

  const start = (): void => {
    const attempt = new AbortController()
    controller.current = attempt
    setRunning(true)
    setProgress({})
    void operations.signIn(key, onEvent, attempt.signal).then((outcome) => {
      if (controller.current !== attempt) return
      setRunning(false)
      setProgress({ result: outcome })
    })
  }

  const reply = (promptId: AuthorizationPromptId, value: string | null): void => {
    setProgress(({ prompt: _prompt, ...rest }) => rest)
    void operations.answerSignIn(promptId, value)
  }

  const { notice, prompt, result } = progress
  return (
    <div className={styles['field']}>
      <span className={styles['fieldLabel']}>{flow.label}</span>
      <span className={styles['advancedHint']}>{t('signInHint')}</span>
      {running
        ? (
          <button type="button" className={styles['secondaryButton']} onClick={() => { controller.current?.abort() }}>
            {t('signInCancel')}
          </button>
        )
        : (
          <button type="button" className={styles['primaryButton']} onClick={start}>
            {t('signIn')}
          </button>
        )}
      {running && notice !== undefined
        ? (
          <p className={styles['advancedHint']}>
            {notice.message}
            {notice.url === undefined ? null : <> <a href={notice.url} target="_blank" rel="noreferrer">{notice.url}</a></>}
            {notice.code === undefined ? null : <> <code>{notice.code}</code></>}
          </p>
        )
        : null}
      {running && prompt !== undefined
        ? (
          <form onSubmit={(event) => { event.preventDefault(); reply(prompt.promptId, answer) }}>
            <span className={styles['fieldLabel']}>{prompt.message}</span>
            {prompt.kind === 'select'
              ? (
                <select className={`${styles['input']} ${styles['selectInput']}`} value={answer} aria-label={prompt.message}
                  onChange={(event) => { setAnswer(event.target.value) }}>
                  <option value="" />
                  {prompt.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              )
              : (
                <input
                  className={styles['input']}
                  type={prompt.kind === 'secret' ? 'password' : 'text'}
                  value={answer}
                  placeholder={prompt.placeholder}
                  aria-label={prompt.message}
                  onChange={(event) => { setAnswer(event.target.value) }}
                />
              )}
            <button type="submit" className={styles['primaryButton']} disabled={answer === ''}>{t('signInSubmit')}</button>
            <button type="button" className={styles['secondaryButton']} onClick={() => { reply(prompt.promptId, null) }}>{t('cancel')}</button>
          </form>
        )
        : null}
      {result === undefined
        ? null
        : result.kind === 'authorized'
          ? <p className={styles['advancedHint']} role="status">{t('signInDone')}</p>
          : result.kind === 'cancelled'
            ? <p className={styles['advancedHint']} role="status">{t('signInCancelled')}</p>
            : <p className={styles['error']} role="alert">{`${t('signInFailed')}: ${result.message}`}</p>}
    </div>
  )
}
