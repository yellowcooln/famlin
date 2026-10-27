import { Platform } from 'react-native'
import * as AuthSession from 'expo-auth-session'
import * as WebBrowser from 'expo-web-browser'
import { loginWithOidc, exchangeOidcMobileHandoff, OidcConfig } from '@/api/auth'
import { performOidcLogin, OidcCancelledError } from '../oidcLogin'

const mockLinkListeners = new Set<(event: { url: string }) => void>()

jest.mock('expo-linking', () => ({
  ...jest.requireActual('expo-linking'),
  addEventListener: jest.fn((_name: string, listener: (event: { url: string }) => void) => {
    mockLinkListeners.add(listener)
    return { remove: () => mockLinkListeners.delete(listener) }
  }),
}))
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }))
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { scheme: 'famlin' }, executionEnvironment: 'standalone' },
  ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
}))
jest.mock('expo-auth-session', () => ({
  ...jest.requireActual('expo-auth-session'),
  makeRedirectUri: () => 'famlin://',
  exchangeCodeAsync: jest.fn(),
}))
jest.mock('expo-crypto', () => {
  const crypto = jest.requireActual('crypto')
  return {
    getRandomValues: (bytes: Uint8Array) => crypto.randomFillSync(bytes),
    getRandomBytesAsync: async (size: number) => new Uint8Array(crypto.randomBytes(size)),
    digestStringAsync: async (_algorithm: string, value: string) =>
      crypto.createHash('sha256').update(value).digest('base64'),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    CryptoEncoding: { BASE64: 'base64' },
  }
})
jest.mock('@/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }))
jest.mock('@/api/auth', () => ({ loginWithOidc: jest.fn(), exchangeOidcMobileHandoff: jest.fn() }))

const config: OidcConfig = {
  enabled: true,
  name: 'Test provider',
  authorizationEndpoint: 'https://idp.example/authorize',
  tokenEndpoint: 'https://idp.example/token',
  clientId: 'test-client',
  scopes: 'openid email profile',
  usesClientSecret: false,
}
const session = { token: 'fixture-session', user: { id: 'fixture-user' } }

beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  mockLinkListeners.clear()
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true })
  jest
    .mocked(AuthSession.exchangeCodeAsync)
    .mockResolvedValue({ idToken: 'fixture-id-token' } as AuthSession.TokenResponse)
  jest.mocked(loginWithOidc).mockResolvedValue(session as Awaited<ReturnType<typeof loginWithOidc>>)
})
afterEach(() => {
  jest.useRealTimers()
})

it('completes PKCE when the valid Android callback arrives after browser dismissal', async () => {
  jest.mocked(WebBrowser.openAuthSessionAsync).mockImplementation(async (authUrl, returnUrl) => {
    const state = new URL(authUrl).searchParams.get('state')!
    setTimeout(() => {
      const url = `${returnUrl}?code=fixture-code&state=${encodeURIComponent(state)}`
      for (const listener of mockLinkListeners) listener({ url })
    }, 50)
    return { type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult
  })
  const outcome = performOidcLogin(config).then(
    (value) => ({ value }),
    (error: Error) => ({ error: error.constructor.name, message: error.message })
  )
  await jest.advanceTimersByTimeAsync(100)
  expect(await outcome).toEqual({ value: session })
  expect(AuthSession.exchangeCodeAsync).toHaveBeenCalledWith(
    expect.objectContaining({ code: 'fixture-code', extraParams: { code_verifier: expect.any(String) } }),
    expect.objectContaining({ tokenEndpoint: config.tokenEndpoint })
  )
  expect(loginWithOidc).toHaveBeenCalledWith('fixture-id-token', undefined)
  expect(mockLinkListeners.size).toBe(0)
})

it('completes server-mediated handoff when Android delivers its callback after dismissal', async () => {
  jest
    .mocked(exchangeOidcMobileHandoff)
    .mockResolvedValue(session as Awaited<ReturnType<typeof exchangeOidcMobileHandoff>>)
  jest.mocked(WebBrowser.openAuthSessionAsync).mockImplementation(async (authUrl, returnUrl) => {
    const state = new URL(authUrl).searchParams.get('state')!
    setTimeout(() => {
      const url = `${returnUrl}?handoff=fixture-handoff&state=${encodeURIComponent(state)}`
      for (const listener of mockLinkListeners) listener({ url })
    }, 50)
    return { type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult
  })
  const outcome = performOidcLogin({
    ...config,
    usesClientSecret: true,
    mobileCallbackUrl: 'https://family.example/api/auth/oidc/mobile-callback',
  }).then(
    (value) => ({ value }),
    (error: Error) => ({ error: error.constructor.name, message: error.message })
  )
  await jest.advanceTimersByTimeAsync(100)
  expect(await outcome).toEqual({ value: session })
  expect(exchangeOidcMobileHandoff).toHaveBeenCalledWith('fixture-handoff')
  expect(AuthSession.exchangeCodeAsync).not.toHaveBeenCalled()
  expect(mockLinkListeners.size).toBe(0)
})

it.each(['famlin://', 'famlin:/', 'famlin:', 'famlin:///'])(
  'rejects mismatched OAuth state for %s',
  async (callbackBase) => {
    jest.mocked(WebBrowser.openAuthSessionAsync).mockImplementation(async () => {
      setTimeout(() => {
        for (const listener of mockLinkListeners) listener({ url: `${callbackBase}?code=fixture-code&state=wrong` })
      }, 50)
      return { type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult
    })
    const outcome = performOidcLogin(config).catch((error: Error) => error.message)
    await jest.advanceTimersByTimeAsync(100)
    expect(await outcome).toContain('state')
    expect(AuthSession.exchangeCodeAsync).not.toHaveBeenCalled()
    expect(loginWithOidc).not.toHaveBeenCalled()
    expect(mockLinkListeners.size).toBe(0)
  }
)

it.each(['dismiss', 'cancel'] as const)('still cancels after %s when no callback arrives', async (type) => {
  jest.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({ type } as WebBrowser.WebBrowserAuthSessionResult)
  const outcome = performOidcLogin(config).catch((error: Error) => error)
  await jest.advanceTimersByTimeAsync(1001)
  expect(await outcome).toBeInstanceOf(OidcCancelledError)
  expect(AuthSession.exchangeCodeAsync).not.toHaveBeenCalled()
  expect(mockLinkListeners.size).toBe(0)
  expect(jest.getTimerCount()).toBe(0)
})

it('ignores invite links and lookalike callback routes even with the correct state', async () => {
  jest.mocked(WebBrowser.openAuthSessionAsync).mockImplementation(async (authUrl) => {
    const state = new URL(authUrl).searchParams.get('state')!
    setTimeout(() => {
      for (const url of [
        'famlin://invite/fixture',
        'famlin://other',
        'famlin://evil',
        'famlin:/extra',
        'famlin:////',
        'other:/',
        'https://example.com/',
      ]) {
        for (const listener of mockLinkListeners) listener({ url: `${url}?code=fixture-code&state=${state}` })
      }
    }, 50)
    return { type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult
  })
  const outcome = performOidcLogin(config).catch((error: Error) => error)
  await jest.advanceTimersByTimeAsync(1001)
  expect(await outcome).toBeInstanceOf(OidcCancelledError)
  expect(AuthSession.exchangeCodeAsync).not.toHaveBeenCalled()
  expect(mockLinkListeners.size).toBe(0)
})

it('handles a callback received before the browser reports dismissal', async () => {
  jest.mocked(WebBrowser.openAuthSessionAsync).mockImplementation(async (authUrl, returnUrl) => {
    const state = new URL(authUrl).searchParams.get('state')!
    for (const listener of mockLinkListeners) listener({ url: `${returnUrl}?code=fixture-code&state=${state}` })
    return { type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult
  })
  expect(await performOidcLogin(config)).toEqual(session)
  expect(AuthSession.exchangeCodeAsync).toHaveBeenCalledTimes(1)
  expect(mockLinkListeners.size).toBe(0)
  expect(jest.getTimerCount()).toBe(0)
})

it('exchanges duplicate callbacks only once and keeps the original S256 verifier', async () => {
  let challenge: string | null = null
  jest.mocked(WebBrowser.openAuthSessionAsync).mockImplementation(async (authUrl, returnUrl) => {
    const params = new URL(authUrl).searchParams
    expect(params.get('code_challenge_method')).toBe('S256')
    challenge = params.get('code_challenge')
    const url = `${returnUrl}?code=fixture-code&state=${params.get('state')}`
    setTimeout(() => {
      for (let i = 0; i < 2; i++) for (const listener of mockLinkListeners) listener({ url })
    }, 50)
    return { type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult
  })
  const outcome = performOidcLogin(config, 'fixture-invite')
  await jest.advanceTimersByTimeAsync(100)
  expect(await outcome).toEqual(session)
  expect(AuthSession.exchangeCodeAsync).toHaveBeenCalledTimes(1)
  const verifier = jest.mocked(AuthSession.exchangeCodeAsync).mock.calls[0][0].extraParams!.code_verifier
  expect(jest.requireActual('crypto').createHash('sha256').update(verifier).digest('base64url')).toBe(challenge)
  expect(loginWithOidc).toHaveBeenCalledWith('fixture-id-token', 'fixture-invite')
})

it('cleans up after a browser launch error and allows another login', async () => {
  jest.mocked(WebBrowser.openAuthSessionAsync).mockRejectedValueOnce(new Error('fixture launch failure'))
  await expect(performOidcLogin(config)).rejects.toThrow('fixture launch failure')
  expect(mockLinkListeners.size).toBe(0)
  jest.mocked(WebBrowser.openAuthSessionAsync).mockImplementationOnce(async (authUrl, returnUrl) => ({
    type: 'success',
    url: `${returnUrl}?code=fixture-code&state=${new URL(authUrl).searchParams.get('state')}`,
  }))
  expect(await performOidcLogin(config)).toEqual(session)
  expect(mockLinkListeners.size).toBe(0)
})

it('leaves iOS native browser-session handling unchanged', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
  jest
    .mocked(WebBrowser.openAuthSessionAsync)
    .mockResolvedValue({ type: 'cancel' } as WebBrowser.WebBrowserAuthSessionResult)
  await expect(performOidcLogin(config)).rejects.toBeInstanceOf(OidcCancelledError)
  expect(mockLinkListeners.size).toBe(0)
  expect(jest.getTimerCount()).toBe(0)
})

it('rejects mismatched state in a recovered server-mediated callback', async () => {
  jest.mocked(WebBrowser.openAuthSessionAsync).mockImplementation(async (_authUrl, returnUrl) => {
    setTimeout(() => {
      for (const listener of mockLinkListeners) listener({ url: `${returnUrl}?handoff=fixture-handoff&state=wrong` })
    }, 50)
    return { type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult
  })
  const outcome = performOidcLogin({
    ...config,
    usesClientSecret: true,
    mobileCallbackUrl: 'https://family.example/api/auth/oidc/mobile-callback',
  }).catch((error: Error) => error.message)
  await jest.advanceTimersByTimeAsync(100)
  expect(await outcome).toBe('login.ssoLoginFailed')
  expect(exchangeOidcMobileHandoff).not.toHaveBeenCalled()
  expect(mockLinkListeners.size).toBe(0)
})

it('rejects an overlapping login while waiting for the first callback', async () => {
  jest
    .mocked(WebBrowser.openAuthSessionAsync)
    .mockResolvedValue({ type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult)
  const first = performOidcLogin(config).catch((error: Error) => error)
  await jest.advanceTimersByTimeAsync(1)
  await expect(performOidcLogin(config)).rejects.toThrow('login.ssoLoginFailed')
  expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledTimes(1)
  await jest.advanceTimersByTimeAsync(1001)
  expect(await first).toBeInstanceOf(OidcCancelledError)
  expect(mockLinkListeners.size).toBe(0)
})

it('does not broaden a named server-mediated callback to other root, host or path forms', async () => {
  jest.mocked(WebBrowser.openAuthSessionAsync).mockImplementation(async (authUrl) => {
    const state = new URL(authUrl).searchParams.get('state')!
    setTimeout(() => {
      for (const base of [
        'famlin:/oidc-callback',
        'famlin://oidc-callback.evil',
        'famlin://oidc-callback/extra',
        'famlin:',
        'famlin:///',
      ]) {
        for (const listener of mockLinkListeners)
          listener({ url: `${base}?handoff=fixture-handoff&state=${encodeURIComponent(state)}` })
      }
    }, 20)
    return { type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult
  })
  const outcome = performOidcLogin({
    ...config,
    usesClientSecret: true,
    mobileCallbackUrl: 'https://family.example/api/auth/oidc/mobile-callback',
  }).catch((error: Error) => error)
  await jest.advanceTimersByTimeAsync(1001)
  expect(await outcome).toBeInstanceOf(OidcCancelledError)
  expect(exchangeOidcMobileHandoff).not.toHaveBeenCalled()
  expect(mockLinkListeners.size).toBe(0)
})
