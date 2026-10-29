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

type Account = { emailAddress?: string; organizationName?: string }
type WorldOptions = {
  usageFails?: boolean
  storeFails?: boolean
  opaqueFooter?: boolean
  account?: Account
  accountFails?: boolean
  configDir?: string
  rawConfig?: string
}
type World = {
  clock: ReturnType<typeof mock.clock>
  store: Record<string, unknown>
  reads: string[]
  options: WorldOptions
}

// Stands for the engine beneath the mod: clock, store, session usage and the
// footer the engine draws by itself. The environment and the account file are
// synthetic too, so no test reads the real `.claude.json` of the machine.
function world(on: On, rateLimits: SessionRateLimit[] = LIMITS, options: WorldOptions = {}): World {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/test', ...(options.configDir ? { CLAUDE_CONFIG_DIR: options.configDir } : {}) })
  const reads: string[] = []
  const expectedPath = `${options.configDir ?? '/home/test'}/.claude.json`
  on('fs.read', (_$, e) => {
    reads.push(e.path)
    if (options.accountFails) throw new Error('read failed')
    if (options.rawConfig !== undefined && e.path === expectedPath) return { value: options.rawConfig }
    if (options.account && e.path === expectedPath) {
      return { value: JSON.stringify({ oauthAccount: options.account }) }
    }

    throw Object.assign(new Error(`ENOENT: ${e.path}`), { code: 'ENOENT' })
  })
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

  return { clock, store, reads, options }
}

const startSession = ($: Engine) => $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
const footer = ($: Engine, modes: string[] = [], columns?: number) =>
  $.ui.mount({
    plugin: 'uso-suscripcion',
    surface: 'terminal',
    component: 'SessionMode',
    props: { modes },
    ...(columns !== undefined && { viewport: { columns, rows: 24 } }),
  })

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

// Account in the footer

const ACCOUNT: Account = { emailAddress: 'persona@ejemplo.com', organizationName: 'Ejemplo S.L.' }
const EMAIL = 'persona@ejemplo.com'
const ORG = 'Ejemplo S.L.'

test('with an account and readings, the email and organization come before the bars', async ($, on) => {
  world(on, LIMITS, { account: ACCOUNT, opaqueFooter: true })
  await startSession($)
  const ui = await footer($, [], 150)
  const all = await ui.findAll({ type: 'Text' })
  const order = all.map(node => node.text)
  const email = await ui.find({ type: 'Text', text: EMAIL })
  const org = await ui.find({ type: 'Text', text: ORG })

  expect(email).toBeDefined()
  expect(order.indexOf(EMAIL)).toBeLessThan(order.indexOf('5h '))
  expect(org?.props.dimColor).toBe(true)
  expect(email?.props.dimColor).toBeUndefined()
  expect(email?.props.color).toBeUndefined()
  expect(await ui.findAll(SEPARATOR)).toHaveLength(3)
})

test('with something beside, the account adds one more separator', async ($, on) => {
  world(on, LIMITS, { account: ACCOUNT })
  await startSession($)
  const ui = await footer($, [], 150)

  expect(await ui.find({ key: 'engine' })).toBeDefined()
  expect(await ui.findAll(SEPARATOR)).toHaveLength(4)
})

test('with an account and no readings, only the account is added', async ($, on) => {
  world(on, [], { account: ACCOUNT })
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: EMAIL })).toBeDefined()
  expect(await ui.find({ key: 'engine' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '5h ' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '–' })).toBeUndefined()
})

test('without anything beside, the account opens the row with no leading separator', async ($, on) => {
  world(on, LIMITS, { account: ACCOUNT, opaqueFooter: true })
  await startSession($)
  const ui = await footer($)

  expect(await ui.findAll(SEPARATOR)).toHaveLength(3)
})

test('with only an email there is no separator between it and the organization', async ($, on) => {
  world(on, LIMITS, { account: { emailAddress: EMAIL }, opaqueFooter: true })
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: EMAIL })).toBeDefined()
  expect(await ui.findAll(SEPARATOR)).toHaveLength(2)
})

test('with only an organization it is not dimmed', async ($, on) => {
  world(on, LIMITS, { account: { organizationName: ORG }, opaqueFooter: true })
  await startSession($)
  const ui = await footer($)

  const org = await ui.find({ type: 'Text', text: ORG })
  expect(org).toBeDefined()
  expect(org?.props.dimColor).toBeFalsy()
})

test('an organization that is the default one of a personal account is not shown', async ($, on) => {
  world(on, LIMITS, { account: { emailAddress: EMAIL, organizationName: `${EMAIL}'s Organization` } })
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: EMAIL })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: `${EMAIL}'s Organization` })).toBeUndefined()
})

test('a non-Latin organization is shown as it is', async ($, on) => {
  world(on, LIMITS, { account: { emailAddress: EMAIL, organizationName: '株式会社サンプル' } })
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: '株式会社サンプル' })).toBeDefined()
})

test('line breaks in the email are removed', async ($, on) => {
  world(on, LIMITS, { account: { emailAddress: 'persona@ejemplo.com\nX-Injected: 1' } })
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: /\n/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /persona@ejemplo\.comX-Injected: 1/ })).toBeDefined()
})

test('if reading the account fails, the session starts and only the meter shows', async ($, on) => {
  world(on, LIMITS, { account: ACCOUNT, accountFails: true })
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: ' 24%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 87%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: EMAIL })).toBeUndefined()
})

test('reads the account of the profile in CLAUDE_CONFIG_DIR, or of HOME without it', async ($, on) => {
  const withDir = world(on, LIMITS, { account: ACCOUNT, configDir: '/perfiles/meso' })
  await startSession($)

  expect(withDir.reads).toContain('/perfiles/meso/.claude.json')
  expect(withDir.reads).not.toContain('/home/test/.claude.json')
})

test('without CLAUDE_CONFIG_DIR it reads the file in HOME', async ($, on) => {
  const w = world(on, LIMITS, { account: ACCOUNT })
  await startSession($)
  const ui = await footer($)

  expect(w.reads).toEqual(['/home/test/.claude.json'])
  expect(await ui.find({ type: 'Text', text: EMAIL })).toBeDefined()
})

test('the account is never persisted', async ($, on) => {
  const w = world(on, LIMITS, { account: ACCOUNT })
  await startSession($)

  expect('account' in w.store).toBe(false)
  expect(JSON.stringify(w.store)).not.toContain(EMAIL)
})

test('at 45 columns the organization is dropped and the email is shortened, keeping the domain', async ($, on) => {
  world(on, LIMITS, {
    account: { emailAddress: 'persona.larguisimo@ejemplo.com', organizationName: ORG },
    opaqueFooter: true,
  })
  await startSession($)
  const ui = await footer($, [], 45)

  expect(await ui.find({ type: 'Text', text: ORG })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'persona.larg…@ejemplo.com' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 24%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 87%' })).toBeDefined()
  // Only the one between the bars: nothing hangs after the account.
  expect(await ui.findAll(SEPARATOR)).toHaveLength(1)
})

test('at 38 columns the email is at most 18 characters and the bars stay whole', async ($, on) => {
  world(on, LIMITS, {
    account: { emailAddress: 'persona.larguisimo@ejemplo.com', organizationName: ORG },
    opaqueFooter: true,
  })
  await startSession($)
  const ui = await footer($, [], 38)
  const shortened = await ui.find({ type: 'Text', text: /^.+…@ejemplo\.com$/ })

  expect(shortened).toBeDefined()
  expect(shortened!.text!.length).toBeLessThanOrEqual(18)
  expect(await ui.find({ type: 'Text', text: ORG })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: ' 24%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 87%' })).toBeDefined()
  expect(await ui.findAll(SEPARATOR)).toHaveLength(1)
})

test('without a viewport the terminal truncates: the email in the middle, the organization at the end', async ($, on) => {
  world(on, LIMITS, { account: ACCOUNT })
  await startSession($)
  const ui = await footer($)

  expect((await ui.find({ type: 'Text', text: EMAIL }))?.props.wrap).toBe('truncate-middle')
  expect((await ui.find({ type: 'Text', text: ORG }))?.props.wrap).toBe('truncate-end')
})

test('profile A shows only its own account and reads only its own file', async ($, on) => {
  const w = world(on, LIMITS, { account: { emailAddress: 'a@ejemplo.com' }, configDir: '/perfiles/a' })
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: 'a@ejemplo.com' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'b@ejemplo.org' })).toBeUndefined()
  expect(w.reads).toEqual(['/perfiles/a/.claude.json'])
})

test('profile B shows only its own account and never reads the file of A', async ($, on) => {
  const w = world(on, LIMITS, { account: { emailAddress: 'b@ejemplo.org' }, configDir: '/perfiles/b' })
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: 'b@ejemplo.org' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'a@ejemplo.com' })).toBeUndefined()
  expect(w.reads).not.toContain('/perfiles/a/.claude.json')
})

test('a second start whose read fails drops the account of the first', async ($, on) => {
  const w = world(on, LIMITS, { account: ACCOUNT })
  await startSession($)
  expect(await (await footer($)).find({ type: 'Text', text: EMAIL })).toBeDefined()

  w.options.accountFails = true
  await startSession($)

  expect(await (await footer($)).find({ type: 'Text', text: EMAIL })).toBeUndefined()
})

test('with an account, each window is unbreakable and the bars wrap between windows', async ($, on) => {
  world(on, LIMITS, { account: ACCOUNT })
  await startSession($)
  const ui = await footer($, [], 150)
  const boxes = await ui.findAll({ type: 'Box' })
  const bars = boxes.find(box => box.key === 'uso-barras')
  const windows = boxes.filter(box => box.props.flexShrink === 0 && box.key !== 'uso-barras')

  expect(bars?.props.flexWrap).toBe('wrap')
  expect(windows).toHaveLength(2)
})

const LONG_EMAIL = 'persona.larguisimo@ejemplo.com'

test('at 90 columns the organization is dropped but the account and the bars share one row', async ($, on) => {
  world(on, LIMITS, { account: { emailAddress: LONG_EMAIL, organizationName: ORG }, opaqueFooter: true })
  await startSession($)
  const ui = await footer($, [], 90)

  expect(await ui.find({ type: 'Text', text: ORG })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: LONG_EMAIL })).toBeDefined()
  expect((await ui.findAll({ type: 'Box' }))[0].props.flexDirection).toBe('row')
  expect(await ui.findAll(SEPARATOR)).toHaveLength(2)
})

test('from 100 columns the organization is back', async ($, on) => {
  world(on, LIMITS, { account: { emailAddress: LONG_EMAIL, organizationName: ORG }, opaqueFooter: true })
  await startSession($)
  const ui = await footer($, [], 100)

  expect(await ui.find({ type: 'Text', text: ORG })).toBeDefined()
})

test('the bars stack under the account below 80 columns and not at exactly 80', async ($, on) => {
  world(on, LIMITS, { account: { emailAddress: LONG_EMAIL, organizationName: ORG }, opaqueFooter: true })
  await startSession($)
  const rootOf = async (columns: number) => (await (await footer($, [], columns)).findAll({ type: 'Box' }))[0]

  expect((await rootOf(79)).props.flexDirection).toBe('column')
  expect((await rootOf(80)).props.flexDirection).toBe('row')
})

test('a narrow terminal with an account and no readings does not stack', async ($, on) => {
  world(on, [], { account: { emailAddress: LONG_EMAIL, organizationName: ORG }, opaqueFooter: true })
  await startSession($)
  const ui = await footer($, [], 45)

  expect((await ui.findAll({ type: 'Box' }))[0].props.flexDirection).toBe('row')
  expect(await ui.find({ type: 'Text', text: 'persona.larg…@ejemplo.com' })).toBeDefined()
})

test('a config file that is not JSON starts the session and shows the meter alone', async ($, on) => {
  world(on, LIMITS, { opaqueFooter: true, rawConfig: '{no es json' })
  await startSession($)
  const ui = await footer($)

  expect(await ui.find({ type: 'Text', text: ' 24%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ORG })).toBeUndefined()
})
