/**
 * Puts a new version of the installed app on screen the moment it arrives.
 *
 * Opening the app checks for a newer build. Left to itself, the service worker
 * downloads that build in the background and only uses it from the next launch,
 * so a reviewer who opens the app after an update still sees the old version —
 * and would have to close and reopen it to get the new one.
 *
 * So when the new build is ready, the app switches to it and reloads — but only
 * if the reviewer has not started yet. Reloading wipes the documents they have
 * chosen and any comparison on screen, which costs far more than one more
 * session on the previous version. Once they pick or drop a file, the update
 * waits, and takes over at the next launch instead.
 *
 * The offline build has no service worker; there `registerSW` is a no-op (see
 * vite.config.ts).
 */

import { registerSW } from 'virtual:pwa-register'

let started = false

// Capture phase, on the document: catches choosing a file and dropping one
// without every upload control having to report it.
for (const type of ['change', 'drop'] as const) {
  document.addEventListener(type, () => (started = true), { capture: true })
}

const updateSW = registerSW({
  onNeedRefresh() {
    if (!started) void updateSW(true)
  },
})
