import type { SessionRateLimit } from 'claude-code'

import type { AccountFit, AccountLabel, UsageLevel, UsageSegment, UsageWindow, WindowKind } from '../types'

export const WINDOWS: readonly WindowKind[] = ['five_hour', 'seven_day']
export const LABELS: Record<WindowKind, string> = { five_hour: '5h', seven_day: 'semana' }
export const BAR_WIDTH = 10
export const ACCOUNT_FILE = '.claude.json'
export const ORG_MIN_COLUMNS = 100
export const STACK_BELOW_COLUMNS = 80
export const EMAIL_RESERVED_CELLS = 20
export const EMAIL_MIN_CELLS = 12

const WEEKDAYS = ['dom.', 'lun.', 'mar.', 'mié.', 'jue.', 'vie.', 'sáb.']
const ENGLISH_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const isWindowKind = (value: unknown): value is WindowKind => WINDOWS.some(kind => kind === value)

/** The two subscription windows, 5h first, from what the engine measured. */
export const windowsOf = (rateLimits: readonly SessionRateLimit[]): UsageWindow[] =>
  WINDOWS.flatMap(kind => {
    const found = rateLimits.find(limit => limit.kind === kind && Number.isFinite(limit.percentUsed))

    return found ? [{ kind, percentUsed: found.percentUsed, resetsAt: found.resetsAt }] : []
  })

/** Validates what was read back from the store, which is untyped. */
export const isUsageWindowList = (value: unknown): value is UsageWindow[] =>
  Array.isArray(value) &&
  value.every(
    item =>
      typeof item === 'object' &&
      item !== null &&
      isWindowKind(item.kind) &&
      typeof item.percentUsed === 'number' &&
      Number.isFinite(item.percentUsed) &&
      (item.resetsAt === undefined || typeof item.resetsAt === 'string'),
  )

export const clampPercent = (percent: number): number => Math.min(100, Math.max(0, Math.round(percent)))

export const levelOf = (percent: number): UsageLevel => {
  if (percent >= 80) return 'critical'
  if (percent >= 50) return 'warning'

  return 'ok'
}

export const barOf = (percent: number, width: number = BAR_WIDTH): { filled: string; empty: string } => {
  const filledCount = Math.floor((percent * width) / 100)

  return { filled: '▓'.repeat(filledCount), empty: '░'.repeat(width - filledCount) }
}

/** Reset moment as `HH:MM` (5h) or `<día> HH:MM` (week); undefined if the date is invalid. */
export const formatReset = (resetsAt: string, kind: WindowKind, timeZone?: string): string | undefined => {
  const time = Date.parse(resetsAt)
  if (Number.isNaN(time)) return undefined

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(time))
  const part = (type: string) => parts.find(one => one.type === type)?.value ?? ''
  const clock = `${part('hour')}:${part('minute')}`
  if (kind === 'five_hour') return clock

  return `${WEEKDAYS[ENGLISH_WEEKDAYS.indexOf(part('weekday'))]} ${clock}`
}

export const segmentOf = (
  window: UsageWindow | undefined,
  kind: WindowKind,
  now: number,
  timeZone?: string,
): UsageSegment => {
  const label = LABELS[kind]
  if (!window) return { label, missing: true }

  // A window that already reset still carries the old reading until the next measure.
  const hasReset = window.resetsAt !== undefined && Date.parse(window.resetsAt) <= now
  const percent = hasReset ? 0 : clampPercent(window.percentUsed)
  const reset = hasReset || window.resetsAt === undefined ? undefined : formatReset(window.resetsAt, kind, timeZone)

  return { label, missing: false, percent, ...barOf(percent), level: levelOf(percent), reset }
}

/** Always two segments: 5h and week. */
export const segmentsOf = (limits: UsageWindow[], now: number, timeZone?: string): UsageSegment[] =>
  WINDOWS.map(kind =>
    segmentOf(
      limits.find(limit => limit.kind === kind),
      kind,
      now,
      timeZone,
    ),
  )

/**
 * Path of the active profile's account file (POSIX only). `configDir` (`CLAUDE_CONFIG_DIR`) wins
 * over `home`, unless blank; undefined when neither directory is known.
 */
export const accountFilePath = (configDir?: string, home?: string): string | undefined => {
  const dir = configDir?.trim() ? configDir.trim() : home
  if (!dir) return undefined

  return `${dir.replace(/\/+$/, '')}/${ACCOUNT_FILE}`
}

// C0/C1 controls, DEL, invisible and bidi format characters, and the Unicode line/paragraph separators.
const CONTROL_CHARS = /[\p{Cc}\p{Cf}\u2028\u2029]/gu

const cleanText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(CONTROL_CHARS, '').trim()

  return cleaned === '' ? undefined : cleaned
}

/**
 * Sanitises an untyped email/organization pair; null when nothing usable remains.
 * The organization is dropped when it only repeats the email.
 */
export const accountLabelOf = (raw: { email?: unknown; organization?: unknown }): AccountLabel | null => {
  const email = cleanText(raw.email)
  let organization = cleanText(raw.organization)
  // Personal accounts get an organization name that just repeats the email.
  if (email && organization?.toLowerCase().includes(email.toLowerCase())) organization = undefined
  if (!email && !organization) return null

  return { ...(email && { email }), ...(organization && { organization }) }
}

/**
 * Reads only `oauthAccount`'s email and organization from the text of `.claude.json`; any other
 * field (tokens, ids) is never looked at. Never throws: invalid JSON or a missing login gives null.
 */
export const accountOfConfig = (text: string): AccountLabel | null => {
  let config: unknown
  try {
    config = JSON.parse(text)
  } catch {
    return null
  }
  const oauthAccount = typeof config === 'object' && config !== null ? (config as Record<string, unknown>).oauthAccount : undefined
  if (typeof oauthAccount !== 'object' || oauthAccount === null) return null
  const account = oauthAccount as Record<string, unknown>

  return accountLabelOf({ email: account.emailAddress, organization: account.organizationName })
}

/**
 * Shortens an email to at most `maxCells` characters, keeping the domain when possible.
 * Emails with non-ASCII characters are returned unchanged: characters are not cells
 * (CJK takes two), so the terminal truncates them (`wrap="truncate-middle"`).
 */
export const shortenEmail = (email: string, maxCells: number): string => {
  if (/[^ -~]/.test(email)) return email
  const max = Math.max(3, maxCells)
  if (email.length <= max) return email

  const at = email.lastIndexOf('@')
  const domain = at > 0 ? email.slice(at) : ''
  if (domain && domain.length + 2 <= max) return `${email.slice(0, max - domain.length - 1)}…${domain}`

  const head = Math.ceil((max - 1) / 2)
  const tail = max - 1 - head

  return `${email.slice(0, head)}…${tail > 0 ? email.slice(-tail) : ''}`
}

/**
 * Decides what to paint of the account for the terminal width, and whether it stacks above the bars.
 * From `ORG_MIN_COLUMNS` up (or with unknown width) everything is kept; below it the organization is
 * hidden and the email shortened (only when there is an email); below `STACK_BELOW_COLUMNS` it also stacks.
 */
export const accountFitOf = (label: AccountLabel, columns?: number): AccountFit => {
  if (columns === undefined || columns >= ORG_MIN_COLUMNS) return { ...label, stacked: false }

  const stacked = columns < STACK_BELOW_COLUMNS
  if (!label.email) return { ...label, stacked }

  return { email: shortenEmail(label.email, Math.max(EMAIL_MIN_CELLS, columns - EMAIL_RESERVED_CELLS)), stacked }
}
