import { boot } from 'quasar/wrappers'
import { createI18n } from 'vue-i18n'
import messages from 'src/i18n'
import { DEFAULT_LOCALE, getSavedLocale } from 'src/i18n/locales'

export default boot(({ app }) => {
  const i18n = createI18n({
    locale: getSavedLocale() ?? DEFAULT_LOCALE,
    fallbackLocale: DEFAULT_LOCALE,
    globalInjection: true,
    messages
  })

  app.use(i18n)
})
