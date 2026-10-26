/**
 * Markdown parser.
 *
 * Deliberately not a full CommonMark implementation. It recovers the structure
 * that matters for a document review — headings, list nesting, code blocks and
 * bold/italic emphasis — and treats everything else as body text. Pulling in a
 * full Markdown engine would give us an HTML tree we would only have to walk
 * back into paragraphs anyway.
 */

import {
  makeParagraph,
  PLAIN,
  type Paragraph,
  type ParsedDocument,
  type RunFormatting,
  type TextRun,
} from '../../types/document.ts'
import { RunBuilder } from './runs.ts'

const ATX_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/
const BLOCKQUOTE = /^\s*>\s?(.*)$/
const HORIZONTAL_RULE = /^\s*(?:[-*_]\s*){3,}$/
const SETEXT_UNDERLINE = /^\s*(=+|-+)\s*$/

/** Escapes recognised by CommonMark; a backslash before anything else is literal. */
const ESCAPABLE = new Set('\\`*_{}[]()#+-.!>|~'.split(''))

/**
 * Converts inline Markdown to formatted runs.
 *
 * Emphasis is handled as a toggle rather than a delimiter stack: for the
 * well-formed Markdown that document authors write, the two agree, and the
 * toggle degrades to plain text on unbalanced markers instead of failing.
 */
export function parseInline(source: string): TextRun[] {
  const builder = new RunBuilder()
  const format: RunFormatting = { ...PLAIN }
  let buffer = ''

  const flush = () => {
    if (buffer !== '') {
      builder.push(buffer, format)
      buffer = ''
    }
  }

  let i = 0
  while (i < source.length) {
    const char = source[i]

    if (char === '\\' && i + 1 < source.length && ESCAPABLE.has(source[i + 1])) {
      buffer += source[i + 1]
      i += 2
      continue
    }

    // Inline code: contents are literal, and the backticks themselves vanish.
    if (char === '`') {
      const fence = /^`+/.exec(source.slice(i))![0]
      const close = source.indexOf(fence, i + fence.length)
      if (close !== -1) {
        buffer += source.slice(i + fence.length, close)
        i = close + fence.length
        continue
      }
    }

    // Images carry no reviewable text; links keep their label and drop the URL.
    if (char === '!' && source[i + 1] === '[') {
      const link = matchLink(source, i + 1)
      if (link) {
        i = link.end
        continue
      }
    }
    if (char === '[') {
      const link = matchLink(source, i)
      if (link) {
        flush()
        builder.push(link.label, format)
        i = link.end
        continue
      }
    }

    // GFM strikethrough: ~~text~~. A single tilde is literal, so only a run of
    // two or more toggles the attribute.
    if (char === '~' && source[i + 1] === '~') {
      const marker = /^~+/.exec(source.slice(i))![0]
      flush()
      format.strikethrough = !format.strikethrough
      i += marker.length
      continue
    }

    if (char === '*' || char === '_') {
      const marker = /^(\*+|_+)/.exec(source.slice(i))![0]
      // Intra-word underscores (snake_case, file_name_v2) are not emphasis.
      const intraword =
        char === '_' && isWordChar(source[i - 1]) && isWordChar(source[i + marker.length])
      if (!intraword) {
        flush()
        if (marker.length >= 2) format.bold = !format.bold
        if (marker.length === 1 || marker.length >= 3) format.italic = !format.italic
        i += marker.length
        continue
      }
    }

    buffer += char
    i++
  }

  flush()
  return builder.finish()
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}_]/u.test(char)
}

function matchLink(source: string, start: number): { label: string; end: number } | undefined {
  let depth = 0
  let i = start
  for (; i < source.length; i++) {
    if (source[i] === '\\') {
      i++
      continue
    }
    if (source[i] === '[') depth++
    else if (source[i] === ']') {
      depth--
      if (depth === 0) break
    }
  }
  if (depth !== 0 || source[i] !== ']') return undefined

  const label = source.slice(start + 1, i)
  const after = source[i + 1]
  if (after !== '(' && after !== '[') return { label, end: i + 1 }

  const closer = after === '(' ? ')' : ']'
  const close = source.indexOf(closer, i + 2)
  if (close === -1) return { label, end: i + 1 }
  return { label, end: close + 1 }
}

export function parseMarkdown(source: string, fileName: string, byteSize: number): ParsedDocument {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const paragraphs: Paragraph[] = []
  let pending: string[] = []

  const flushPending = () => {
    if (pending.length === 0) return
    // A soft line break inside a paragraph is not a semantic break, so the
    // lines are joined before diffing.
    const runs = parseInline(pending.join(' '))
    pending = []
    if (runs.length > 0) paragraphs.push(makeParagraph(paragraphs.length, runs))
  }

  const push = (runs: TextRun[], options: Parameters<typeof makeParagraph>[2]) => {
    if (runs.length > 0) paragraphs.push(makeParagraph(paragraphs.length, runs, options))
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const fence = FENCE.exec(line)
    if (fence) {
      flushPending()
      const closer = fence[2][0]
      // Each code line becomes its own paragraph: line-level granularity is
      // what a reviewer wants when reading a diff of code or a config block.
      i++
      for (; i < lines.length; i++) {
        const inner = FENCE.exec(lines[i])
        if (inner && inner[2][0] === closer && inner[3].trim() === '') break
        if (lines[i].trim() === '') continue
        push([{ text: lines[i], format: { ...PLAIN } }], { kind: 'code', styleName: 'Code' })
      }
      continue
    }

    if (line.trim() === '') {
      flushPending()
      continue
    }

    if (HORIZONTAL_RULE.test(line) && pending.length === 0) continue

    const heading = ATX_HEADING.exec(line)
    if (heading) {
      flushPending()
      push(parseInline(heading[2]), {
        kind: 'heading',
        level: heading[1].length,
        styleName: `Heading ${heading[1].length}`,
      })
      continue
    }

    // Setext heading: the underline retroactively promotes the line above it.
    const setext = SETEXT_UNDERLINE.exec(line)
    if (setext && pending.length === 1) {
      const level = setext[1][0] === '=' ? 1 : 2
      const text = pending[0]
      pending = []
      push(parseInline(text), { kind: 'heading', level, styleName: `Heading ${level}` })
      continue
    }

    const listItem = LIST_ITEM.exec(line)
    if (listItem) {
      flushPending()
      // Markdown nests lists by indentation; two spaces per level is the common
      // convention and four is the other, so treat any indent step as one level.
      const level = Math.floor(listItem[1].replace(/\t/g, '  ').length / 2) + 1
      push(parseInline(listItem[2]), { kind: 'listItem', level, styleName: 'List Item' })
      continue
    }

    const quote = BLOCKQUOTE.exec(line)
    pending.push(quote ? quote[1] : line.trim())
  }

  flushPending()
  return { fileName, format: 'md', byteSize, paragraphs }
}
