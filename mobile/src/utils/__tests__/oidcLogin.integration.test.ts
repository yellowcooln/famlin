// Exercise the real Expo AuthRequest AND Android WebBrowser polyfill.
// Only unavailable native browser/OS events, crypto bridge and HTTP are injected.
import { AppState, Linking, Platform, AppStateStatus } from 'react-native'
import * as AuthSession from 'expo-auth-session'
import NativeBrowser from 'expo-web-browser/build/ExpoWebBrowser'
import { loginWithOidc, OidcConfig } from '@/api/auth'
import { performOidcLogin } from '../oidcLogin'

jest.mock('expo-web-browser/build/ExpoWebBrowser', () => ({
  __esModule: true,
  default: { openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) },
}))
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
    digestStringAsync: async (_algorithm: string, value: string) =>
      crypto.createHash('sha256').update(value).digest('base64'),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    CryptoEncoding: { BASE64: 'base64' },
  }
})
jest.mock('@/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }))
jest.mock('@/api/auth', () => ({ loginWithOidc: jest.fn(), exchangeOidcMobileHandoff: jest.fn() }))

it.each([
  ['famlin://', 'foreground-first'],
  ['famlin:/', 'callback-first'],
  ['famlin:///', 'callback-first'],
  ['famlin:', 'callback-first'],
  ['famlin://', 'callback-first'],
])('completes real Expo login for root callback %s with %s ordering', async (callbackBase, order) => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true })
  const states = new Set<(state: AppStateStatus) => void>()
  const links = new Set<(event: { url: string }) => void>()
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, listener) => {
    states.add(listener)
    return { remove: () => states.delete(listener) }
  })
  jest.spyOn(Linking, 'addEventListener').mockImplementation((_name, listener) => {
    links.add(listener)
    return {
      remove: () => {
        links.delete(listener)
      },
    } as ReturnType<typeof Linking.addEventListener>
  })
  const config: OidcConfig = {
    enabled: true,
    name: 'Test',
    authorizationEndpoint: 'https://idp.example/authorize',
    tokenEndpoint: 'https://idp.example/token',
    clientId: 'fixture-client',
    scopes: 'openid email profile',
    usesClientSecret: false,
  }
  const session = { token: 'fixture-session', user: { id: 'fixture-user' } }
  jest
    .mocked(AuthSession.exchangeCodeAsync)
    .mockResolvedValue({ idToken: 'fixture-id-token' } as AuthSession.TokenResponse)
  jest.mocked(loginWithOidc).mockResolvedValue(session as Awaited<ReturnType<typeof loginWithOidc>>)
  try {
    const outcome = performOidcLogin(config).then(
      (value) => ({ value }),
      (error: Error) => ({ error: error.constructor.name })
    )
    await jest.advanceTimersByTimeAsync(0)
    const authUrl = jest.mocked(NativeBrowser.openBrowserAsync).mock.calls[0][0] as string
    const state = new URL(authUrl).searchParams.get('state')!
    for (const listener of states) listener('background')
    if (order === 'callback-first') {
      for (const listener of [...links]) listener({ url: `${callbackBase}?code=fixture-code&state=${state}` })
      await jest.advanceTimersByTimeAsync(20)
    }
    for (const listener of states) listener('active')
    // Let the real polyfill observe foreground, return dismiss and remove its
    // own listener. The app-owned listener must survive that cleanup.
    await jest.advanceTimersByTimeAsync(50)
    if (order === 'foreground-first') {
      for (const listener of [...links]) listener({ url: `${callbackBase}?code=fixture-code&state=${state}` })
    }
    await jest.advanceTimersByTimeAsync(1001)
    expect(await outcome).toEqual({ value: session })
    expect(AuthSession.exchangeCodeAsync).toHaveBeenCalledTimes(1)
    // The token endpoint must receive the original registered redirect URI,
    // not the browser's alternate serialization of the callback.
    expect(AuthSession.exchangeCodeAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUri: 'famlin://',
        code: 'fixture-code',
        extraParams: { code_verifier: expect.any(String) },
      }),
      expect.any(Object)
    )
    expect(links.size).toBe(0)
    expect(states.size).toBe(0)
    expect(jest.getTimerCount()).toBe(0)
  } finally {
    jest.restoreAllMocks()
    jest.useRealTimers()
  }
})
