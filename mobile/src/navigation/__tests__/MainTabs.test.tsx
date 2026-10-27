import React from 'react'
import { StyleSheet, StyleProp, ViewStyle } from 'react-native'
import { render } from '@testing-library/react-native'
import { MainTabs } from '../MainTabs'

let mockBottom = 0
let mockOptions: { tabBarStyle: StyleProp<ViewStyle> }
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: mockBottom }),
}))
jest.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({
    Navigator: ({
      screenOptions,
      children,
    }: {
      screenOptions: { tabBarStyle: StyleProp<ViewStyle> }
      children: React.ReactNode
    }) => {
      mockOptions = screenOptions
      return children
    },
    Screen: () => null,
  }),
}))
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }))
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/screens/FeedScreen', () => ({ FeedScreen: () => null }))
jest.mock('@/screens/PhotosScreen', () => ({ PhotosScreen: () => null }))
jest.mock('@/screens/ProfileScreen', () => ({ ProfileScreen: () => null }))
jest.mock('@/components/Icon', () => ({ Icon: () => null }))
jest.mock('@famlin/api-client', () => ({ fetchGroups: jest.fn(), fetchChatUnreadCounts: jest.fn() }))

it.each([0, 24, 34, 48])('keeps tab content and new-post button above a %s dp system inset', async (bottom) => {
  mockBottom = bottom
  const screen = await render(<MainTabs />)
  const bar = StyleSheet.flatten(mockOptions.tabBarStyle)
  const padding = Math.max(24, bottom)
  expect(bar.paddingBottom).toBe(padding)
  expect(bar.height).toBe(60 + padding)
  const fab = screen.getByRole('button')
  expect(StyleSheet.flatten(fab.props.style).bottom).toBe(60 + padding + 16)
})

it('updates the bar and floating button if the navigation-mode inset changes', async () => {
  mockBottom = 24
  const screen = await render(<MainTabs />)
  mockBottom = 48
  await screen.rerender(<MainTabs />)
  const bar = StyleSheet.flatten(mockOptions.tabBarStyle)
  expect(bar.paddingBottom).toBe(48)
  expect(bar.height).toBe(108)
  expect(StyleSheet.flatten(screen.getByRole('button').props.style).bottom).toBe(124)
})
