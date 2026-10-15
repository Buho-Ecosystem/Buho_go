import { boot } from 'quasar/wrappers'
// Resolves to the offline build (quasar.config.js): icons come only from
// the sets added here, never from the network.
import { Icon, addIcon, addCollection } from '@iconify/vue'
import tabler from '@iconify-json/tabler/icons.json'

addCollection(tabler)

/**
 * BuhoGO's own icons, drawn on the same 24px grid and 2px stroke as the
 * Tabler set the app uses, so they sit next to them as equals.
 */
const BUHO_ICONS = {
  // Ask someone for money: a message with money coming in. Used wherever
  // the app requests money (Receive, the chat's money bar).
  request: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">'
    + '<path d="M7 18H5.5A2.5 2.5 0 0 1 3 15.5v-9A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v9a2.5 2.5 0 0 1-2.5 2.5H12l-5 3.5z"/>'
    + '<path d="M15 7.5l-5.5 5.5"/><path d="M9.5 9.5V13h3.5"/></g>',
}

for (const [name, body] of Object.entries(BUHO_ICONS)) {
  addIcon(`buho:${name}`, { body, width: 24, height: 24 })
}

export default boot(({ app }) => {
  app.component('Icon', Icon)
})
