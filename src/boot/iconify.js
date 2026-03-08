import { boot } from 'quasar/wrappers'
import { Icon } from '@iconify/vue'

export default boot(({ app }) => {
  app.component('Icon', Icon)
})
