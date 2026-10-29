import type { SessionRateLimit } from 'claude-code'

import type { UsageLevel, UsageSegment, UsageWindow, WindowKind } from '../types'

export const WINDOWS: readonly WindowKind[] = ['five_hour', 'seven_day']
export const LABELS: Record<WindowKind, string> = { five_hour: '5h', seven_day: 'semana' }
export const BAR_WIDTH = 10

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
