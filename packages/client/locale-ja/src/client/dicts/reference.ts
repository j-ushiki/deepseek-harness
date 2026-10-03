/** Japanese dictionary for the `reference` namespace (client/ui-reference/src/client/locales.ts). */
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: loads the `reference` key union declared by @deepseek-ai/dsh-client-ui-reference.
import type {} from '@deepseek-ai/dsh-client-ui-reference/src/client/locales.ts'

/** `reference` copy in Japanese, complete against the owner's key union. */
export const ja: LocaleDictOf<'reference'> = {
  'section.files': 'ファイルとフォルダー',
  'section.subagents': 'サブエージェント',
  'section.sessions': 'セッション',
  'candidate.noCwd': '（作業ディレクトリなし）',
  'crumb.root': 'ワークスペース',
  'fileOpen.title': 'ファイルを開けませんでした',
  'fileOpen.failed': '「{path}」を開けませんでした。再試行するか、このメッセージを閉じてください。',
  'fileOpen.close': '閉じる',
  'fileOpen.retry': '再試行',
  'time.now': 'たった今',
  'time.minutes': '{n}分',
  'time.hours': '{n}時間',
  'time.days': '{n}日',
  'time.months': '{n}か月',
  'time.years': '{n}年',
}
