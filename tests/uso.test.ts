import { describe, expect, test } from 'claude-code/testing'
import type { SessionRateLimit } from 'claude-code'

import {
  accountFilePath,
  accountFitOf,
  accountLabelOf,
  accountOfConfig,
  barOf,
  clampPercent,
  formatReset,
  isUsageWindowList,
  levelOf,
  segmentOf,
  segmentsOf,
  shortenEmail,
  windowsOf,
} from '../hooks/uso'
import type { UsageWindow } from '../types'

// Thursday 2026-01-15 16:00 UTC (17:00 in Madrid, winter time).
const THURSDAY_ISO = '2026-01-15T16:00:00Z'
const BEFORE = Date.parse('2026-01-15T10:00:00Z')

const window = (overrides: Partial<UsageWindow> = {}): UsageWindow => ({
  kind: 'five_hour',
  percentUsed: 24,
  resetsAt: THURSDAY_ISO,
  ...overrides,
})

const limit = (kind: string, percentUsed: number): SessionRateLimit =>
  ({ kind, percentUsed, resetsAt: THURSDAY_ISO }) as SessionRateLimit

describe('segmentsOf', () => {
  test('builds both windows', async () => {
    const segments = segmentsOf(
      [window(), window({ kind: 'seven_day', percentUsed: 87 })],
      BEFORE,
      'Europe/Madrid',
    )

    expect(segments).toEqual([
      { label: '5h', missing: false, percent: 24, filled: '▓▓', empty: '░░░░░░░░', level: 'ok', reset: '17:00' },
      {
        label: 'semana',
        missing: false,
        percent: 87,
        filled: '▓▓▓▓▓▓▓▓',
        empty: '░░',
        level: 'critical',
        reset: 'jue. 17:00',
      },
    ])
  })

  test('marks the week as missing when only the 5h window exists', async () => {
    const segments = segmentsOf([window()], BEFORE, 'UTC')

    expect(segments[0]).toMatchObject({ label: '5h', missing: false })
    expect(segments[1]).toEqual({ label: 'semana', missing: true })
  })

  test('returns two missing segments for an empty list', async () => {
    expect(segmentsOf([], BEFORE, 'UTC')).toEqual([
      { label: '5h', missing: true },
      { label: 'semana', missing: true },
    ])
  })
})

describe('segmentOf', () => {
  test('caps above 100 with a full bar', async () => {
    const segment = segmentOf(window({ percentUsed: 130 }), 'five_hour', BEFORE, 'UTC')

    expect(segment).toMatchObject({ percent: 100, filled: '▓'.repeat(10), empty: '', level: 'critical' })
  })

  test('floors negatives at 0', async () => {
    expect(segmentOf(window({ percentUsed: -5 }), 'five_hour', BEFORE, 'UTC')).toMatchObject({
      percent: 0,
      filled: '',
      level: 'ok',
    })
  })

  test('rounds 49.4 down to 49 and keeps it ok', async () => {
    expect(segmentOf(window({ percentUsed: 49.4 }), 'five_hour', BEFORE, 'UTC')).toMatchObject({
      percent: 49,
      level: 'ok',
    })
  })

  test('shows 0 % without reset once the reset time has passed', async () => {
    const after = Date.parse('2026-01-15T16:00:01Z')
    const segment = segmentOf(window({ percentUsed: 90 }), 'five_hour', after, 'UTC')

    expect(segment).toEqual({
      label: '5h',
      missing: false,
      percent: 0,
      filled: '',
      empty: '░'.repeat(10),
      level: 'ok',
      reset: undefined,
    })
  })

  test('omits reset when the window has no resetsAt', async () => {
    const segment = segmentOf(window({ resetsAt: undefined }), 'five_hour', BEFORE, 'UTC')

    expect(segment).toMatchObject({ missing: false, reset: undefined })
  })
})

describe('levelOf', () => {
  test('is ok below 50, warning below 80 and critical from 80', async () => {
    expect([0, 49].map(levelOf)).toEqual(['ok', 'ok'])
    expect([50, 79].map(levelOf)).toEqual(['warning', 'warning'])
    expect([80, 100].map(levelOf)).toEqual(['critical', 'critical'])
  })
})

describe('clampPercent and barOf', () => {
  test('clamps to 0..100', async () => {
    expect(clampPercent(130)).toBe(100)
    expect(clampPercent(-5)).toBe(0)
    expect(clampPercent(49.5)).toBe(50)
  })

  test('draws 24 % as two filled cells and eight empty ones', async () => {
    expect(barOf(24)).toEqual({ filled: '▓▓', empty: '░░░░░░░░' })
  })

  test('honours a custom width', async () => {
    expect(barOf(50, 4)).toEqual({ filled: '▓▓', empty: '░░' })
  })
})

describe('formatReset', () => {
  test('formats the 5h window as HH:MM in the given zone', async () => {
    expect(formatReset(THURSDAY_ISO, 'five_hour', 'UTC')).toBe('16:00')
    expect(formatReset(THURSDAY_ISO, 'five_hour', 'Europe/Madrid')).toBe('17:00')
  })

  test('formats the week with the Spanish weekday', async () => {
    expect(formatReset(THURSDAY_ISO, 'seven_day', 'Europe/Madrid')).toBe('jue. 17:00')
    expect(formatReset(THURSDAY_ISO, 'seven_day', 'UTC')).toBe('jue. 16:00')
  })

  test('crosses midnight into the next weekday', async () => {
    expect(formatReset('2026-01-15T23:30:00Z', 'seven_day', 'Europe/Madrid')).toBe('vie. 00:30')
  })

  test('returns undefined for an invalid date', async () => {
    expect(formatReset('no es una fecha', 'five_hour', 'UTC')).toBeUndefined()
  })
})

describe('windowsOf', () => {
  test('orders 5h before the week and ignores unknown kinds', async () => {
    const windows = windowsOf([limit('seven_day', 87), limit('seven_day_opus', 10), limit('five_hour', 24)])

    expect(windows.map(one => one.kind)).toEqual(['five_hour', 'seven_day'])
    expect(windows.map(one => one.percentUsed)).toEqual([24, 87])
  })

  test('drops windows whose percentage is not finite', async () => {
    expect(windowsOf([limit('five_hour', Number.NaN), limit('seven_day', 10)]).map(one => one.kind)).toEqual([
      'seven_day',
    ])
  })
})

describe('isUsageWindowList', () => {
  test('accepts a valid list, with or without resetsAt', async () => {
    expect(isUsageWindowList([])).toBe(true)
    expect(isUsageWindowList([window(), { kind: 'seven_day', percentUsed: 3 }])).toBe(true)
  })

  test('rejects null, non-arrays, objects without kind and string percentages', async () => {
    expect(isUsageWindowList(null)).toBe(false)
    expect(isUsageWindowList({})).toBe(false)
    expect(isUsageWindowList([null])).toBe(false)
    expect(isUsageWindowList([{ percentUsed: 5 }])).toBe(false)
    expect(isUsageWindowList([{ kind: 'five_hour', percentUsed: '5' }])).toBe(false)
    expect(isUsageWindowList([{ kind: 'other', percentUsed: 5 }])).toBe(false)
    expect(isUsageWindowList([{ kind: 'five_hour', percentUsed: Number.NaN }])).toBe(false)
    expect(isUsageWindowList([{ kind: 'five_hour', percentUsed: 5, resetsAt: 7 }])).toBe(false)
  })
})

describe('casos límite adicionales', () => {
  test('a window whose reset is exactly now already counts as reset', async () => {
    const segment = segmentOf(window({ percentUsed: 90 }), 'five_hour', Date.parse(THURSDAY_ISO), 'UTC')

    expect(segment).toMatchObject({ percent: 0, level: 'ok', reset: undefined })
  })

  test('an unparseable resetsAt keeps the percentage and shows no reset', async () => {
    const segment = segmentOf(window({ percentUsed: 60, resetsAt: 'basura' }), 'five_hour', BEFORE, 'UTC')

    expect(segment).toMatchObject({ percent: 60, level: 'warning', reset: undefined })
  })

  test('rounds 79.5 up to 80 and turns it critical', async () => {
    expect(segmentOf(window({ percentUsed: 79.5 }), 'five_hour', BEFORE, 'UTC')).toMatchObject({
      percent: 80,
      level: 'critical',
    })
  })

  test('draws 0 % as an empty bar and 100 % as a full one', async () => {
    expect(barOf(0)).toEqual({ filled: '', empty: '░'.repeat(10) })
    expect(barOf(100)).toEqual({ filled: '▓'.repeat(10), empty: '' })
  })

  test('draws 99 % with nine filled cells', async () => {
    expect(barOf(99)).toEqual({ filled: '▓'.repeat(9), empty: '░' })
  })

  test('segmentsOf marks only the 5h window as missing when only the week exists', async () => {
    const segments = segmentsOf([window({ kind: 'seven_day', percentUsed: 10 })], BEFORE, 'UTC')

    expect(segments[0]).toEqual({ label: '5h', missing: true })
    expect(segments[1]).toMatchObject({ label: 'semana', missing: false, percent: 10 })
  })

  test('windowsOf returns nothing for an empty list or only unknown kinds', async () => {
    expect(windowsOf([])).toEqual([])
    expect(windowsOf([limit('seven_day_opus', 10)])).toEqual([])
  })

  test('windowsOf drops Infinity percentages', async () => {
    expect(windowsOf([limit('five_hour', Number.POSITIVE_INFINITY)])).toEqual([])
  })

  test('isUsageWindowList rejects a list with one invalid item among valid ones', async () => {
    expect(isUsageWindowList([window(), { kind: 'five_hour' }])).toBe(false)
    expect(isUsageWindowList('texto')).toBe(false)
  })
})

describe('accountFilePath', () => {
  test('prefers the config dir and strips trailing slashes', async () => {
    expect(accountFilePath('/perfiles/meso/', '/home/test')).toBe('/perfiles/meso/.claude.json')
  })

  test('falls back to home when the config dir is missing or blank', async () => {
    expect(accountFilePath(undefined, '/home/test')).toBe('/home/test/.claude.json')
    expect(accountFilePath('  ', '/home/test')).toBe('/home/test/.claude.json')
  })

  test('is undefined without any directory', async () => {
    expect(accountFilePath('', undefined)).toBeUndefined()
  })
})

describe('accountLabelOf', () => {
  test('trims and keeps both parts', async () => {
    expect(accountLabelOf({ email: ' persona@ejemplo.com\n', organization: 'Ejemplo S.L.' })).toEqual({
      email: 'persona@ejemplo.com',
      organization: 'Ejemplo S.L.',
    })
  })

  test('omits an organization that repeats the email, ignoring case', async () => {
    expect(
      accountLabelOf({ email: 'persona@ejemplo.com', organization: "Persona@Ejemplo.com's Organization" }),
    ).toEqual({ email: 'persona@ejemplo.com' })
  })

  test('keeps only the organization when there is no email', async () => {
    expect(accountLabelOf({ organization: 'Ejemplo S.L.' })).toEqual({ organization: 'Ejemplo S.L.' })
  })

  test('returns null for empty, blank or non-string values', async () => {
    expect(accountLabelOf({ email: '', organization: '  ' })).toBeNull()
    expect(accountLabelOf({ email: 42 })).toBeNull()
    expect(accountLabelOf({})).toBeNull()
  })

  test('does not alter non-Latin organizations', async () => {
    expect(accountLabelOf({ organization: '株式会社サンプル' })).toEqual({ organization: '株式会社サンプル' })
    expect(accountLabelOf({ organization: 'Пример ООО' })).toEqual({ organization: 'Пример ООО' })
  })

  test('strips control characters', async () => {
    const label = accountLabelOf({ email: 'per\tsona@ejemplo.com', organization: 'Ej\u001b[31mem\u2028plo' })

    expect(label).toEqual({ email: 'persona@ejemplo.com', organization: 'Ej[31memplo' })
    expect(JSON.stringify(label)).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/)
  })

  test('strips invisible and bidi format characters', async () => {
    const label = accountLabelOf({ email: 'persona​@ejemplo.com﻿', organization: 'Ejemplo‮ S.L.⁦' })

    expect(label).toEqual({ email: 'persona@ejemplo.com', organization: 'Ejemplo S.L.' })
  })
})

describe('accountOfConfig', () => {
  test('extracts the label from a complete config and nothing else', async () => {
    const text = JSON.stringify({
      numStartups: 3,
      oauthAccount: { emailAddress: 'persona@ejemplo.com', organizationName: 'Ejemplo S.L.', accountUuid: 'x' },
      primaryApiKey: 'sk-ficticia',
      mcpServers: { demo: { command: 'demo', env: { TOKEN: 'token-ficticio' } } },
    })

    const label = accountOfConfig(text)

    expect(label).toEqual({ email: 'persona@ejemplo.com', organization: 'Ejemplo S.L.' })
    expect(JSON.stringify(label)).not.toMatch(/ficti|accountUuid|mcpServers/)
  })

  test('returns null for invalid JSON, missing or null oauthAccount and numeric fields', async () => {
    expect(accountOfConfig('{no es json')).toBeNull()
    expect(accountOfConfig('{}')).toBeNull()
    expect(accountOfConfig('null')).toBeNull()
    expect(accountOfConfig('{"oauthAccount":null}')).toBeNull()
    expect(accountOfConfig('{"oauthAccount":"texto"}')).toBeNull()
    expect(accountOfConfig('{"oauthAccount":{"emailAddress":1,"organizationName":2}}')).toBeNull()
  })
})

describe('shortenEmail', () => {
  test('keeps the domain and cuts the local part', async () => {
    expect(shortenEmail('persona.larguisimo@ejemplo.com', 25)).toBe('persona.larg…@ejemplo.com')
  })

  test('leaves an email that fits', async () => {
    expect(shortenEmail('persona@ejemplo.com', 25)).toBe('persona@ejemplo.com')
  })

  test('cuts in the middle when the domain does not fit', async () => {
    const short = shortenEmail('ana@departamento.ejemplo-corporativo.com', 18)

    expect(short).toBe('ana@depar…tivo.com')
    expect(short).toHaveLength(18)
  })

  test('returns non-ASCII emails unchanged', async () => {
    expect(shortenEmail('界界界界界界界界界界@ejemplo.com', 10)).toBe('界界界界界界界界界界@ejemplo.com')
  })
})

describe('accountFitOf', () => {
  const label = { email: 'persona.larguisimo@ejemplo.com', organization: 'Ejemplo S.L.' }

  test('keeps everything on wide terminals or without columns', async () => {
    expect(accountFitOf(label, 150)).toEqual({ ...label, stacked: false })
    expect(accountFitOf(label)).toEqual({ ...label, stacked: false })
  })

  test('drops the organization below 100 columns without stacking from 80', async () => {
    expect(accountFitOf(label, 90)).toEqual({ email: label.email, stacked: false })
  })

  test('stacks below 80 columns and shortens the email to the available width', async () => {
    const fit = accountFitOf(label, 45)

    expect(fit).toEqual({ email: 'persona.larg…@ejemplo.com', stacked: true })
    expect(fit.email?.length).toBeLessThanOrEqual(25)
    expect(accountFitOf(label, 38).email?.length).toBeLessThanOrEqual(18)
  })

  test('never goes under the minimum email width', async () => {
    expect(accountFitOf(label, 20).email?.length).toBe(12)
  })

  test('keeps an organization-only label, stacked when narrow', async () => {
    expect(accountFitOf({ organization: 'Ejemplo S.L.' }, 45)).toEqual({ organization: 'Ejemplo S.L.', stacked: true })
  })
})

describe('límites de las cuentas (casos añadidos)', () => {
  const label = { email: 'persona.larguisimo@ejemplo.com', organization: 'Ejemplo S.L.' }

  test('accountFitOf: exactly 100 columns keeps the organization, 99 drops it', async () => {
    expect(accountFitOf(label, 100)).toEqual({ ...label, stacked: false })
    expect(accountFitOf(label, 99)).toEqual({ email: label.email, stacked: false })
  })

  test('accountFitOf: exactly 80 columns does not stack, 79 does', async () => {
    expect(accountFitOf(label, 80).stacked).toBe(false)
    expect(accountFitOf(label, 79).stacked).toBe(true)
  })

  test('accountFitOf: an organization-only label is kept whole between 80 and 99 columns', async () => {
    expect(accountFitOf({ organization: 'Ejemplo S.L.' }, 90)).toEqual({ organization: 'Ejemplo S.L.', stacked: false })
  })

  test('accountFitOf: an email that fits in the available cells is not shortened', async () => {
    expect(accountFitOf({ email: 'persona@ejemplo.com' }, 60)).toEqual({ email: 'persona@ejemplo.com', stacked: true })
  })

  test('shortenEmail: an email without "@" is cut in the middle', async () => {
    const short = shortenEmail('personasinarrobamuylarga', 10)

    expect(short).toHaveLength(10)
    expect(short).toBe('perso…arga')
  })

  test('shortenEmail: never goes under 3 cells', async () => {
    expect(shortenEmail('persona@ejemplo.com', 0)).toHaveLength(3)
    expect(shortenEmail('persona@ejemplo.com', -5)).toHaveLength(3)
  })

  test('shortenEmail: keeps the domain when it leaves exactly one character of local part', async () => {
    const short = shortenEmail('persona@ejemplo.com', 14)

    expect(short).toBe('p…@ejemplo.com')
  })

  test('shortenEmail: a domain too long for the width falls back to cutting in the middle', async () => {
    const short = shortenEmail('a@dominio-larguisimo.ejemplo.com', 10)

    expect(short).toHaveLength(10)
    expect(short).not.toMatch(/^a@dominio-larguisimo/)
    expect(short).toContain('…')
  })

  test('accountOfConfig: a JSON array or a scalar at the root gives null', async () => {
    expect(accountOfConfig('[]')).toBeNull()
    expect(accountOfConfig('"texto"')).toBeNull()
    expect(accountOfConfig('42')).toBeNull()
    expect(accountOfConfig('')).toBeNull()
  })

  test('accountOfConfig: an organization-only account is kept', async () => {
    expect(accountOfConfig('{"oauthAccount":{"organizationName":"Ejemplo S.L."}}')).toEqual({
      organization: 'Ejemplo S.L.',
    })
  })

  test('accountLabelOf: an email made only of invisible characters leaves the organization', async () => {
    expect(accountLabelOf({ email: '​‮', organization: 'Ejemplo S.L.' })).toEqual({ organization: 'Ejemplo S.L.' })
  })
})
