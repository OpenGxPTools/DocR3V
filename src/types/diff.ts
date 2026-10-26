/** Structured output of the diff engine. See spec §5.2 and §7.3. */

import type { FormattingKey, Paragraph, SupportedFormat } from './document.ts'

export type SegmentOp = 'equal' | 'insert' | 'delete'

/** Which document a rendering is showing: one column, the other, or both merged. */
export type Side = 'original' | 'revised' | 'merged'

/** A word-aligned run of text sharing one diff operation. */
export interface DiffSegment {
  op: SegmentOp
  text: string
  /** Character offset into the original paragraph text (undefined for inserts). */
  oldOffset?: number
  /** Character offset into the revised paragraph text (undefined for deletes). */
  newOffset?: number
}

export type ParagraphStatus = 'unchanged' | 'modified' | 'added' | 'removed'

/** Any tracked inline attribute, plus the paragraph-level style name. */
export type FormattingKind = FormattingKey | 'style'

/**
 * A formatting-only change. Reported separately from text segments so that it
 * can be rendered as a quiet badge rather than competing with word changes.
 */
export interface FormattingChange {
  kind: FormattingKind
  /** The text the change applies to (trimmed, possibly elided). */
  phrase: string
  from: string
  to: string
}

export interface ParagraphDiff {
  key: string
  status: ParagraphStatus
  oldParagraph?: Paragraph
  newParagraph?: Paragraph
  /** Word-level segments. For added/removed paragraphs this is a single segment. */
  segments: DiffSegment[]
  formattingChanges: FormattingChange[]
  wordsAdded: number
  wordsDeleted: number
}

export interface DiffSummary {
  wordsAdded: number
  wordsDeleted: number
  paragraphsAdded: number
  paragraphsRemoved: number
  paragraphsModified: number
  paragraphsUnchanged: number
  formattingChanges: number
}

export interface DocumentMeta {
  fileName: string
  format: SupportedFormat
  byteSize: number
  paragraphCount: number
  wordCount: number
}

export interface DocumentDiff {
  original: DocumentMeta
  revised: DocumentMeta
  paragraphs: ParagraphDiff[]
  summary: DiffSummary
  /** ISO timestamp of when the comparison ran. */
  generatedAt: string
  /** Milliseconds spent in the diff engine. */
  durationMs: number
}
