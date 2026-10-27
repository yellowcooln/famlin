import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState, Linking } from 'react-native'

// Ordinary builds collect nothing. Diagnostic APKs opt in at compile time.
export const oidcDiagnosticsEnabled = process.env.EXPO_PUBLIC_OIDC_DIAGNOSTICS === '1'
const KEY = 'famlin:oidc-diagnostics:v1'
const LIMIT = 80
const runtime = Date.now().toString(36)
const stages = new Set([
  'runtime_start',
  'app_state',
  'initial_url',
  'url_event',
  'login_pressed',
  'auth_begin',
  'auth_prompt',
  'browser_result',
  'callback_seen',
  'callback_timeout',
  'auth_result',
  'token_exchange_start',
  'token_exchange_complete',
  'session_request',
  'session_response',
  'session_save_start',
  'session_save_complete',
  'login_cancelled',
  'login_error',
])
const booleanKeys = ['hasUrl', 'hasCode', 'hasState', 'hasError', 'hasHandoff', 'matches', 'usesClientSecret']
const enumFields: Record<string, Set<string>> = {
  result: new Set(['success', 'dismiss', 'cancel', 'error', 'locked', 'opened', 'unknown']),
  appState: new Set(['active', 'background', 'inactive', 'unknown', 'extension']),
  route: new Set(['root', 'oidc-callback', 'invite', 'other']),
}
type Entry = Record<string, string | number | boolean>
let events: Entry[] = []
let storageUnavailable = false
let queue: Promise<void> = Promise.resolve()

function sanitize(stage: string, fields: Record<string, unknown>): Entry | undefined {
  if (!stages.has(stage)) return undefined
  const event: Entry = { at: new Date().toISOString(), runtime, stage }
  for (const key of booleanKeys) if (typeof fields[key] === 'boolean') event[key] = fields[key]
  for (const [key, values] of Object.entries(enumFields)) {
    if (typeof fields[key] === 'string' && values.has(fields[key])) event[key] = fields[key]
  }
  if (
    typeof fields.httpStatus === 'number' &&
    Number.isInteger(fields.httpStatus) &&
    fields.httpStatus >= 100 &&
    fields.httpStatus <= 599
  )
    event.httpStatus = fields.httpStatus
  return event
}

// Restrict old stored records too: raw text/unknown fields are never exported.
const loaded = oidcDiagnosticsEnabled
  ? AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw || raw.length > 65536) return
        try {
          const prior: unknown = JSON.parse(raw)
          if (!Array.isArray(prior)) return
          events = prior.slice(-LIMIT).flatMap((item) => {
            if (!item || typeof item !== 'object') return []
            const row = item as Record<string, unknown>
            const clean = sanitize(String(row.stage), row)
            if (!clean) return []
            if (typeof row.at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(row.at)) clean.at = row.at
            if (typeof row.runtime === 'string' && /^[a-z0-9]{1,16}$/.test(row.runtime)) clean.runtime = row.runtime
            return [clean]
          })
        } catch {
          /* Ignore malformed storage, never expose its raw contents. */
        }
      })
      .catch(() => {
        storageUnavailable = true
      })
  : Promise.resolve()

export function recordOidcDiagnostic(stage: string, fields: Record<string, unknown> = {}): void {
  if (!oidcDiagnosticsEnabled) return
  const event = sanitize(stage, fields)
  if (!event) return
  queue = queue
    .then(async () => {
      await loaded
      events = [...events, event].slice(-LIMIT)
      try {
        await AsyncStorage.setItem(KEY, JSON.stringify(events))
      } catch {
        storageUnavailable = true
      }
    })
    .catch(() => {
      storageUnavailable = true
    })
}

// Return only presence flags and fixed categories, never raw callback values.
export function summarizeOidcUrl(url: string | null | undefined): Record<string, unknown> {
  if (!url) return { hasUrl: false }
  try {
    const parsed = new URL(url)
    const route =
      parsed.protocol !== 'famlin:'
        ? 'other'
        : parsed.hostname === 'oidc-callback'
          ? 'oidc-callback'
          : parsed.hostname === 'invite'
            ? 'invite'
            : !parsed.hostname && (!parsed.pathname || parsed.pathname === '/')
              ? 'root'
              : 'other'
    const fragment = new URLSearchParams(parsed.hash.slice(1))
    const has = (key: string) => parsed.searchParams.has(key) || fragment.has(key)
    return {
      hasUrl: true,
      route,
      hasCode: has('code'),
      hasState: has('state'),
      hasError: has('error'),
      hasHandoff: has('handoff'),
    }
  } catch {
    return { hasUrl: true, route: 'other' }
  }
}

let started = false
export function startOidcDiagnostics(): void {
  if (!oidcDiagnosticsEnabled || started) return
  started = true
  recordOidcDiagnostic('runtime_start')
  // One observer per JS runtime, retained until runtime teardown. These only
  // observe events; they do not consume callbacks or change auth decisions.
  Linking.addEventListener('url', ({ url }) => recordOidcDiagnostic('url_event', summarizeOidcUrl(url)))
  AppState.addEventListener('change', (appState) => recordOidcDiagnostic('app_state', { appState }))
  Linking.getInitialURL()
    .then((url) => recordOidcDiagnostic('initial_url', summarizeOidcUrl(url)))
    .catch(() => recordOidcDiagnostic('initial_url', { hasUrl: false }))
}

export async function readOidcDiagnostics(): Promise<string> {
  await queue
  await loaded
  return JSON.stringify(
    { format: 'famlin-oidc-diagnostics-v1', enabled: oidcDiagnosticsEnabled, storageUnavailable, events },
    null,
    2
  )
}
