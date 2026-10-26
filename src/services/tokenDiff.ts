/**
 * Word-level diffing built on Google's diff-match-patch.
 *
 * diff-match-patch works on characters. Running it directly on prose produces
 * exactly the noise this app exists to remove — "Manager" vs "Managers" comes
 * back as a one-character insert buried inside a word. The fix is the same
 * trick the library uses for its own line mode: map every distinct *token* to a
 * single private character, diff those, then expand the result. The algorithm
 * then cannot see inside a word, so every boundary it reports is a word
 * boundary. See spec §5.2.
 */

import DiffMatchPatch from 'diff-match-patch'

export const DIFF_DELETE = -1
export const DIFF_INSERT = 1
export const DIFF_EQUAL = 0

export type RawOp = -1 | 0 | 1

export interface Token {
  /** Value compared against other tokens. */
  key: string
  /** Source text for this token, including the whitespace that follows it. */
  text: string
  /** Offset of the token in the source string. */
  start: number
}

export interface TokenSpan {
  op: RawOp
  /** Index of the first token, in whichever side(s) the op applies to. */
  oldIndex: number
  newIndex: number
  count: number
}

/**
 * diff-match-patch compares UTF-16 code units, so each token needs a distinct
 * BMP character. Surrogates are excluded because a lone surrogate is not a
 * valid string character and would be mangled by normalisation.
 */
const FIRST_CODE = 0x0001
const SURROGATE_START = 0xd800
const SURROGATE_END = 0xdfff
const LAST_CODE = 0xfffd
export const MAX_DISTINCT_TOKENS = LAST_CODE - FIRST_CODE - (SURROGATE_END - SURROGATE_START)

export class DiffLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiffLimitError'
  }
}

/**
 * Splits text into tokens on whitespace. Each token carries the whitespace that
 * follows it, so concatenating a sequence of token texts reproduces the source
 * exactly — which is what lets the renderer stitch segments back together
 * without inventing or losing spaces.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  const pattern = /\S+/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    tokens.push({ key: match[0], text: '', start: match.index })
  }
  for (let i = 0; i < tokens.length; i++) {
    const end = i + 1 < tokens.length ? tokens[i + 1].start : source.length
    tokens[i].text = source.slice(tokens[i].start, end)
  }
  return tokens
}

class TokenEncoder {
  private readonly codes = new Map<string, string>()
  private next = FIRST_CODE

  encode(keys: string[]): string {
    let out = ''
    for (const key of keys) {
      let code = this.codes.get(key)
      if (code === undefined) {
        if (this.next === SURROGATE_START) this.next = SURROGATE_END + 1
        if (this.next > LAST_CODE) {
          throw new DiffLimitError(
            `This comparison involves more than ${MAX_DISTINCT_TOKENS.toLocaleString()} distinct items, which is beyond what the diff engine can index.`,
          )
        }
        code = String.fromCharCode(this.next++)
        this.codes.set(key, code)
      }
      out += code
    }
    return out
  }
}

/**
 * Diffs two token sequences, returning spans that index back into them.
 *
 * `cleanupSemantic` is what turns a scatter of coincidental single-word matches
 * into one readable "old phrase → new phrase" replacement. It runs on the
 * encoded string, so it can only ever cut at token boundaries.
 */
export function diffTokenKeys(
  oldKeys: string[],
  newKeys: string[],
  options: { cleanup?: boolean } = {},
): TokenSpan[] {
  const encoder = new TokenEncoder()
  const encodedOld = encoder.encode(oldKeys)
  const encodedNew = encoder.encode(newKeys)

  const dmp = new DiffMatchPatch()
  // Documents are capped at 5 MB and diffing happens per paragraph, so the
  // default one-second bail-out would only ever fire on pathological input.
  dmp.Diff_Timeout = 5
  const diffs = dmp.diff_main(encodedOld, encodedNew, false)
  if (options.cleanup !== false) dmp.diff_cleanupSemantic(diffs)

  const spans: TokenSpan[] = []
  let oldIndex = 0
  let newIndex = 0
  for (const [op, chars] of diffs) {
    if (chars.length === 0) continue
    spans.push({ op: op as RawOp, oldIndex, newIndex, count: chars.length })
    if (op !== DIFF_INSERT) oldIndex += chars.length
    if (op !== DIFF_DELETE) newIndex += chars.length
  }
  return spans
}

/** Dice coefficient over token bags: 0 = nothing in common, 1 = same tokens. */
export function similarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1
  if (a.length === 0 || b.length === 0) return 0

  const counts = new Map<string, number>()
  for (const key of a) counts.set(key, (counts.get(key) ?? 0) + 1)

  let shared = 0
  for (const key of b) {
    const remaining = counts.get(key)
    if (remaining !== undefined && remaining > 0) {
      counts.set(key, remaining - 1)
      shared++
    }
  }
  return (2 * shared) / (a.length + b.length)
}
