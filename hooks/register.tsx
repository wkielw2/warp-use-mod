import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeKey } from 'claude-code'

import type { UsageLevel, UsageWindow } from '../types'
import { isUsageWindowList, segmentsOf, windowsOf } from './uso'

const TICK_MS = 60_000

const limits = atom({ plugin: 'uso-suscripcion', key: 'limits' } as const, [])
const now = atom({ plugin: 'uso-suscripcion', key: 'now' } as const, 0)

const LEVEL_COLOR: Record<UsageLevel, ThemeKey> = { ok: 'success', warning: 'warning', critical: 'error' }
const CRITICAL_MARK = '!'

/** Keeps the latest reading for the footer, and for the next session until a response reports again. */
async function remember($: EngineInterface, found: UsageWindow[]): Promise<void> {
  if (found.length === 0) return
  await update($, limits, () => found)
  await $.store.set('limits', found)
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
    if (found.length === 0) return next(e)

    await read($, now) // makes the render depend on the tick
    const time = await $.clock.now()
    // Always composed, so the mods beneath keep drawing; core's own tree is only worth a separator when it has labels.
    const beside = await next(e)
    const hasBeside = beside.type !== 'engine' || e.props.modes.length > 0
    const { Box, Text } = $.ui.resolve(e)
    const [fiveHour, week] = segmentsOf(found, time)

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

    return (
      <Box flexDirection="row">
        {beside}
        {hasBeside ? <Text dimColor> · </Text> : null}
        {segmentView(fiveHour)}
        <Text dimColor> · </Text>
        {segmentView(week)}
      </Box>
    )
  })
}
