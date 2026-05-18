import { boot } from 'quasar/wrappers'
import { createI18n } from 'vue-i18n'
import messages from 'src/i18n'
import { DEFAULT_LOCALE, getSavedLocale } from 'src/i18n/locales'

// Singleton i18n instance. Exposed so non-component code (Pinia stores,
// plain utility modules) can read the active locale without going through
// a Vue component proxy. Legacy mode is intentional — most of the app
// uses the Options-API `$t` injection — but `i18n.global.locale` is still
// a reactive Ref, which means Pinia getters that read it will re-compute
// when the user switches languages.
export const i18n = createI18n({
  locale: getSavedLocale() ?? DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  globalInjection: true,
  messages
})

export default boot(({ app }) => {
  app.use(i18n)
})
