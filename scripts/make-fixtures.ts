/**
 * Writes the sample SOP pairs used for manual testing into fixtures/.
 *
 *   npm run fixtures
 *
 * Runs on Node's native TypeScript support, so there is no build step and the
 * script shares the same document builders the unit tests use — the files a
 * reviewer drags into the app are produced by exactly the code under test.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDocx, buildOdt, type FixtureParagraph } from '../src/test/builders.ts'
import {
  MEDIUM_SOP,
  RESPONSIBILITY_TABLE,
  SIMPLE_SOP,
  toFixtureParagraphs,
  toMarkdown,
  toPlainText,
  UNICODE_SOP,
  type Version,
} from '../src/test/sopContent.ts'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

async function write(name: string, data: string | ArrayBuffer): Promise<void> {
  const path = join(OUT_DIR, name)
  await writeFile(path, typeof data === 'string' ? data : Buffer.from(data))
  const size = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength
  console.log(`  ${name.padEnd(28)} ${(size / 1024).toFixed(1)} KB`)
}

async function main(): Promise<void> {
  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(OUT_DIR, { recursive: true })
  console.log(`Writing fixtures to ${OUT_DIR}`)

  for (const version of ['v1', 'v2'] as Version[]) {
    await write(`simple-sop_${version}.md`, toMarkdown(SIMPLE_SOP, version))
    await write(`medium-sop_${version}.txt`, toPlainText(MEDIUM_SOP, version))
    await write(`unicode-sop_${version}.txt`, toPlainText(UNICODE_SOP, version))

    // The ODT and DOCX pair carries headings, lists, emphasis and a table, so
    // one comparison exercises every structural feature Phase 1 handles.
    const paragraphs = [
      ...toFixtureParagraphs(SIMPLE_SOP, version),
      { heading: 2, text: 'Annexe A: Responsibilities' } satisfies FixtureParagraph,
      RESPONSIBILITY_TABLE[version],
    ]
    await write(`sop_${version}.odt`, await buildOdt(paragraphs))
    await write(`sop_${version}.docx`, await buildDocx(paragraphs))
  }

  // Not a ZIP archive, for checking the corrupt-file error path by hand.
  await write('corrupt.docx', 'This file has a .docx name but is plain text.\n')

  console.log('\nCompare the matching v1/v2 pairs in the app.')
}

await main()
