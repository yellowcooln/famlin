import React from 'react'
import { Share } from 'react-native'
import * as Sharing from 'expo-sharing'
import { render, fireEvent, act } from '@testing-library/react-native'
import { OidcDiagnosticsPanel } from '../OidcDiagnosticsPanel'

let mockEnabled = true
const mockFileWrite = jest.fn()
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache/' },
  File: jest.fn(() => ({ uri: 'file:///cache/famlin-oidc-diagnostics.txt', create: jest.fn(), write: mockFileWrite })),
}))
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => {}) }))
jest.mock('@/utils/oidcDiagnostics', () => ({
  get oidcDiagnosticsEnabled() {
    return mockEnabled
  },
  readOidcDiagnostics: jest.fn(async () => '{"events":[{"stage":"browser_result","result":"dismiss"}]}'),
}))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

it('shows and shares the local diagnostic report only after user action', async () => {
  mockEnabled = true
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction })
  const screen = await render(<OidcDiagnosticsPanel />)
  expect(share).not.toHaveBeenCalled()
  await act(async () => {
    fireEvent.press(screen.getByText('login.diagnosticsTitle'))
  })
  expect(screen.getByText('{"events":[{"stage":"browser_result","result":"dismiss"}]}')).toBeTruthy()
  await act(async () => {
    fireEvent.press(screen.getByText('login.diagnosticsShare'))
  })
  expect(mockFileWrite).toHaveBeenCalledWith('{"events":[{"stage":"browser_result","result":"dismiss"}]}')
  expect(Sharing.shareAsync).toHaveBeenCalledWith(
    'file:///cache/famlin-oidc-diagnostics.txt',
    expect.objectContaining({ mimeType: 'text/plain' })
  )
  expect(share).not.toHaveBeenCalled()
  share.mockRestore()
})

it('renders nothing in ordinary builds', async () => {
  mockEnabled = false
  const screen = await render(<OidcDiagnosticsPanel />)
  expect(screen.toJSON()).toBeNull()
})
