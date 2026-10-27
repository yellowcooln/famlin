# Android OIDC callback recovery (fork)

Branch: `fix/android-oidc-callback` in `yellowcooln/famlin`.

## Device result and diagnostic follow-up

The signed test APK built from `ad07c9b` was tried on Android with Firefox and **still returned to Famlin without signing in**. The library race is reproduced, but it has not been established as the cause of the actual device failure. Do not describe that APK as a confirmed fix or ask the user to repeat browser-switching/settings workarounds.

An explicit `EXPO_PUBLIC_OIDC_DIAGNOSTICS=1` build adds a login-screen **Sign-in diagnostics** panel. It observes startup/initial URLs, warm URL events, app lifecycle, browser/auth results, callback presence and token/session/save progress. The bounded local report records fixed event categories, timestamps, runtime identifiers, booleans and optional HTTP status only; it never records callback URLs or code/state/token values, passwords, account identity or family content. Tests cover redaction, stored-data sanitization, bounded/reloaded history, unavailable storage and disabled ordinary builds. Sharing requires an explicit user action and opens the OS share sheet for a local text file; there is no automatic telemetry endpoint. This build is for collecting evidence, not another claimed repair.

The diagnostic APK uses the same persistent test signing key and a higher Android version code, so it can update the first test APK without uninstalling it. It still cannot update a Play-signed official APK. Try sign-in once, then use Sign-in diagnostics → Share diagnostics to provide the report. A new runtime with an initial callback versus a surviving runtime with a missing/late warm callback discriminates cold-start/process recreation from promise/event delivery failure.


## Finding from the device diagnostics

Both supplied attempts received a root callback with code and state present, no provider error, and `matches: false`. The callback preceded foreground by 17 ms and 28 ms respectively; the original JavaScript runtime survived each attempt. The failing boundary is callback-route acceptance, not a late callback or app restart in those attempts. The privacy-preserving report does not contain the literal returned URI, so it does not establish which slash serialization was delivered. Read-only proxy logs confirm the authorization request still registers `famlin://` with S256.

The follow-up regression uses the real Expo AuthRequest/WebBrowser polyfill and callback-before-foreground ordering. Original matching reproduces cancellation for hostless root forms such as `famlin:/` and `famlin:`. The follow-up accepts only the equivalent `famlin:` root representations with zero through three slashes; it does not generalize host/path matching, accept other schemes, or rewrite the configured redirect URI. Token exchange continues sending the original `famlin://`; original state validation and S256 verifier remain mandatory. Named server-mediated callbacks remain exact. Negative tests cover wrong state for every root form, other schemes/hosts/paths and slash lookalikes.

The rebuilt follow-up APK retains the diagnostic panel and signing key and advances its Android version code so it can update the installed test app. Successful actual-phone login remains an acceptance gate, not a conclusion from the automated regression.

## Token-transport follow-up

The next physical-phone trace confirms root matching is now accepted (`matches:true`, `auth_result:success`) and reaches `token_exchange_start`. It fails before completing exchange with `JSON Parse error: Unexpected character: <`. Sanitized NPM logs identify the native POST target as `/application/o/token` despite the correct configured `/application/o/token/`. Live unauthenticated invalid-code probes show the slash endpoint returns OAuth JSON400 while the stripped endpoint returns HTML404.

Pinned `expo-auth-session@57.0.16` unconditionally removes the final slash inside `requestAsync`. A checked-in `patch-package` patch now removes only a serializer-added slash and retains a slash explicitly present in the original configured endpoint. Source, compiled JS and its regenerated source map are patched; mobile `postinstall` applies the exact-version patch and fails on application errors. No global fetch wrapper, proxy rewrite, IdP configuration change or replacement OAuth parser is introduced.

The regression exercises the real Expo authorization-code exchange and its serialized URL/form body. A live request through the patched transport reaches the exact slash endpoint and parses the expected `invalid_grant` JSON for a deliberately invalid code; that transport probe is not a successful account login. A clean mobile `npm ci` (with the local API client's built `dist` prerequisite) reapplies the patch, with all three resulting files hash-identical to the tested dependency.

## Scope and mechanism

An Android user running the official 0.8.2 app with Firefox can authenticate at the identity provider and return to Famlin without getting an app session. The observed native attempts did not proceed to code exchange. The exact phone event trace has not been captured; this change fixes a deterministically reproduced library race consistent with that symptom, not every possible login failure.

Expo's Android `openAuthSessionAsync` polyfill races application foreground against delivery of a Linking URL event. Foreground can win, resolve as `dismiss`, and remove Expo's redirect listener before a valid callback arrives. Famlin treats this as cancellation.

The fix registers a separate, session-owned listener before calling the unchanged Expo auth flow. On Android only, it retains that listener for up to **1000 ms** after `dismiss` or `cancel`. An already received or late callback must match the exact registered callback route. Other schemes/hosts/paths, including invite URLs and prefix lookalikes, are ignored. The recovered PKCE callback goes through the same `AuthRequest.parseReturnUrl` state validation as Expo's normal success path. The original AuthRequest and S256 verifier remain unchanged. Server-mediated login retains its existing nonce/state and one-time-handoff validation. No client secret is embedded.

Actual cancellation still completes after the bounded grace interval. Listeners, timers and the additional Android session lock are released on success, cancellation and errors. iOS follows the existing native flow without a grace delay or new listener. This does not persist pending authentication across process death; a killed app must start a fresh sign-in rather than accepting a callback without its original state/verifier.

## Verification

- The new public-PKCE regression failed against original code with `OidcCancelledError`, then passed with recovery.
- The server-mediated regression also failed with `OidcCancelledError` before adding recovery to that path, then passed.
- An integration test drives the **real installed Expo AuthRequest and Android WebBrowser polyfill**, injecting native browser/OS events and HTTP boundaries. Foreground-before-Linking fails against unmodified upstream and passes in this branch. This is not a physical Android or real Firefox run.
- **13 new tests**: 12 behavioral/security cases plus the real-polyfill integration case. Includes late/early callbacks, preserved S256 verifier, wrong state, unrelated callback routes, cancellation, duplicate events, launch errors, overlapping sessions, server-mediated state and unchanged iOS cancellation.
- Full mobile suite: **110 assertions pass across 16 suites** with `--forceExit`. The plain runner emits React/Expo test-environment warnings and remains alive after completing assertions. A separate unmodified upstream checkout reproduces the same warnings and open-handle hang (97 assertions / 14 suites), so no unrelated runner cleanup is bundled into this fix. The new targeted tests exit normally without `--forceExit`.
- Mobile TypeScript check and ESLint on all changed TS files pass with zero warnings.
- `expo export --platform android` successfully compiles the application into a Hermes Android bundle. A JavaScript/Hermes bundle is **not an installable APK** and does not establish native/device execution.

## Reproduce

```sh
npm ci
npm --prefix mobile ci
cd mobile
npm test -- --runInBand src/utils/__tests__/oidcLogin.test.ts src/utils/__tests__/oidcLogin.integration.test.ts
npx tsc --noEmit
npx eslint src/utils/oidcLogin.ts src/utils/oidcAuthSession.ts src/utils/__tests__/oidcLogin.test.ts src/utils/__tests__/oidcLogin.integration.test.ts --max-warnings 0
npm test -- --runInBand --forceExit
CI=1 npx expo export --platform android --output-dir ./dist-android
```

## Device acceptance still required

Build and install an Android APK containing this branch, retain Firefox as the default browser, and sign in against the existing OIDC server. Confirm return to the authenticated feed, restart persistence, normal cancellation, and retry. The installed official 0.8.2 app cannot receive this change merely by updating the server.

A custom APK cannot update the Play-signed official app without the upstream signing key. Do not uninstall the official app without agreement or discard unsent local drafts. A side-by-side test build needs both a distinct application ID **and** a distinct URI scheme, plus an explicitly registered matching redirect URI in the test identity provider; changing only its package name leaves competing callback handlers. Keep the tested PKCE/client settings unless a separate configuration change is explicitly needed.

No production Famlin backend, NPM, DNS or Authentik settings were changed for this source fix. No upstream issue or pull request was posted.
