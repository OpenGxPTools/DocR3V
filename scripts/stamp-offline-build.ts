/**
 * Names and fingerprints the offline build.
 *
 *   npm run build:offline
 *
 * Vite writes dist-offline/index.html; this renames it to DocR3V-<version>.html
 * and writes a SHA-256 next to it. Both matter for a regulated audience: the
 * file a reviewer downloaded is identifiable on sight, and the checksum lets
 * anyone confirm months later that the file they have archived is the file that
 * was published — which is what makes a filed comparison reproducible from the
 * version it names.
 *
 * Fails loudly if the build produced more than the one HTML file, because a
 * stray asset means something did not get inlined and the "one file, works
 * offline" promise is quietly broken.
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_NAME, APP_VERSION } from '../src/version.ts'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist-offline')

async function main(): Promise<void> {
  const entries = await readdir(OUT_DIR, { withFileTypes: true })
  const stray = entries.filter((entry) => entry.name !== 'index.html')
  if (stray.length > 0) {
    const names = stray.map((entry) => entry.name).join(', ')
    throw new Error(
      `The offline build should be a single index.html, but dist-offline also contains: ${names}.\n` +
        `Anything left beside the HTML file will be missing when someone opens the download, ` +
        `so the build is not safe to publish.`,
    )
  }

  const fileName = `${APP_NAME}-${APP_VERSION}.html`
  const target = join(OUT_DIR, fileName)
  await rename(join(OUT_DIR, 'index.html'), target)

  const contents = await readFile(target)
  const digest = createHash('sha256').update(contents).digest('hex')
  await writeFile(join(OUT_DIR, `${fileName}.sha256`), `${digest}  ${fileName}\n`)

  console.log(`\n  ${fileName}`)
  console.log(`  ${(contents.byteLength / 1024 / 1024).toFixed(2)} MB`)
  console.log(`  sha256 ${digest}`)
  console.log(`\n  Open it the way someone who downloaded it would:`)
  console.log(`  file://${target}\n`)
}

await main()
