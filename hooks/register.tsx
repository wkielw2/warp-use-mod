import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeKey } from 'claude-code'

import type { AccountLabel, UsageLevel, UsageWindow } from '../types'
import { accountFilePath, accountFitOf, accountOfConfig, isUsageWindowList, segmentsOf, windowsOf } from './uso'

const TICK_MS = 60_000

const limits = atom({ plugin: 'uso-suscripcion', key: 'limits' } as const, [])
const now = atom({ plugin: 'uso-suscripcion', key: 'now' } as const, 0)
const account = atom({ plugin: 'uso-suscripcion', key: 'account' } as const, null)

const LEVEL_COLOR: Record<UsageLevel, ThemeKey> = { ok: 'success', warning: 'warning', critical: 'error' }
const CRITICAL_MARK = '!'
// The email uses the theme's default text color.
const ACCOUNT_EMAIL_COLOR: ThemeKey | undefined = undefined

/** Keeps the latest reading for the footer, and for the next session until a response reports again. */
async function remember($: EngineInterface, found: UsageWindow[]): Promise<void> {
  if (found.length === 0) return
  await update($, limits, () => found)
  await $.store.set('limits', found)
}

/** Who is signed in on the active profile; null when the file or the login is missing. */
async function readAccount($: EngineInterface): Promise<AccountLabel | null> {
  const path = accountFilePath(await $.env.get('CLAUDE_CONFIG_DIR'), await $.env.get('HOME'))
  if (path === undefined) return null

  return accountOfConfig(await $.fs.read(path))
}

// The clock is installed first and every step after it is guarded, so a failure
// in the store or in `session.usage` never leaves the footer without its tick.
async function start($: EngineInterface): Promise<void> {
  const startedAt = await $.clock.now()
  await update($, now, () => startedAt)
  $.clock.every(TICK_MS, async () => {
    try {
      const time = await $.clock.now()
      await update($, now, () => time)
    } catch {
      // A missed tick is made up for by the next one.
    }
  })

  try {
    const saved = await $.store.get('limits')
    if (isUsageWindowList(saved)) await update($, limits, () => saved)
  } catch {
    // Without the saved reading the fresh one below still shows.
  }

  try {
    await remember($, windowsOf((await $.session.usage()).rateLimits))
  } catch {
    // Without a fresh reading the saved one stays on screen.
  }

  // Memory only, and always written (even null) so a reload never keeps a stale
  // account: with several profiles, a stored one would show another profile's.
  let found: AccountLabel | null = null
  try {
    found = await readAccount($)
  } catch {
    // No account, as if nobody were logged in.
  }
  try {
    await update($, account, () => found)
  } catch {
    // Without the account the footer shows the meter alone.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await start($)

    return next(e)
  }).catch(($, e, next) => next(e)) // never block the start because the meter failed

  on('session.measure', async ($, e, next) => {
    await remember($, windowsOf(e.rateLimits))

    return next(e)
  }).catch(($, e, next) => next(e))

  // Bottom right of the prompt footer: the engine's mode labels, then the 5h and week meters together.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const found = await read($, limits)
    const label = await read($, account)
    if (found.length === 0 && !label) return next(e)

    // Always composed, so the mods beneath keep drawing; core's own tree is only worth a separator when it has labels.
    const beside = await next(e)
    const hasBeside = beside.type !== 'engine' || e.props.modes.length > 0
    const { Box, Text } = $.ui.resolve(e)
    const separator = <Text dimColor> · </Text>

    const segmentView = (segment: ReturnType<typeof segmentsOf>[number]) => (
      <>
        <Text>{segment.label} </Text>
        {segment.missing ? (
          <Text>–</Text>
        ) : (
          <>
            <Text color={LEVEL_COLOR[segment.level]}>{segment.filled + segment.empty}</Text>
            <Text color={LEVEL_COLOR[segment.level]}> {segment.percent}%</Text>
            {/* The level is not told by color alone. */}
            {segment.level === 'critical' && <Text color={LEVEL_COLOR.critical}>{CRITICAL_MARK}</Text>}
            {segment.reset !== undefined && <Text> ↻{segment.reset}</Text>}
          </>
        )}
      </>
    )

    let barsInRows: ReturnType<typeof segmentView> | null = null
    let segments: ReturnType<typeof segmentsOf> | null = null
    if (found.length > 0) {
      await read($, now) // makes the render depend on the tick
      segments = segmentsOf(found, await $.clock.now())
    }

    if (!label && segments) {
      const [fiveHour, week] = segments

      return (
        <Box flexDirection="row">
          {beside}
          {hasBeside ? separator : null}
          {segmentView(fiveHour)}
          {separator}
          {segmentView(week)}
        </Box>
      )
    }
    if (!label) return beside // unreachable (the early return covers it); narrows the type

    if (segments) {
      const [fiveHour, week] = segments
      // With an account each window is unbreakable, so a narrow row wraps between windows.
      barsInRows = (
        <Box key="uso-barras" flexDirection="row" flexShrink={0} flexWrap="wrap">
          <Box flexShrink={0}>{segmentView(fiveHour)}</Box>
          {separator}
          <Box flexShrink={0}>{segmentView(week)}</Box>
        </Box>
      )
    }

    const fit = accountFitOf(label, e.viewport?.columns)
    const accountView = (
      <Box key="uso-cuenta" flexDirection="row" flexShrink={1}>
        {fit.email ? (
          <Box flexShrink={1}>
            <Text color={ACCOUNT_EMAIL_COLOR} wrap="truncate-middle">
              {fit.email}
            </Text>
          </Box>
        ) : null}
        {fit.email && fit.organization ? separator : null}
        {fit.organization ? (
          <Box flexShrink={2}>
            <Text dimColor={fit.email ? true : undefined} wrap="truncate-end">
              {fit.organization}
            </Text>
          </Box>
        ) : null}
      </Box>
    )
    const accountRow = (
      <Box flexDirection="row">
        {beside}
        {hasBeside ? separator : null}
        {accountView}
        {barsInRows && !fit.stacked ? separator : null}
        {barsInRows && !fit.stacked ? barsInRows : null}
      </Box>
    )
    if (!barsInRows || !fit.stacked) return accountRow

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          {beside}
          {hasBeside ? separator : null}
          {accountView}
        </Box>
        {barsInRows}
      </Box>
    )
  })
}
