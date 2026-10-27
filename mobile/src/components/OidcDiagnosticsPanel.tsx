import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { useTranslation } from 'react-i18next'
import { oidcDiagnosticsEnabled, readOidcDiagnostics } from '@/utils/oidcDiagnostics'

export function OidcDiagnosticsPanel() {
  const { t } = useTranslation()
  const [report, setReport] = useState<string | null>(null)
  if (!oidcDiagnosticsEnabled) return null
  return (
    <View style={styles.container}>
      <TouchableOpacity
        accessibilityRole="button"
        onPress={async () => setReport(report === null ? await readOidcDiagnostics() : null)}
      >
        <Text style={styles.link}>{t(report === null ? 'login.diagnosticsTitle' : 'login.diagnosticsHide')}</Text>
      </TouchableOpacity>
      {report !== null && (
        <>
          <Text style={styles.privacy}>{t('login.diagnosticsPrivacy')}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={async () => {
              const current = await readOidcDiagnostics()
              setReport(current)
              const file = new File(Paths.cache, 'famlin-oidc-diagnostics.txt')
              file.create({ overwrite: true })
              file.write(current)
              await Sharing.shareAsync(file.uri, {
                mimeType: 'text/plain',
                dialogTitle: t('login.diagnosticsShare'),
              }).catch(() => {})
            }}
          >
            <Text style={styles.link}>{t('login.diagnosticsShare')}</Text>
          </TouchableOpacity>
          <Text selectable style={styles.report}>
            {report}
          </Text>
        </>
      )}
    </View>
  )
}
const styles = StyleSheet.create({
  container: {
    marginTop: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#9ca3af',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  link: { color: '#005b82', fontSize: 14, paddingVertical: 8, textAlign: 'center' },
  privacy: { color: '#374151', fontSize: 12 },
  report: { color: '#111827', fontFamily: 'monospace', fontSize: 10, marginTop: 8 },
})
