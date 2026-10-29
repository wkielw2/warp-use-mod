import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'

const NOW = Date.parse('2026-10-12T10:00:00Z')
const HOUR = 3_600_000
const TICK_MS = 60_000
const at = (ms: number) => new Date(NOW + ms).toISOString()

const FIVE_HOUR: SessionRateLimit = { kind: 'five_hour', percentUsed: 24, resetsAt: at(2 * HOUR) }
const SEVEN_DAY: SessionRateLimit = { kind: 'seven_day', percentUsed: 87, resetsAt: at(76 * HOUR) }
const LIMITS: SessionRateLimit[] = [FIVE_HOUR, SEVEN_DAY]

type World = { clock: ReturnType<typeof mock.clock>; store: Record<string, unknown> }

// Stands for the engine beneath the mod: clock, store, session usage and the
// footer the engine draws by itself.
function world(
  on: On,
  rateLimits: SessionRateLimit[] = LIMITS,
  options: { usageFails?: boolean; storeFails?: boolean; opaqueFooter?: boolean } = {},
): World {
  const clock = mock.clock(on, { now: NOW })
  const store: Record<string, unknown> = {}
  on('store.get', (_$, e) => {
    if (options.storeFails) throw new Error('store unavailable')

    return { value: store[e.key] }
  })
  on('store.set', (_$, e) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => {
    if (options.usageFails) throw new Error('usage unavailable')

    return { value: { startedAt: NOW, context: { window: 200_000 }, rateLimits } as never }
  })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => {
    // The real engine answers with its own opaque drawing, not with elements.
    if (options.opaqueFooter) return { type: 'engine', ref: 0 } as never
    const { Box, Text } = $.ui.resolve(e)

    return 'hint' in e.props ? <Text>{e.props.hint}</Text> : <Box key="engine" />
  })

  return { clock, store }
}

const startSession = ($: Engine) => $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
const footer = ($: Engine, modes: string[] = []) =>
  $.ui.mount({ plugin: 'uso-suscripcion', surface: 'terminal', component: 'SessionMode', props: { modes } })

test('shows the 5h and week windows at the same time', async ($, on) => {
  world(on)
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: '5h ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '▓▓░░░░░░░░' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: ' 24%' }))?.props.color).toBe('success')
  expect(await ui.find({ type: 'Text', text: 'semana ' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: ' 87%' }))?.props.color).toBe('error')
  expect(await ui.find({ type: 'Text', text: /^ ↻\d\d:\d\d$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ ↻\S+ \d\d:\d\d$/ })).toBeDefined()
})

test('keeps showing both windows as the clock ticks', async ($, on) => {
  const w = world(on)
  await startSession($)
  await w.clock.advance(TICK_MS * 3)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: '5h ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 24%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'semana ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 87%' })).toBeDefined()
})

test('shows a dash for a window the engine does not report', async ($, on) => {
  world(on, [FIVE_HOUR])
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: ' 24%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'semana ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '–' })).toBeDefined()
})

test('without any window the engine draws its own footer', async ($, on) => {
  world(on, [])
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ key: 'engine' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '5h ' })).toBeUndefined()
})

test('a new measurement shows at once and is kept for the next session', async ($, on) => {
  const w = world(on, [])
  await startSession($)
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [{ ...FIVE_HOUR, percentUsed: 91 }],
    changed: ['rateLimits'],
  } as never)
  const ui = await footer($)

  expect((await ui.find({ type: 'Text', text: ' 91%' }))?.props.color).toBe('error')
  expect(w.store.limits).toEqual([{ ...FIVE_HOUR, percentUsed: 91 }])
})

test('shows what was saved in a new session that has no reading yet', async ($, on) => {
  const w = world(on, [])
  w.store.limits = LIMITS
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: ' 24%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 87%' })).toBeDefined()
})

test('ignores a saved value with the wrong shape', async ($, on) => {
  const w = world(on, [])
  w.store.limits = [{ kind: 'five_hour', percentUsed: 'mucho' }]
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ key: 'engine' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '5h ' })).toBeUndefined()
})

test("keeps the engine's mode labels before the meter", async ($, on) => {
  world(on)
  await startSession($)
  const ui = await footer($, ['focus'])

  expect(await ui.find({ key: 'engine' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '5h ' })).toBeDefined()
})

test('keeps what the mods beneath draw even without mode labels', async ($, on) => {
  world(on)
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ key: 'engine' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '5h ' })).toBeDefined()
})

const SEPARATOR = { type: 'Text', text: ' · ' } as const

test('with mode labels there is one more separator, before the meter', async ($, on) => {
  world(on)
  await startSession($)
  const ui = await footer($, ['focus'])

  expect(await ui.findAll(SEPARATOR)).toHaveLength(2)
})

test('what another mod draws beneath is kept and separated from the meter, even without mode labels', async ($, on) => {
  const other = (mod: On) =>
    mod('ui.render', { component: 'SessionMode' }, ($, e) => {
      const { Text } = $.ui.resolve(e)

      return <Text>ctx 12k</Text>
    })
  other(on)
  world(on)
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: 'ctx 12k' })).toBeDefined()
  expect(await ui.findAll(SEPARATOR)).toHaveLength(2)
})

test('a window past its reset shows as empty', async ($, on) => {
  const w = world(on)
  await startSession($)
  await w.clock.set(NOW + 3 * HOUR)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: ' 0%' })).toBeDefined()
})

test('caps the percentage at 100', async ($, on) => {
  world(on, [{ ...FIVE_HOUR, percentUsed: 130 }, SEVEN_DAY])
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: ' 100%' })).toBeDefined()
})

test('if session.usage fails, the saved reading stays and still resets with the clock', async ($, on) => {
  const w = world(on, LIMITS, { usageFails: true })
  w.store.limits = LIMITS
  await startSession($)

  // The same mounted footer has to repaint on the tick, without a new render.
  const ui = await footer($)
  expect(await ui.find({ type: 'Text', text: ' 24%' })).toBeDefined()

  await w.clock.advance(3 * HOUR)

  expect(await ui.find({ type: 'Text', text: ' 0%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 87%' })).toBeDefined()
})

test('an empty measurement does not erase the last reading, in screen or in the store', async ($, on) => {
  const w = world(on)
  await startSession($)
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ['rateLimits'] } as never)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: ' 24%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 87%' })).toBeDefined()
  expect(w.store.limits).toEqual(LIMITS)
})

test('with no window at all nothing is written to the store', async ($, on) => {
  const w = world(on, [])
  await startSession($)

  expect('limits' in w.store).toBe(false)
})

test('uses warning color between 50 and 79 percent', async ($, on) => {
  world(on, [{ ...FIVE_HOUR, percentUsed: 65 }, SEVEN_DAY])
  await startSession($)
  const ui = await footer($)

  expect((await ui.find({ type: 'Text', text: ' 65%' }))?.props.color).toBe('warning')
})

test('shows a dash for the 5h window when only the week is reported', async ($, on) => {
  world(on, [SEVEN_DAY])
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: '5h ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '–' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 87%' })).toBeDefined()
})

test('a window past its reset shows no reset time', async ($, on) => {
  const w = world(on, [FIVE_HOUR, { ...SEVEN_DAY, resetsAt: at(100 * HOUR) }])
  await startSession($)
  await w.clock.set(NOW + 3 * HOUR)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: /^ ↻\d\d:\d\d$/ })).toBeUndefined()
})

test('if the store fails at start, the fresh reading still shows', async ($, on) => {
  world(on, LIMITS, { storeFails: true })
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: ' 24%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 87%' })).toBeDefined()
})

test('marks the critical level with a sign, not only with color', async ($, on) => {
  world(on)
  await startSession($)
  const ui = await footer($)

  const marks = await ui.findAll({ type: 'Text', text: '!' })
  expect(marks.length).toBe(1)
  expect(marks[0]?.props.color).toBe('error')
})

test('the reset time and the dash are not dimmed', async ($, on) => {
  world(on, [FIVE_HOUR])
  await startSession($)
  const ui = await footer($)

  expect((await ui.find({ type: 'Text', text: /^ ↻\d\d:\d\d$/ }))?.props.dimColor).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: '–' }))?.props.dimColor).toBeUndefined()
})

test('no sign below the critical level, up to 79 percent', async ($, on) => {
  world(on, [{ ...FIVE_HOUR, percentUsed: 79 }, { ...SEVEN_DAY, percentUsed: 65 }])
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: ' 79%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '!' })).toBeUndefined()
})

test('no sign when every window is ok', async ($, on) => {
  world(on, [FIVE_HOUR, { ...SEVEN_DAY, percentUsed: 10 }])
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: '!' })).toBeUndefined()
})

test('the sign starts at exactly 80 percent', async ($, on) => {
  world(on, [{ ...FIVE_HOUR, percentUsed: 80 }, { ...SEVEN_DAY, percentUsed: 10 }])
  await startSession($)
  const ui = await footer($)

  expect(await ui.findAll({ type: 'Text', text: '!' })).toHaveLength(1)
})

test('the sign shows on both windows when both are critical', async ($, on) => {
  world(on, [{ ...FIVE_HOUR, percentUsed: 95 }, SEVEN_DAY])
  await startSession($)
  const ui = await footer($)

  expect(await ui.findAll({ type: 'Text', text: '!' })).toHaveLength(2)
})

test('a missing window shows no sign', async ($, on) => {
  world(on, [FIVE_HOUR])
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: '!' })).toBeUndefined()
})

test('the clock keeps ticking when the store fails at start', async ($, on) => {
  const w = world(on, LIMITS, { storeFails: true })
  await startSession($)
  const ui = await footer($)
  expect(await ui.find({ type: 'Text', text: ' 24%' })).toBeDefined()

  await w.clock.advance(3 * HOUR)

  expect(await ui.find({ type: 'Text', text: ' 0%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 87%' })).toBeDefined()
})

test("the engine's own footer without mode labels gets no separator before the meter", async ($, on) => {
  world(on, LIMITS, { opaqueFooter: true })
  await startSession($)
  const ui = await footer($)

  expect(await ui.findAll(SEPARATOR)).toHaveLength(1)
})

test("the engine's own footer with mode labels is separated from the meter", async ($, on) => {
  world(on, LIMITS, { opaqueFooter: true })
  await startSession($)
  const ui = await footer($, ['focus'])

  expect(await ui.findAll(SEPARATOR)).toHaveLength(2)
})

test('the render and the session never read files, so the account in .claude.json is not shown', async ($, on) => {
  const w = world(on)
  const reads: string[] = []
  on('fs.read', (_$, e) => {
    reads.push(e.path)

    return { value: JSON.stringify({ oauthAccount: { emailAddress: 'someone@example.test', organizationName: 'Synthetic Org' } }) }
  })
  await startSession($)
  await w.clock.advance(TICK_MS)
  const ui = await footer($, ['plan'])

  expect(await ui.find({ type: 'Text', text: ' 24%' })).toBeDefined()
  expect(reads).toEqual([])
  expect(await ui.find({ type: 'Text', text: /someone@example\.test|Synthetic Org/ })).toBeUndefined()
})
