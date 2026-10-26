/**
 * Structural styling shared by the side-by-side and merged views, so a heading
 * looks like a heading in both.
 */

import type { Paragraph } from '../types/document.ts'

export function paragraphClasses(paragraph: Paragraph | undefined): string {
  if (!paragraph) return ''
  switch (paragraph.kind) {
    case 'heading':
      return paragraph.level === 1
        ? 'text-xl font-bold tracking-tight'
        : paragraph.level === 2
          ? 'text-lg font-bold'
          : 'text-base font-semibold'
    case 'code':
      return 'font-mono text-[0.8125rem] whitespace-pre-wrap'
    case 'listItem':
      return 'before:content-["•"] before:absolute before:-left-4 before:text-note relative'
    default:
      return ''
  }
}

/** Indentation for nested list items; headings and body text sit flush. */
export function paragraphIndent(paragraph: Paragraph | undefined): string | undefined {
  if (!paragraph || paragraph.kind !== 'listItem') return undefined
  return `${Math.min(paragraph.level ?? 1, 5) * 1.25}rem`
}
