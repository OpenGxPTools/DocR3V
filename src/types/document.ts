/**
 * Shared shape that every format parser (ODT, DOCX, Markdown, TXT) produces.
 *
 * Keeping one structure means the diff engine never has to know which format a
 * document came from — it only ever sees paragraphs, runs and style names.
 */

export type SupportedFormat = 'odt' | 'docx' | 'md' | 'txt'

export const SUPPORTED_EXTENSIONS: Record<string, SupportedFormat> = {
  odt: 'odt',
  docx: 'docx',
  md: 'md',
  markdown: 'md',
  txt: 'txt',
}

/**
 * Inline character formatting we track — see spec §5.3.
 *
 * This list is the single definition of what the application can detect.
 * Everything downstream derives from it: the equality test, the "is this run
 * plain" test, the per-character flag bits in the diff engine, the wording of
 * the formatting notes, and the legend shown to the reviewer. Adding an
 * attribute means adding it here, teaching each parser to read it, and saying
 * how to render it — never hunting for comparison functions that silently
 * ignore the new field.
 *
 * Every attribute here is a plain on/off property of a run. Value-bearing
 * properties (colour, highlight, font, size) do not belong in this list; they
 * need a comparison that reports what the value changed *to*, not merely that
 * it changed.
 */
export const FORMATTING_KEYS = [
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'superscript',
  'subscript',
  'allCaps',
  'smallCaps',
] as const

export type FormattingKey = (typeof FORMATTING_KEYS)[number]

export type RunFormatting = Record<FormattingKey, boolean>

export const PLAIN: RunFormatting = Object.freeze(
  Object.fromEntries(FORMATTING_KEYS.map((key) => [key, false])),
) as RunFormatting

/** True when two runs carry identical formatting across every tracked attribute. */
export function formatsEqual(a: RunFormatting, b: RunFormatting): boolean {
  return FORMATTING_KEYS.every((key) => a[key] === b[key])
}

/** True when a run carries no formatting at all, and can be emitted as bare text. */
export function isPlain(format: RunFormatting): boolean {
  return FORMATTING_KEYS.every((key) => !format[key])
}

/** A stretch of text sharing identical inline formatting. */
export interface TextRun {
  text: string
  format: RunFormatting
}

export type ParagraphKind = 'heading' | 'paragraph' | 'listItem' | 'code'

/**
 * Where a paragraph sits inside a table. Spec §5.6, Phase 2.
 *
 * Paragraphs stay a flat list even inside tables — the diff engine aligns a
 * sequence, and giving it a tree would mean rewriting the part of this app that
 * works. The coordinates are what let the renderer rebuild the grid and, more
 * importantly, what let the aligner refuse to pair cell (2,1) of one document
 * with cell (5,3) of the other: in a table of similar short cells, plain text
 * similarity will happily make that mistake, and a reviewer reading "Quality
 * Manager became 3 days" has been actively misled.
 */
export interface TableCell {
  /** 0-based index of the table within the document. */
  table: number
  row: number
  column: number
  /** Paragraph's position within its own cell; cells may hold several. */
  offset: number
  /**
   * How many columns and rows this cell spans. Both default to 1.
   *
   * Merges have to be carried through rather than flattened. Rendering a merged
   * cell as several separate ones puts empty boxes where the document has a
   * single heading, which misrepresents the layout a reviewer is checking
   * against a controlled original. They also matter for the comparison itself:
   * a cell's column index is only meaningful if spans are counted, so a table
   * with merges would otherwise give the same cell different coordinates in the
   * two versions and stop it pairing.
   */
  columnSpan?: number
  rowSpan?: number
}

export interface Paragraph {
  /** Position in the document, 0-based. Used for stable keys and line numbers. */
  index: number
  kind: ParagraphKind
  /** Heading level (1–6) or list nesting depth. Undefined for body text. */
  level?: number
  /** Human-readable style name, e.g. "Heading 1", "Body Text". */
  styleName: string
  runs: TextRun[]
  /** Concatenated plain text of all runs. Cached because the diff engine is hot. */
  text: string
  /** True when this paragraph sits inside a table. */
  inTable?: boolean
  /** Set for every paragraph inside a table; undefined for body text. */
  cell?: TableCell
}

/** Same table, same row, same column — the two paragraphs describe one cell. */
export function sameCell(a: TableCell | undefined, b: TableCell | undefined): boolean {
  if (!a || !b) return false
  // Position within the cell is deliberately not part of this test. A cell's
  // identity is where it sits in the grid; `offset` only orders the paragraphs
  // inside it. Requiring it to match meant a cell that gained or lost a
  // paragraph shifted every later one out of alignment, so they could never
  // pair again and each came back as a deletion plus an insertion. Which
  // paragraph within a cell pairs with which is the aligner's decision, not a
  // precondition for considering them at all.
  return a.table === b.table && a.row === b.row && a.column === b.column
}

export interface ParsedDocument {
  fileName: string
  format: SupportedFormat
  byteSize: number
  paragraphs: Paragraph[]
}

export function wordCount(document: ParsedDocument): number {
  let count = 0
  for (const paragraph of document.paragraphs) {
    const trimmed = paragraph.text.trim()
    if (trimmed !== '') count += trimmed.split(/\s+/).length
  }
  return count
}

/** Errors carrying a message that is safe (and useful) to show to a reviewer. */
export class DocumentParseError extends Error {
  /** Optional second line offering the reviewer a way forward. */
  hint?: string

  constructor(message: string, hint?: string) {
    super(message)
    this.name = 'DocumentParseError'
    this.hint = hint
  }
}

/**
 * Collapses every whitespace run to a single space and trims the paragraph
 * edges, keeping each surviving character's formatting.
 *
 * Spec §5.2 calls for this before diffing: a reviewer does not want a change
 * reported because the author typed two spaces after a full stop. Doing it at
 * construction time means offsets into `text` and offsets into `runs` always
 * agree, which is what the formatting-change detector relies on.
 */
function normalizeRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = []
  let started = false
  let spaceEmitted = false

  for (const run of runs) {
    let text = ''
    for (const char of run.text) {
      if (/\s/.test(char)) {
        // The space is emitted here, in the run it came from, rather than
        // deferred to the next non-space character. Deferring it would move the
        // space across a formatting boundary — "the " + bold "Manager" would
        // become "the" + bold " Manager" — and the formatting-change detector
        // would then see a space that gained bold.
        if (started && !spaceEmitted) {
          text += ' '
          spaceEmitted = true
        }
        continue
      }
      text += char
      started = true
      spaceEmitted = false
    }
    if (text === '') continue

    const last = out[out.length - 1]
    // Must compare every tracked attribute: merging two runs that differ only
    // in an attribute this test forgets would erase that attribute outright,
    // before the diff engine ever sees it.
    if (last && formatsEqual(last.format, run.format)) {
      last.text += text
    } else {
      out.push({ text, format: { ...run.format } })
    }
  }

  // A trailing space survives the loop because the loop cannot know a run is
  // the last one; drop it, along with any run left empty by doing so.
  while (out.length > 0) {
    const last = out[out.length - 1]
    last.text = last.text.replace(/\s+$/, '')
    if (last.text === '') out.pop()
    else break
  }
  return out
}

export function makeParagraph(
  index: number,
  runs: TextRun[],
  options: Partial<Omit<Paragraph, 'index' | 'runs' | 'text'>> = {},
): Paragraph {
  const kind = options.kind ?? 'paragraph'
  // Indentation is meaningful inside a code block, so it survives untouched.
  const normalized = kind === 'code' ? runs : normalizeRuns(runs)
  return {
    index,
    kind,
    level: options.level,
    styleName: options.styleName ?? 'Body Text',
    inTable: options.inTable ?? (options.cell ? true : undefined),
    cell: options.cell,
    runs: normalized,
    text: normalized.map((r) => r.text).join(''),
  }
}
