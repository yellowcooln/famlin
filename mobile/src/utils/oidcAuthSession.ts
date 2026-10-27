import { Platform } from 'react-native'
import * as Linking from 'expo-linking'
import i18n from '@/i18n'

// Expo's Android auth-session polyfill races AppState foreground against
// the Linking event. Firefox can foreground us first, causing Expo to return
// dismiss and remove its listener before the callback is delivered.
const REDIRECT_GRACE_MS = 1000
let activeAndroidSession = false

export async function withAndroidAuthRedirect<T extends { type: string }>(
  redirectUri: string,
  start: () => Promise<T>,
  parseReturnUrl: (url: string) => T
): Promise<T> {
  if (Platform.OS !== 'android') return start()
  if (activeAndroidSession) throw new Error(i18n.t('login.ssoLoginFailed'))
  activeAndroidSession = true

  let callbackUrl: string | undefined
  let resolveCallback!: (url: string) => void
  const callback = new Promise<string>((resolve) => {
    resolveCallback = resolve
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  let subscription: ReturnType<typeof Linking.addEventListener> | undefined

  try {
    // Own a listener before opening the browser, and retain it briefly after
    // dismissal. Match the exact callback route, not arbitrary scheme-prefix
    // links. The caller must still validate OAuth state via the original parser.
    subscription = Linking.addEventListener('url', ({ url }) => {
      if (url.split(/[?#]/, 1)[0] === redirectUri && callbackUrl === undefined) {
        callbackUrl = url
        resolveCallback(url)
      }
    })
    const result = await start()
    if (result.type !== 'dismiss' && result.type !== 'cancel') return result
    if (callbackUrl !== undefined) return parseReturnUrl(callbackUrl)

    const lateCallback = await Promise.race([
      callback,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), REDIRECT_GRACE_MS)
      }),
    ])
    return lateCallback === undefined ? result : parseReturnUrl(lateCallback)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    try {
      subscription?.remove()
    } finally {
      activeAndroidSession = false
    }
  }
}
