import type { RunFormatting, TextRun } from '../../types/document.ts'
import { formatsEqual } from './xml.ts'

/**
 * Accumulates text with formatting, coalescing neighbouring characters that
 * share the same formatting into a single run.
 *
 * Producers split text into runs for reasons that have nothing to do with
 * appearance (spell-check state, revision ids, language tags). Coalescing here
 * means the formatting-change detector only ever sees genuine style boundaries.
 */
export class RunBuilder {
  private readonly runs: TextRun[] = []

  push(text: string, format: RunFormatting): void {
    if (text === '') return
    const last = this.runs[this.runs.length - 1]
    if (last && formatsEqual(last.format, format)) {
      last.text += text
    } else {
      this.runs.push({ text, format: { ...format } })
    }
  }

  get length(): number {
    return this.runs.reduce((n, r) => n + r.text.length, 0)
  }

  /** Returns the runs with leading/trailing whitespace trimmed off the edges. */
  finish(): TextRun[] {
    const runs = this.runs
    while (runs.length > 0) {
      runs[0].text = runs[0].text.replace(/^\s+/, '')
      if (runs[0].text === '') runs.shift()
      else break
    }
    while (runs.length > 0) {
      const last = runs[runs.length - 1]
      last.text = last.text.replace(/\s+$/, '')
      if (last.text === '') runs.pop()
      else break
    }
    return runs
  }
}
