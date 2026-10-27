import { registerRootComponent } from 'expo'
import BrandedRoot from './src/branding/BrandedRoot'
import { startOidcDiagnostics } from './src/utils/oidcDiagnostics'

startOidcDiagnostics()

// Replaces expo/AppEntry.js so the family's cached branding is applied
// before App (and every screen module) is evaluated — see BrandedRoot.
registerRootComponent(BrandedRoot)
