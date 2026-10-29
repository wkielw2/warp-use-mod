export type WindowKind = 'five_hour' | 'seven_day'

export type UsageWindow = { kind: WindowKind; percentUsed: number; resetsAt?: string }

export type UsageLevel = 'ok' | 'warning' | 'critical'

/** One half of the meter: a window with its bar, or a placeholder when the engine has no data. */
export type UsageSegment =
  | { label: string; missing: true }
  | {
      label: string
      missing: false
      percent: number
      filled: string
      empty: string
      level: UsageLevel
      reset?: string
    }

/** Who is signed in: each part is omitted when unknown. */
export type AccountLabel = { email?: string; organization?: string }

/** What to paint of the account for a given width, and whether it goes on its own line. */
export type AccountFit = { email?: string; organization?: string; stacked: boolean }

declare module 'claude-code' {
  interface PluginState {
    'uso-suscripcion': { limits: UsageWindow[]; now: number; account: AccountLabel | null }
  }
}
