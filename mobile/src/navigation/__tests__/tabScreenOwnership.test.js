// Wiring guard: native safe-area props are exercised in TabScreen.test.tsx.
import { it, expect } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

it.each(['FeedScreen', 'PhotosScreen', 'ProfileScreen'])('%s delegates bottom-inset ownership to MainTabs', (name) => {
  const source = readFileSync(join(process.cwd(), 'src', 'screens', `${name}.tsx`), 'utf8')
  expect(source).toContain("import { TabScreen } from '@/components/TabScreen'")
  expect(source).toContain('<TabScreen style={styles.container}>')
  expect(source).not.toContain('<SafeAreaView')
})
