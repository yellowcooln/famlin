# Android bottom-tab safe area

The device screenshot shows Feed/Photos/Profile labels beneath Android's three-button navigation overlay. MainTabs fixed the entire bar at 84 dp with 24 dp bottom padding, overriding the larger actual system inset.

MainTabs now reads the existing root SafeAreaProvider via useSafeAreaInsets. It retains the original content height and minimum spacing, using `Math.max(24, insets.bottom)` for bottom padding and `60 + bottomPadding` for total bar height. The floating new-post button is positioned at `tabBarHeight + 16` rather than a fixed screen-bottom offset. React Navigation continues to own tab navigation and content layout; no system navigation mode, edge-to-edge policy, authentication or server configuration is changed.

Regression: `mobile/src/navigation/__tests__/MainTabs.test.tsx` renders the production MainTabs component with injected safe-area metrics for zero, gesture, home-indicator and three-button insets, plus a runtime inset change. The original fails the larger-inset and change cases; the corrected component passes. Navigation/native rendering is mocked: these are component style/position contracts, not a visual test on the physical phone.

The update keeps the existing package and test signing key, advances Android version code, and retains all confirmed Firefox/Authentik fixes. Installing over the previous test APK preserves app storage; do not ask the user to uninstall. Physical-phone layout acceptance remains pending until the updated app is observed.

## Single-owner follow-up

The user confirmed fix4 lifts the tabs above Android's buttons. The follow-up screenshot exposed a separate solid background band above the bar, clipping a card before the bar boundary: Feed, Photos and Profile still applied all four SafeAreaView edges inside a navigator which already reserves the bottom inset. Fix4 had not addressed that duplicate screen-level inset.

These three tab roots now use a shared TabScreen wrapper retaining top/left/right protection and disabling only the inner bottom edge. MainTabs still owns the system-bottom inset; standalone stack screens, modal safe areas, scroll-content spacing, background colors and authentication code remain unchanged. Component tests exercise the real SafeAreaView's forwarded native edge modes (bottom off), theme/full-height style and children; separate wiring guards cover all three consumers. Native-prop and source-contract tests are not physical-device visual acceptance. The updated background/content continuity still needs confirmation on the phone.
