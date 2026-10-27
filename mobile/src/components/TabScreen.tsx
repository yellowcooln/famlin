import React from 'react'
import { SafeAreaView, type SafeAreaViewProps } from 'react-native-safe-area-context'

// MainTabs already owns the bottom system inset. Adding it inside a tab
// shortens the scroll viewport and paints a blank band above the tab bar.
// Standalone stack screens and full-screen modals must keep their own insets.
export function TabScreen(props: Omit<SafeAreaViewProps, 'edges'>) {
  return <SafeAreaView {...props} edges={['top', 'left', 'right']} />
}
