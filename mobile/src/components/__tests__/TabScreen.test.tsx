import React from 'react'
import { Text, StyleSheet } from 'react-native'
import { render } from '@testing-library/react-native'
import { TabScreen } from '../TabScreen'

it('lets the tab bar own the bottom inset, retaining top and side protection', async () => {
  const screen = await render(
    <TabScreen testID="tab-screen">
      <Text>Screen body</Text>
    </TabScreen>
  )
  expect(screen.getByTestId('tab-screen').props.edges).toEqual({
    top: 'additive',
    left: 'additive',
    right: 'additive',
    bottom: 'off',
  })
})

it('preserves the full-height themed screen and its children', async () => {
  const style = { flex: 1, backgroundColor: '#eef8fb' }
  const screen = await render(
    <TabScreen testID="tab-screen" style={style}>
      <Text>Screen body</Text>
    </TabScreen>
  )
  expect(StyleSheet.flatten(screen.getByTestId('tab-screen').props.style)).toEqual(style)
  expect(screen.getByText('Screen body')).toBeTruthy()
})
