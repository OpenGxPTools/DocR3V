/**
 * The diff engine. Two passes, coarse then fine:
 *
 *   1. Align paragraphs, so the comparison knows which old paragraph became
 *      which new one, and which were genuinely inserted or deleted.
 *   2. Diff each aligned pair word by word.
 *
 * Splitting it this way is what keeps a whole-document diff readable. Running
 * one flat word diff across the entire text would let a coincidental word match
 * in section 9 pair up with section 2, scrambling the output.
 *
 * The paragraph pass deliberately skips diff-match-patch's semantic cleanup.
 * Cleanup improves prose readability by absorbing short equalities into the
 * edits around them — desirable inside a sentence, unacceptable across
 * paragraphs, where it would report an untouched paragraph as changed. Spec §9
 * lists "no false positives" as a success criterion.
 */

import {
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
  diffTokenKeys,
  similarity,
  tokenize,
  type Token,
} from './tokenDiff.ts'
import { alignTables } from './tableAlign.ts'
import {
  FORMATTING_KEYS,
  sameCell,
  wordCount,
  type FormattingKey,
  type Paragraph,
  type ParsedDocument,
} from '../types/document.ts'
import type {
  DiffSegment,
  DiffSummary,
  DocumentDiff,
  DocumentMeta,
  FormattingChange,
  ParagraphDiff,
} from '../types/diff.ts'

/**
 * How much two paragraphs must have in common before they are reported as one
 * paragraph that was edited rather than as a deletion plus an insertion.
 *
 * A rewritten clause that keeps its subject and structure lands around 0.5–0.8.
 * The floor is deliberately generous, for two reasons.
 *
 * The two failures are not equally bad. Pairing paragraphs that are not really
 * related shows a noisy word diff — mostly marked-up text, which reads close to
 * a deletion and an insertion anyway, and the reviewer can see that. Failing to
 * pair paragraphs that *are* related shows a wall of red beside a wall of
 * green, which is precisely the behaviour of the tools this app exists to
 * improve on (README, spec §1). The recoverable error is the better one.
 *
 * And a low floor is safer here than it looks, because pairing is decided by an
 * order-preserving optimisation over the whole changed block, not pair by pair.
 * A clause with a near-identical counterpart pairs with that counterpart; the
 * floor only decides what happens to the paragraphs left over, where the choice
 * is between a word diff and a wholesale replacement.
 */
const MIN_PAIR_SIMILARITY = 0.2

/**
 * Length above which the floor above applies in full.
 *
 * Dice over token bags does not fall with length — unrelated SOP clauses share
 * their function words in much the same proportion however long they are, and
 * measured against real-sounding clauses they score 0.4 and up. So a low floor
 * cannot be justified by "long paragraphs overlap less"; it is justified by how
 * much text a given score represents. A quarter of a 60-token clause is 15
 * words of retained wording, which a reviewer needs to see marked up. A quarter
 * of a 6-token heading is one word, most likely "the", and pairing on that
 * evidence would align two unrelated headings.
 */
const SHORT_PARAGRAPH_TOKENS = 12
const SHORT_PARAGRAPH_SIMILARITY = 0.4

/** The floor to apply to a particular pair, by the length of the shorter one. */
function minSimilarityFor(a: string[], b: string[]): number {
  return Math.min(a.length, b.length) < SHORT_PARAGRAPH_TOKENS
    ? SHORT_PARAGRAPH_SIMILARITY
    : MIN_PAIR_SIMILARITY
}

/** Above this many candidate pairings the DP is skipped for positional pairing. */
const MAX_PAIRING_CELLS = 40_000

/**
 * One bit per tracked attribute, in the order FORMATTING_KEYS declares them.
 * Deriving the bits from that list rather than writing them out means a new
 * attribute is detected the moment the parsers set it — there is no second
 * place to update and no way for the two to fall out of step.
 *
 * Uint16Array holds sixteen attributes; the list is at eight. If it ever passes
 * sixteen, widen this to Uint32Array and nothing else needs to change.
 */
const FLAG_LABELS: Array<{ bit: number; kind: FormattingKey }> = FORMATTING_KEYS.map(
  (kind, index) => ({ bit: 1 << index, kind }),
)

/** Per-character formatting flags, indexed by offset into `paragraph.text`. */
function formatFlags(paragraph: Paragraph): Uint16Array {
  const flags = new Uint16Array(paragraph.text.length)
  let offset = 0
  for (const run of paragraph.runs) {
    let value = 0
    for (const { bit, kind } of FLAG_LABELS) {
      if (run.format[kind]) value |= bit
    }
    flags.fill(value, offset, offset + run.text.length)
    offset += run.text.length
  }
  return flags
}

function elide(text: string, limit = 60): string {
  const trimmed = text.trim()
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 1)}…`
}

function describeParagraph(paragraph: Paragraph): string {
  return elide(paragraph.text, 40)
}

/**
 * Reports formatting differences over the stretches of text that both documents
 * share. Changed text is already visible as a word change, so re-reporting its
 * formatting would be noise; only unchanged wording can have a formatting-only
 * change worth flagging. Spec §5.3.
 */
function detectFormattingChanges(
  oldParagraph: Paragraph,
  newParagraph: Paragraph,
  segments: DiffSegment[],
): FormattingChange[] {
  const changes: FormattingChange[] = []

  if (oldParagraph.styleName !== newParagraph.styleName) {
    changes.push({
      kind: 'style',
      phrase: describeParagraph(newParagraph),
      from: oldParagraph.styleName,
      to: newParagraph.styleName,
    })
  }

  const oldFlags = formatFlags(oldParagraph)
  const newFlags = formatFlags(newParagraph)

  for (const segment of segments) {
    if (segment.op !== 'equal') continue
    if (segment.oldOffset === undefined || segment.newOffset === undefined) continue

    // The segment's text may carry a trailing separator that exists on only one
    // side, so compare the length both sides actually have available.
    const length = Math.min(
      segment.text.length,
      oldFlags.length - segment.oldOffset,
      newFlags.length - segment.newOffset,
    )

    let spanStart = -1
    for (let i = 0; i <= length; i++) {
      const differs = i < length && oldFlags[segment.oldOffset + i] !== newFlags[segment.newOffset + i]
      if (differs && spanStart === -1) spanStart = i
      if (!differs && spanStart !== -1) {
        recordSpan(
          changes,
          newParagraph.text.slice(segment.newOffset + spanStart, segment.newOffset + i),
          oldFlags[segment.oldOffset + spanStart],
          newFlags[segment.newOffset + spanStart],
        )
        spanStart = -1
      }
    }
  }

  return changes
}

function recordSpan(
  changes: FormattingChange[],
  phrase: string,
  oldValue: number,
  newValue: number,
): void {
  // A run of pure whitespace picking up a style is invisible to a reader.
  if (phrase.trim() === '') return

  for (const { bit, kind } of FLAG_LABELS) {
    const before = (oldValue & bit) !== 0
    const after = (newValue & bit) !== 0
    if (before === after) continue
    changes.push({
      kind,
      phrase: elide(phrase),
      from: before ? 'on' : 'off',
      to: after ? 'on' : 'off',
    })
  }
}

/** Text of a token range, including the leading edge of the paragraph. */
function sliceTokens(source: string, tokens: Token[], index: number, count: number): string {
  const first = tokens[index]
  const last = tokens[index + count - 1]
  const start = index === 0 ? 0 : first.start
  return source.slice(start, last.start + last.key.length)
}

function buildSegments(oldParagraph: Paragraph, newParagraph: Paragraph): DiffSegment[] {
  const oldTokens = tokenize(oldParagraph.text)
  const newTokens = tokenize(newParagraph.text)
  const spans = diffTokenKeys(
    oldTokens.map((t) => t.key),
    newTokens.map((t) => t.key),
  )

  const segments: DiffSegment[] = []
  for (const span of spans) {
    if (span.op === DIFF_EQUAL) {
      segments.push({
        op: 'equal',
        text: sliceTokens(newParagraph.text, newTokens, span.newIndex, span.count),
        oldOffset: span.oldIndex === 0 ? 0 : oldTokens[span.oldIndex].start,
        newOffset: span.newIndex === 0 ? 0 : newTokens[span.newIndex].start,
      })
    } else if (span.op === DIFF_DELETE) {
      segments.push({
        op: 'delete',
        text: sliceTokens(oldParagraph.text, oldTokens, span.oldIndex, span.count),
        oldOffset: span.oldIndex === 0 ? 0 : oldTokens[span.oldIndex].start,
      })
    } else {
      segments.push({
        op: 'insert',
        text: sliceTokens(newParagraph.text, newTokens, span.newIndex, span.count),
        newOffset: span.newIndex === 0 ? 0 : newTokens[span.newIndex].start,
      })
    }
  }

  // Every segment but the last gets the single space that separates it from
  // whatever follows, so concatenating any subset of them (the old side, the
  // new side, or all of them for the merged view) reads as running text.
  for (let i = 0; i < segments.length - 1; i++) {
    segments[i].text += ' '
  }
  return segments
}

function countWords(segments: DiffSegment[], op: 'insert' | 'delete'): number {
  let total = 0
  for (const segment of segments) {
    if (segment.op === op) total += tokenize(segment.text).length
  }
  return total
}

function comparePair(oldParagraph: Paragraph, newParagraph: Paragraph, key: string): ParagraphDiff {
  const identical = oldParagraph.text === newParagraph.text
  const segments: DiffSegment[] = identical
    ? [{ op: 'equal', text: newParagraph.text, oldOffset: 0, newOffset: 0 }]
    : buildSegments(oldParagraph, newParagraph)

  return {
    key,
    status: identical ? 'unchanged' : 'modified',
    oldParagraph,
    newParagraph,
    segments,
    formattingChanges: detectFormattingChanges(oldParagraph, newParagraph, segments),
    wordsAdded: identical ? 0 : countWords(segments, 'insert'),
    wordsDeleted: identical ? 0 : countWords(segments, 'delete'),
  }
}

function wholeParagraphDiff(paragraph: Paragraph, status: 'added' | 'removed', key: string): ParagraphDiff {
  const words = paragraph.text.trim() === '' ? 0 : tokenize(paragraph.text).length
  return {
    key,
    status,
    oldParagraph: status === 'removed' ? paragraph : undefined,
    newParagraph: status === 'added' ? paragraph : undefined,
    segments: [
      {
        op: status === 'added' ? 'insert' : 'delete',
        text: paragraph.text,
        ...(status === 'added' ? { newOffset: 0 } : { oldOffset: 0 }),
      },
    ],
    formattingChanges: [],
    wordsAdded: status === 'added' ? words : 0,
    wordsDeleted: status === 'removed' ? words : 0,
  }
}

type Pairing = { old?: Paragraph; revised?: Paragraph }

/**
 * Matches deleted paragraphs to inserted ones within one changed block.
 *
 * Order-preserving, because documents do not usually reorder their clauses, and
 * a matching that respects order is far easier to read than one that draws
 * crossing lines. Longest-common-subsequence DP over similarity scores.
 */
/**
 * How willing the aligner is to pair two paragraphs. 0 means never.
 *
 * Table cells are matched by position, not by wording. Two cells of the same
 * grid position describe the same fact — "Responsible role", "Retention period"
 * — so they pair however much their text changed, which is what makes a
 * rewritten cell read as an edit rather than as an unrelated delete and insert.
 * Cells at different positions never pair, however similar they look: a table
 * of short, repetitive values is exactly where text similarity misleads, and
 * pairing row 2 against row 5 would report changes that nobody made.
 *
 * A cell and an ordinary paragraph never pair either. Their similarity is
 * meaningless and the resulting alignment would drag a table row into the body
 * text around it.
 */
function pairScore(
  old: Paragraph,
  revised: Paragraph,
  oldKeys: string[],
  newKeys: string[],
): number {
  if (old.cell || revised.cell) {
    if (!sameCell(old.cell, revised.cell)) return 0
    // Floor the score so an entirely rewritten cell still pairs with its
    // counterpart; the word diff inside it then shows the rewrite.
    return Math.max(similarity(oldKeys, newKeys), MIN_PAIR_SIMILARITY)
  }

  const value = similarity(oldKeys, newKeys)
  return value >= minSimilarityFor(oldKeys, newKeys) ? value : 0
}

function pairBlock(deleted: Paragraph[], inserted: Paragraph[]): Pairing[] {
  if (deleted.length === 0) return inserted.map((revised) => ({ revised }))
  if (inserted.length === 0) return deleted.map((old) => ({ old }))

  const oldKeys = deleted.map((p) => tokenize(p.text).map((t) => t.key))
  const newKeys = inserted.map((p) => tokenize(p.text).map((t) => t.key))

  if (deleted.length * inserted.length > MAX_PAIRING_CELLS) {
    // Wholesale rewrite: fall back to positional pairing rather than spending
    // quadratic time on a block whose alignment is guesswork anyway.
    const pairings: Pairing[] = []
    const shared = Math.min(deleted.length, inserted.length)
    for (let i = 0; i < shared; i++) pairings.push({ old: deleted[i], revised: inserted[i] })
    for (let i = shared; i < deleted.length; i++) pairings.push({ old: deleted[i] })
    for (let i = shared; i < inserted.length; i++) pairings.push({ revised: inserted[i] })
    return pairings
  }

  const rows = deleted.length
  const cols = inserted.length
  const score = Array.from({ length: rows + 1 }, () => new Float64Array(cols + 1))
  const scores = Array.from({ length: rows }, () => new Float64Array(cols))

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      scores[i][j] = pairScore(deleted[i], inserted[j], oldKeys[i], newKeys[j])
    }
  }

  for (let i = 1; i <= rows; i++) {
    for (let j = 1; j <= cols; j++) {
      const paired = scores[i - 1][j - 1] > 0 ? score[i - 1][j - 1] + scores[i - 1][j - 1] : -1
      score[i][j] = Math.max(score[i - 1][j], score[i][j - 1], paired)
    }
  }

  // Walk the table back to recover the chosen pairs, then emit in document
  // order with unpaired paragraphs slotted in where they occurred.
  const pairs: Array<[number, number]> = []
  let i = rows
  let j = cols
  while (i > 0 && j > 0) {
    if (scores[i - 1][j - 1] > 0 && score[i][j] === score[i - 1][j - 1] + scores[i - 1][j - 1]) {
      pairs.push([i - 1, j - 1])
      i--
      j--
    } else if (score[i - 1][j] >= score[i][j - 1]) {
      i--
    } else {
      j--
    }
  }
  pairs.reverse()

  const pairings: Pairing[] = []
  let oldCursor = 0
  let newCursor = 0
  for (const [oldIndex, newIndex] of pairs) {
    for (; oldCursor < oldIndex; oldCursor++) pairings.push({ old: deleted[oldCursor] })
    for (; newCursor < newIndex; newCursor++) pairings.push({ revised: inserted[newCursor] })
    pairings.push({ old: deleted[oldIndex], revised: inserted[newIndex] })
    oldCursor = oldIndex + 1
    newCursor = newIndex + 1
  }
  for (; oldCursor < deleted.length; oldCursor++) pairings.push({ old: deleted[oldCursor] })
  for (; newCursor < inserted.length; newCursor++) pairings.push({ revised: inserted[newCursor] })
  return pairings
}

function describe(document: ParsedDocument): DocumentMeta {
  return {
    fileName: document.fileName,
    format: document.format,
    byteSize: document.byteSize,
    paragraphCount: document.paragraphs.length,
    wordCount: wordCount(document),
  }
}

function summarize(paragraphs: ParagraphDiff[]): DiffSummary {
  const summary: DiffSummary = {
    wordsAdded: 0,
    wordsDeleted: 0,
    paragraphsAdded: 0,
    paragraphsRemoved: 0,
    paragraphsModified: 0,
    paragraphsUnchanged: 0,
    formattingChanges: 0,
  }
  for (const paragraph of paragraphs) {
    summary.wordsAdded += paragraph.wordsAdded
    summary.wordsDeleted += paragraph.wordsDeleted
    summary.formattingChanges += paragraph.formattingChanges.length
    switch (paragraph.status) {
      case 'added':
        summary.paragraphsAdded++
        break
      case 'removed':
        summary.paragraphsRemoved++
        break
      case 'modified':
        summary.paragraphsModified++
        break
      case 'unchanged':
        summary.paragraphsUnchanged++
        break
    }
  }
  return summary
}

export function diffDocuments(original: ParsedDocument, revised: ParsedDocument): DocumentDiff {
  const started = performance.now()

  // Table coordinates are only comparable once both grids are numbered the same
  // way; a single inserted row would otherwise shift every cell beneath it out
  // of alignment and rewrite the rest of the table in the report.
  const aligned = alignTables(original, revised)
  const oldParagraphs = aligned.original
  const newParagraphs = aligned.revised
  const spans = diffTokenKeys(
    oldParagraphs.map((p) => p.text),
    newParagraphs.map((p) => p.text),
    { cleanup: false },
  )

  const paragraphs: ParagraphDiff[] = []
  let nextKey = 0
  const key = () => `d${nextKey++}`

  let index = 0
  while (index < spans.length) {
    if (spans[index].op === DIFF_EQUAL) {
      const span = spans[index]
      for (let k = 0; k < span.count; k++) {
        paragraphs.push(
          comparePair(oldParagraphs[span.oldIndex + k], newParagraphs[span.newIndex + k], key()),
        )
      }
      index++
      continue
    }

    // Gather the whole run of adjacent edits before pairing: diff-match-patch
    // emits deletions and insertions as separate spans, and a paragraph that
    // was edited shows up as one of each.
    const deleted: Paragraph[] = []
    const inserted: Paragraph[] = []
    while (index < spans.length && spans[index].op !== DIFF_EQUAL) {
      const span = spans[index]
      if (span.op === DIFF_DELETE) {
        for (let k = 0; k < span.count; k++) deleted.push(oldParagraphs[span.oldIndex + k])
      } else if (span.op === DIFF_INSERT) {
        for (let k = 0; k < span.count; k++) inserted.push(newParagraphs[span.newIndex + k])
      }
      index++
    }

    for (const pairing of pairBlock(deleted, inserted)) {
      if (pairing.old && pairing.revised) {
        paragraphs.push(comparePair(pairing.old, pairing.revised, key()))
      } else if (pairing.old) {
        paragraphs.push(wholeParagraphDiff(pairing.old, 'removed', key()))
      } else if (pairing.revised) {
        paragraphs.push(wholeParagraphDiff(pairing.revised, 'added', key()))
      }
    }
  }

  return {
    original: describe(original),
    revised: describe(revised),
    paragraphs,
    summary: summarize(paragraphs),
    generatedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
  }
}
