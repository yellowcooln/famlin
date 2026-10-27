import { summarizeOidcUrl } from '../oidcDiagnostics'

it('summarizes a callback without returning any OAuth code, state, token or URL', () => {
  const url = 'famlin://?code=FIXTURE_SECRET_CODE&state=FIXTURE_SECRET_STATE&id_token=FIXTURE_SECRET_TOKEN'
  const result = summarizeOidcUrl(url)
  expect(result).toEqual({
    hasUrl: true,
    route: 'root',
    hasCode: true,
    hasState: true,
    hasError: false,
    hasHandoff: false,
  })
  expect(JSON.stringify(result)).not.toMatch(/FIXTURE_SECRET|famlin:\/\//)
})

it('persists only allowlisted event fields for explicitly enabled diagnostic builds', async () => {
  jest.resetModules()
  process.env.EXPO_PUBLIC_OIDC_DIAGNOSTICS = '1'
  const storage = jest.requireMock('@react-native-async-storage/async-storage')
  await storage.clear()
  const diag = jest.requireActual('../oidcDiagnostics') as typeof import('../oidcDiagnostics')
  diag.recordOidcDiagnostic('browser_result', {
    result: 'dismiss',
    hasCode: true,
    url: 'FIXTURE_SECRET_URL',
    token: 'FIXTURE_SECRET_TOKEN',
    state: 'FIXTURE_SECRET_STATE',
    resultOther: 'FIXTURE_SECRET_OTHER',
  })
  const text = await diag.readOidcDiagnostics()
  const parsed = JSON.parse(text)
  expect(parsed.events).toHaveLength(1)
  expect(parsed.events[0]).toMatchObject({ stage: 'browser_result', result: 'dismiss', hasCode: true })
  expect(text).not.toContain('FIXTURE_SECRET')
  expect(storage.setItem).toHaveBeenCalled()
  delete process.env.EXPO_PUBLIC_OIDC_DIAGNOSTICS
})

it('records warm and cold callbacks without secrets and installs observers only once', async () => {
  jest.resetModules()
  process.env.EXPO_PUBLIC_OIDC_DIAGNOSTICS = '1'
  const storage = jest.requireMock('@react-native-async-storage/async-storage')
  await storage.clear()
  const rn = jest.requireActual('react-native') as typeof import('react-native')
  let link: ((event: { url: string }) => void) | undefined
  let state: ((value: import('react-native').AppStateStatus) => void) | undefined
  jest.spyOn(rn.Linking, 'addEventListener').mockImplementation((_name, listener) => {
    link = listener
    return { remove: () => {} } as ReturnType<typeof rn.Linking.addEventListener>
  })
  jest.spyOn(rn.AppState, 'addEventListener').mockImplementation((_name, listener) => {
    state = listener
    return { remove: jest.fn() }
  })
  jest
    .spyOn(rn.Linking, 'getInitialURL')
    .mockResolvedValue('famlin://?code=FIXTURE_SECRET_COLD&state=FIXTURE_SECRET_STATE')
  const diag = jest.requireActual('../oidcDiagnostics') as typeof import('../oidcDiagnostics')
  try {
    diag.startOidcDiagnostics()
    diag.startOidcDiagnostics()
    link?.({ url: 'famlin://?code=FIXTURE_SECRET_WARM&state=FIXTURE_SECRET_STATE' })
    state?.('background')
    await Promise.resolve()
    const text = await diag.readOidcDiagnostics()
    const events = JSON.parse(text).events as { stage: string; hasCode?: boolean }[]
    expect(events.filter((x) => x.stage === 'runtime_start')).toHaveLength(1)
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'url_event', hasCode: true }),
        expect.objectContaining({ stage: 'initial_url', hasCode: true }),
        expect.objectContaining({ stage: 'app_state' }),
      ])
    )
    expect(rn.Linking.addEventListener).toHaveBeenCalledTimes(1)
    expect(text).not.toContain('FIXTURE_SECRET')
  } finally {
    jest.restoreAllMocks()
    delete process.env.EXPO_PUBLIC_OIDC_DIAGNOSTICS
  }
})

it('collects and persists nothing when diagnostics are not enabled', async () => {
  jest.resetModules()
  delete process.env.EXPO_PUBLIC_OIDC_DIAGNOSTICS
  const storage = jest.requireMock('@react-native-async-storage/async-storage')
  await storage.clear()
  storage.setItem.mockClear()
  storage.getItem.mockClear()
  const diag = jest.requireActual('../oidcDiagnostics') as typeof import('../oidcDiagnostics')
  diag.startOidcDiagnostics()
  diag.recordOidcDiagnostic('auth_begin', { usesClientSecret: false })
  expect(JSON.parse(await diag.readOidcDiagnostics()).events).toEqual([])
  expect(storage.setItem).not.toHaveBeenCalled()
  expect(storage.getItem).not.toHaveBeenCalled()
})

it('bounds persisted history and recovers it safely after a runtime reload', async () => {
  jest.resetModules()
  process.env.EXPO_PUBLIC_OIDC_DIAGNOSTICS = '1'
  const storage = jest.requireMock('@react-native-async-storage/async-storage')
  await storage.clear()
  let diag = jest.requireActual('../oidcDiagnostics') as typeof import('../oidcDiagnostics')
  for (let i = 0; i < 120; i++) diag.recordOidcDiagnostic('browser_result', { result: 'dismiss' })
  const before = JSON.parse(await diag.readOidcDiagnostics())
  expect(before.events).toHaveLength(80)
  const persisted = await storage.getItem('famlin:oidc-diagnostics:v1')
  jest.resetModules()
  const freshStorage = jest.requireMock('@react-native-async-storage/async-storage')
  const rows = JSON.parse(persisted)
  rows[0].url = 'FIXTURE_SECRET_STORED_URL'
  rows[0].token = 'FIXTURE_SECRET_STORED_TOKEN'
  await freshStorage.setItem('famlin:oidc-diagnostics:v1', JSON.stringify(rows))
  diag = jest.requireActual('../oidcDiagnostics') as typeof import('../oidcDiagnostics')
  const text = await diag.readOidcDiagnostics()
  expect(JSON.parse(text).events).toHaveLength(80)
  expect(text).not.toContain('FIXTURE_SECRET')
  delete process.env.EXPO_PUBLIC_OIDC_DIAGNOSTICS
})

it('keeps a usable in-memory report if diagnostic storage fails', async () => {
  jest.resetModules()
  process.env.EXPO_PUBLIC_OIDC_DIAGNOSTICS = '1'
  const storage = jest.requireMock('@react-native-async-storage/async-storage')
  await storage.clear()
  storage.setItem.mockRejectedValueOnce(new Error('fixture storage failure'))
  const diag = jest.requireActual('../oidcDiagnostics') as typeof import('../oidcDiagnostics')
  expect(() => diag.recordOidcDiagnostic('auth_begin')).not.toThrow()
  const report = JSON.parse(await diag.readOidcDiagnostics())
  expect(report.storageUnavailable).toBe(true)
  expect(report.events).toHaveLength(1)
  delete process.env.EXPO_PUBLIC_OIDC_DIAGNOSTICS
})
