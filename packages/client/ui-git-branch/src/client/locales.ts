/** `gitBranch` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'gitBranch'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'branch.tooltip': '分支 {ref}',
  'detached.tooltip': '游离 HEAD {ref}',
  'worktree.tooltip': '(工作树 {name})',
  'path.tooltip': '位于 {path}',
  'dialog.title': '检出',
  'dialog.branch': '分支',
  'dialog.commit': '提交',
  'dialog.worktree': '工作树',
  'dialog.path': '路径',
  'dialog.repository': '仓库',
  'dialog.none': '—',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<GitBranchKey, string> = {
  'branch.tooltip': 'Branch {ref}',
  'detached.tooltip': 'Detached HEAD {ref}',
  'worktree.tooltip': '(worktree {name})',
  'path.tooltip': 'at {path}',
  'dialog.title': 'Checkout',
  'dialog.branch': 'Branch',
  'dialog.commit': 'Commit',
  'dialog.worktree': 'Worktree',
  'dialog.path': 'Path',
  'dialog.repository': 'Repository',
  'dialog.none': '—',
}

/** Key domain of the `gitBranch` namespace (zh is the source of truth). */
export type GitBranchKey = keyof typeof zh
