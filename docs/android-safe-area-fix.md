# Android bottom-tab safe area

The device screenshot shows Feed/Photos/Profile labels beneath Android's three-button navigation overlay. MainTabs fixed the entire bar at 84 dp with 24 dp bottom padding, overriding the larger actual system inset.

MainTabs now reads the existing root SafeAreaProvider via useSafeAreaInsets. It retains the original content height and minimum spacing, using `Math.max(24, insets.bottom)` for bottom padding and `60 + bottomPadding` for total bar height. The floating new-post button is positioned at `tabBarHeight + 16` rather than a fixed screen-bottom offset. React Navigation continues to own tab navigation and content layout; no system navigation mode, edge-to-edge policy, authentication or server configuration is changed.

Regression: `mobile/src/navigation/__tests__/MainTabs.test.tsx` renders the production MainTabs component with injected safe-area metrics for zero, gesture, home-indicator and three-button insets, plus a runtime inset change. The original fails the larger-inset and change cases; the corrected component passes. Navigation/native rendering is mocked: these are component style/position contracts, not a visual test on the physical phone.

The update keeps the existing package and test signing key, advances Android version code, and retains all confirmed Firefox/Authentik fixes. Installing over the previous test APK preserves app storage; do not ask the user to uninstall. Physical-phone layout acceptance remains pending until the updated app is observed.
