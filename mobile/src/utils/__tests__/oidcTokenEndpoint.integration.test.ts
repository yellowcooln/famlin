// Real Expo code exchange/request serialization; only the HTTP transport is injected.
import * as AuthSession from 'expo-auth-session'

it.each([
  'https://idp.example/application/o/token/',
  'https://idp.example/application/o/token',
  'https://idp.example/application/o/token/?tenant=fixture',
])('preserves the configured token endpoint %s during the real PKCE exchange', async (endpoint) => {
  const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    headers: { get: () => 'application/json' },
    json: async () => ({ access_token: 'fixture-access', id_token: 'fixture-id', token_type: 'Bearer' }),
  } as unknown as Response)
  try {
    const result = await AuthSession.exchangeCodeAsync(
      {
        clientId: 'fixture-client',
        code: 'fixture-code',
        redirectUri: 'famlin://',
        extraParams: { code_verifier: 'fixture-verifier' },
      },
      { tokenEndpoint: endpoint }
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: 'POST' }))
    const body = new URLSearchParams(fetch.mock.calls[0][1]!.body as string)
    expect(body.get('redirect_uri')).toBe('famlin://')
    expect(body.get('code_verifier')).toBe('fixture-verifier')
    expect(body.get('code')).toBe('fixture-code')
    expect(result.idToken).toBe('fixture-id')
  } finally {
    fetch.mockRestore()
  }
})
