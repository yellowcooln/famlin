import * as WebBrowser from 'expo-web-browser'
import * as AuthSession from 'expo-auth-session'
import * as Linking from 'expo-linking'
import { getRandomBytesAsync } from 'expo-crypto'

import i18n from '@/i18n'
import { withAndroidAuthRedirect } from './oidcAuthSession'
import { recordOidcDiagnostic } from './oidcDiagnostics'
import { OidcConfig, LoginResponse, loginWithOidc, exchangeOidcMobileHandoff } from '@/api/auth'

export class OidcCancelledError extends Error {}

// The app's own famlin:// scheme, used as the final hop for both OIDC flows
// below — the OS already knows to route it back here, unlike an https
// redirect (see performServerMediatedLogin).
const APP_CALLBACK_URI = 'famlin://oidc-callback'

function getServerMediatedErrorMessage(code: string | string[] | undefined): string {
  const key = Array.isArray(code) ? code[0] : code
  switch (key) {
    case 'oidc_not_configured':
      return i18n.t('login.errors.oidcNotConfigured')
    case 'oidc_exchange_failed':
      return i18n.t('login.errors.oidcExchangeFailed')
    case 'oidc_no_email':
      return i18n.t('login.errors.oidcNoEmail')
    case 'oidc_email_not_verified':
      return i18n.t('login.errors.oidcEmailNotVerified')
    case 'email_not_allowed':
      return i18n.t('login.errors.emailNotAllowed')
    case 'invite_email_mismatch':
      return i18n.t('login.errors.inviteEmailMismatch')
    case 'invite_not_found':
    case 'invite_expired':
    case 'invite_used':
      return i18n.t('login.errors.inviteInvalid')
    default:
      return i18n.t('login.errors.unknown')
  }
}

// Most providers (Authentik, Keycloak, Auth0, ...) accept redirect_uri on
// the app's own custom scheme, so the app can do the whole PKCE exchange
// itself. Google (config.usesClientSecret) doesn't, so it goes through
// performServerMediatedLogin instead — see docs/docs/admin-configuration.md.
export async function performOidcLogin(config: OidcConfig, inviteToken?: string): Promise<LoginResponse> {
  recordOidcDiagnostic('auth_begin', { usesClientSecret: config.usesClientSecret })
  if (config.usesClientSecret && config.mobileCallbackUrl) {
    return performServerMediatedLogin(config, inviteToken)
  }
  return performPkceLogin(config, inviteToken)
}

async function performPkceLogin(config: OidcConfig, inviteToken?: string): Promise<LoginResponse> {
  const discovery: AuthSession.DiscoveryDocument = {
    authorizationEndpoint: config.authorizationEndpoint,
    tokenEndpoint: config.tokenEndpoint,
  }
  const redirectUri = AuthSession.makeRedirectUri()
  const authRequest = new AuthSession.AuthRequest({
    clientId: config.clientId,
    scopes: config.scopes.split(' ').filter(Boolean),
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
  })

  const result = await withAndroidAuthRedirect(
    redirectUri,
    () => authRequest.promptAsync(discovery),
    (url) => authRequest.parseReturnUrl(url)
  )
  recordOidcDiagnostic('auth_result', {
    result: result.type,
    hasCode: 'params' in result && typeof result.params.code === 'string',
  })
  if (result.type === 'error') {
    throw new Error(result.error?.message || i18n.t('login.ssoLoginFailed'))
  }
  if (result.type !== 'success') {
    throw new OidcCancelledError()
  }

  recordOidcDiagnostic('token_exchange_start')
  const tokenResult = await AuthSession.exchangeCodeAsync(
    {
      clientId: config.clientId,
      code: result.params.code,
      redirectUri,
      extraParams: authRequest.codeVerifier ? { code_verifier: authRequest.codeVerifier } : undefined,
    },
    discovery
  )

  recordOidcDiagnostic('token_exchange_complete')
  if (!tokenResult.idToken) {
    throw new Error(i18n.t('login.ssoNoIdToken'))
  }

  recordOidcDiagnostic('session_request')
  const session = await loginWithOidc(tokenResult.idToken, inviteToken)
  recordOidcDiagnostic('session_response')
  return session
}

// redirect_uri sent to the provider is config.mobileCallbackUrl (an HTTPS URL
// on the user's own Famlin server), which the provider is happy to accept —
// unlike a custom scheme it doesn't control. That backend route completes
// the login server-side (it holds the client secret) and 302s the browser to
// APP_CALLBACK_URI with a one-time handoff code, which is what
// openAuthSessionAsync is actually watching for here.
async function performServerMediatedLogin(config: OidcConfig, inviteToken?: string): Promise<LoginResponse> {
  const nonceBytes = await getRandomBytesAsync(16)
  const nonce = Array.from(nonceBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const state = JSON.stringify({ ...(inviteToken ? { inviteToken } : {}), nonce })
  const authUrl = `${config.authorizationEndpoint}?${new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.mobileCallbackUrl!,
    response_type: 'code',
    scope: config.scopes,
    state,
  }).toString()}`

  const result = await withAndroidAuthRedirect<WebBrowser.WebBrowserAuthSessionResult>(
    APP_CALLBACK_URI,
    () => WebBrowser.openAuthSessionAsync(authUrl, APP_CALLBACK_URI),
    (url) => ({ type: 'success', url })
  )
  recordOidcDiagnostic('auth_result', { result: result.type })
  if (result.type !== 'success' || !result.url) {
    throw new OidcCancelledError()
  }

  const { queryParams } = Linking.parse(result.url)
  const returnedState = queryParams?.state
  if (typeof returnedState !== 'string' || returnedState !== state) {
    throw new Error(i18n.t('login.ssoLoginFailed'))
  }
  const error = queryParams?.error
  if (error) {
    throw new Error(getServerMediatedErrorMessage(error))
  }
  const handoff = queryParams?.handoff
  if (typeof handoff !== 'string') {
    throw new Error(i18n.t('login.ssoLoginFailed'))
  }

  recordOidcDiagnostic('session_request')
  const session = await exchangeOidcMobileHandoff(handoff)
  recordOidcDiagnostic('session_response')
  return session
}
