/**
 * Self-contained HTML report generation. Spec §5.7.
 *
 * The output is one file with no external references — no stylesheet, no font,
 * no script. That matters for the intended use: the report gets emailed to a
 * reviewer, printed for a signature, or filed in a document management system,
 * and it has to render identically years later on a machine that has never
 * heard of this app.
 */

import {
  describeFormattingChange,
  describeSummary,
  plural,
  splitTrailingSpace,
} from './formatting.ts'
import { APP_NAME, APP_VERSION } from '../version.ts'
import { styledPieces } from './segmentPieces.ts'
import { cellStatus, toBlocks, type TableBlock } from './tableBlocks.ts'
import type { DiffSegment, DocumentDiff, ParagraphDiff, Side } from '../types/diff.ts'
import type { Paragraph } from '../types/document.ts'

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const SIDE_OPS: Record<Side, ReadonlySet<string>> = {
  original: new Set(['equal', 'delete']),
  revised: new Set(['equal', 'insert']),
  merged: new Set(['equal', 'delete', 'insert']),
}

/**
 * Applies the document's own inline formatting within one segment.
 *
 * Mirrors ParagraphText.Formatted: text present in both documents is drawn as
 * *its own side* formats it, so the exported original column shows the original
 * formatting rather than the revision's. Capitalisation travels as an inline
 * style because Word and LibreOffice honour those on a pasted fragment but
 * ignore a stylesheet.
 */
function renderFormatted(
  segment: DiffSegment,
  text: string,
  diff: ParagraphDiff,
  side: Side,
): string {
  const fromOriginal = segment.op === 'delete' || (segment.op === 'equal' && side === 'original')
  const source = fromOriginal ? diff.oldParagraph : diff.newParagraph
  const offset = fromOriginal ? segment.oldOffset : segment.newOffset

  let html = ''
  for (const piece of styledPieces(source, offset, text)) {
    let inner = escapeHtml(piece.text)
    if (piece.format.allCaps) inner = `<span style="text-transform:uppercase">${inner}</span>`
    if (piece.format.smallCaps) inner = `<span style="font-variant-caps:small-caps">${inner}</span>`
    if (piece.format.superscript) inner = `<sup>${inner}</sup>`
    if (piece.format.subscript) inner = `<sub>${inner}</sub>`
    if (piece.format.strikethrough) inner = `<s>${inner}</s>`
    if (piece.format.underline) inner = `<u>${inner}</u>`
    if (piece.format.italic) inner = `<em>${inner}</em>`
    if (piece.format.bold) inner = `<strong>${inner}</strong>`
    html += inner
  }
  return html
}

export function renderSegments(segments: DiffSegment[], side: Side, diff: ParagraphDiff): string {
  const allowed = SIDE_OPS[side]
  let html = ''
  for (const segment of segments) {
    if (!allowed.has(segment.op)) continue
    if (segment.op === 'equal') {
      html += renderFormatted(segment, segment.text, diff, side)
      continue
    }
    const [core, trailing] = splitTrailingSpace(segment.text)
    const tag = segment.op === 'delete' ? 'del' : 'ins'
    html += `<${tag}>${renderFormatted(segment, core, diff, side)}</${tag}>${escapeHtml(trailing)}`
  }
  return html
}

function paragraphAttributes(paragraph: Paragraph | undefined): string {
  if (!paragraph) return ' class="body"'
  if (paragraph.kind === 'heading') return ` class="h h${Math.min(paragraph.level ?? 1, 6)}"`
  if (paragraph.kind === 'code') return ' class="code"'
  if (paragraph.kind === 'listItem') {
    return ` class="li" style="margin-left:${Math.min(paragraph.level ?? 1, 5) * 1.25}rem"`
  }
  return ' class="body"'
}

function renderNotes(diff: ParagraphDiff): string {
  if (diff.formattingChanges.length === 0) return ''
  const items = diff.formattingChanges
    .map((change) => `<li>${escapeHtml(describeFormattingChange(change))}</li>`)
    .join('')
  return `<ul class="notes">${items}</ul>`
}

/**
 * A table as one grid, drawn the same way for either side.
 *
 * The report and the screen share `toBlocks`, so a reviewer comparing the two
 * cannot find a cell in one that is missing or differently placed in the other.
 */
function renderTable(block: TableBlock, side: Side): string {
  const rows = block.rows
    .map((row) => {
      const cells = row
        .map((cell, column) => {
          // A merged cell already covers this position; drawing it as well
          // would put an empty box where the document has none.
          if (cell.covered) return ''
          const status = cellStatus(cell.diffs)
          const present = cell.diffs.filter((diff) =>
            side === 'original' ? diff.oldParagraph : side === 'revised' ? diff.newParagraph : true,
          )
          const body = present
            .map(
              (diff) =>
                `<p${paragraphAttributes(diff.newParagraph ?? diff.oldParagraph)}>` +
                `${renderSegments(diff.segments, side, diff)}</p>` +
                (side === 'original' ? '' : renderNotes(diff)),
            )
            .join('')
          const span =
            (cell.columnSpan > 1 ? ` colspan="${cell.columnSpan}"` : '') +
            (cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : '')
          return `<td class="tc"${span} data-status="${status}" data-column="${column}">${body}</td>`
        })
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')

  return `<table class="grid"><tbody>${rows}</tbody></table>`
}

function renderMerged(diff: DocumentDiff): string {
  return toBlocks(diff.paragraphs)
    .map((block) => {
      if (block.kind === 'table') return renderTable(block, 'merged')
      const paragraph = block.diff
      const source = paragraph.newParagraph ?? paragraph.oldParagraph
      return (
        `<div class="row" data-status="${paragraph.status}">` +
        `<p${paragraphAttributes(source)}>${renderSegments(paragraph.segments, 'merged', paragraph)}</p>` +
        renderNotes(paragraph) +
        '</div>'
      )
    })
    .join('\n')
}

function renderSideBySide(diff: DocumentDiff): string {
  const rows = toBlocks(diff.paragraphs)
    .map((block) => {
      if (block.kind === 'table') {
        return (
          '<tr data-status="table">' +
          `<td>${renderTable(block, 'original')}</td>` +
          `<td>${renderTable(block, 'revised')}</td>` +
          '</tr>'
        )
      }
      const paragraph = block.diff
      const cell = (side: 'original' | 'revised') => {
        const source = side === 'original' ? paragraph.oldParagraph : paragraph.newParagraph
        if (!source) {
          const label = paragraph.status === 'added' ? 'Not in the original' : 'Not in the revision'
          return `<td class="absent"><span class="muted">${label}</span></td>`
        }
        const notes = side === 'revised' ? renderNotes(paragraph) : ''
        return (
          `<td><span class="num">${source.index + 1}</span>` +
          `<p${paragraphAttributes(source)}>${renderSegments(paragraph.segments, side, paragraph)}</p>` +
          `${notes}</td>`
        )
      }
      return `<tr data-status="${paragraph.status}">${cell('original')}${cell('revised')}</tr>`
    })
    .join('\n')

  return (
    '<table class="sbs"><thead><tr>' +
    `<th>Original — ${escapeHtml(diff.original.fileName)}</th>` +
    `<th>Revised — ${escapeHtml(diff.revised.fileName)}</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>`
  )
}

/**
 * The mark, inlined as markup rather than referenced as a file. A report that
 * pointed at an image would lose its logo the moment it was emailed onward,
 * which is precisely the journey these reports make.
 */
const BRAND_MARK_SVG =
  '<svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true">' +
  '<rect width="32" height="32" rx="7" fill="#1F2937"/>' +
  '<line x1="16" y1="7" x2="16" y2="25" stroke="#fff" stroke-opacity=".22" stroke-width="1"/>' +
  '<g fill="#fff" fill-opacity=".5">' +
  '<rect x="6" y="10" width="7" height="2" rx="1"/>' +
  '<rect x="6" y="15" width="7" height="2" rx="1"/>' +
  '<rect x="6" y="20" width="5" height="2" rx="1"/></g>' +
  '<rect x="19" y="10" width="7" height="2" rx="1" fill="#fff" fill-opacity=".5"/>' +
  '<rect x="19" y="15" width="7" height="2" rx="1" fill="#F87171"/>' +
  '<rect x="19" y="20" width="5" height="2" rx="1" fill="#4ADE80"/></svg>'

/**
 * Styling is duplicated here rather than shared with the app's Tailwind sheet:
 * the report has to stand alone, and pinning its appearance to a build artefact
 * would mean an upgrade could change how an already-filed report renders.
 */
const REPORT_CSS = `
:root { color-scheme: light; }
.brand { display: flex; align-items: center; gap: .55rem; margin-bottom: 1.25rem; }
.brand span { font-size: 1rem; font-weight: 600; letter-spacing: -.01em; }
/* A span, not a <b>: the report's escaping test asserts that no bold element
   survives into the output, which is how it proves document content was
   escaped rather than injected. Decoration must not blunt that check. */
.brand .rev { font-weight: 800; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2rem 1.5rem; background: #fff; color: #1F2937;
  font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
}
main { max-width: 70rem; margin: 0 auto; }
h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
h2 { font-size: 1.1rem; margin: 2.5rem 0 .75rem; padding-bottom: .4rem; border-bottom: 2px solid #1F2937; }
.meta { border: 1px solid #d1d5db; border-radius: 6px; padding: 1rem 1.25rem; background: #F9FAFB; }
.meta dl { display: grid; grid-template-columns: max-content 1fr; gap: .3rem 1.25rem; margin: .75rem 0 0; }
.meta dt { color: #57606f; }
.meta dd { margin: 0; }
.headline { font-weight: 600; margin: 0; }
del { background: #fee2e2; color: #B91C1C; text-decoration: line-through; border-radius: 2px; padding: 0 1px; }
ins { background: #A7F3C0; color: #166534; text-decoration: none; border-radius: 2px; padding: 0 1px; }
p { margin: 0; font-family: ui-serif, Georgia, "Times New Roman", serif; }
.h { font-weight: 700; }
.h1 { font-size: 1.25rem; } .h2 { font-size: 1.1rem; } .h3 { font-size: 1rem; }
.code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: .8125rem; white-space: pre-wrap; }
.li::before { content: "\\2022"; margin-right: .5rem; color: #57606f; }
.notes { margin: .35rem 0 0; padding-left: 1.1rem; color: #57606f; font-size: .78rem; }
.muted { color: #57606f; font-size: .8rem; }
.row { margin-bottom: .7rem; }
.row[data-status="unchanged"] { color: #1F2937; }
table.grid { width: 100%; border-collapse: collapse; margin: .3rem 0; }
table.grid td { border: 1px solid #d1d5db; padding: .3rem .5rem; vertical-align: top; }
table.grid td[data-status="added"] { background: #f0fdf4; }
table.grid td[data-status="removed"] { background: #fef2f2; }
table.sbs { width: 100%; border-collapse: collapse; table-layout: fixed; }
table.sbs th { text-align: left; font-size: .8rem; padding: .5rem .75rem; border-bottom: 2px solid #1F2937; }
table.sbs td { vertical-align: top; padding: .5rem .75rem; border-bottom: 1px solid #e5e7eb; border-left: 1px solid #e5e7eb; }
table.sbs td:first-child { border-left: 0; }
td.absent { background: #F9FAFB; }
tr[data-status="added"] td:last-child { background: rgba(220,252,231,.5); }
tr[data-status="removed"] td:first-child { background: rgba(254,226,226,.5); }
.num { float: left; width: 2rem; margin-left: -.25rem; color: #57606f; font: .7rem/1.7 ui-monospace, Menlo, monospace; }
.legend { margin: .75rem 0 0; font-size: .8rem; color: #57606f; }
footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; font-size: .75rem; color: #57606f; }
/*
 * Print / PDF. Spec §5.7 item 2.
 *
 * The PDF is produced by the browser's own print engine rather than by a
 * bundled PDF library: pagination, hyphenation, font embedding and Unicode are
 * exactly the problems a print engine has already solved, and re-solving them
 * would add a large dependency to an app whose whole premise is that it is a
 * folder of static files.
 *
 * Page numbers come from the browser's own header/footer setting. CSS margin
 * boxes (@bottom-center and friends) are still unimplemented in Chrome, so
 * claiming them here would produce a PDF with no numbers at all.
 */
@page { size: A4; margin: 16mm 12mm; }
@media print {
  body { padding: 0; font-size: 10pt; }
  main { max-width: none; }

  /* The metadata block is the cover: it gets the first page to itself. */
  .meta { break-after: page; }
  h2 { break-before: page; }

  /* A change split across a page break is a change a reviewer can misread. */
  tr, .row, table.grid td { break-inside: avoid; }
  h1, h2 { break-after: avoid; }

  /* Repeat the Original/Revised headings on every page of a long comparison,
     or the later pages give no clue which column is which. */
  thead { display: table-header-group; }

  /* Backgrounds carry meaning here, so they must survive the print pipeline's
     default of dropping them to save ink. */
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .no-print { display: none !important; }
}
`

export function buildReportHtml(diff: DocumentDiff): string {
  const generated = new Date(diff.generatedAt)
  const meta = (label: string, value: string) =>
    `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comparison — ${escapeHtml(diff.original.fileName)} vs ${escapeHtml(diff.revised.fileName)}</title>
<meta name="generator" content="${APP_NAME} ${APP_VERSION}">
<style>${REPORT_CSS}</style>
</head>
<body>
<main>
<div class="brand">${BRAND_MARK_SVG}<span>Doc<span class="rev">R3V</span></span></div>
<h1>Document comparison</h1>
<div class="meta">
  <p class="headline">${escapeHtml(describeSummary(diff.summary))}</p>
  <dl>
    ${meta('Original', `${diff.original.fileName} · ${plural(diff.original.wordCount, 'word')}`)}
    ${meta('Revised', `${diff.revised.fileName} · ${plural(diff.revised.wordCount, 'word')}`)}
    ${meta('Compared', generated.toLocaleString())}
    ${meta('Paragraphs', `${diff.summary.paragraphsModified} edited, ${diff.summary.paragraphsAdded} added, ${diff.summary.paragraphsRemoved} removed, ${diff.summary.paragraphsUnchanged} unchanged`)}
    ${meta('Generated by', `${APP_NAME} ${APP_VERSION}`)}
  </dl>
  <p class="legend"><del>Struck-through red</del> text was removed. <ins>Shaded green</ins> text was added. Formatting-only changes are listed in grey beneath the paragraph they affect.</p>
</div>

<h2>Side by side</h2>
${renderSideBySide(diff)}

<h2>Merged (redlined)</h2>
${renderMerged(diff)}

<footer>
Generated by ${APP_NAME} ${APP_VERSION} on ${escapeHtml(generated.toISOString())}.
This report was produced locally; neither document left the machine that created it.
</footer>
</main>
</body>
</html>
`
}

/** Merged view as a clipboard-ready fragment for pasting into Word or LibreOffice. */
export function buildRedlineFragment(diff: DocumentDiff): string {
  const body = diff.paragraphs
    .map((paragraph) => {
      const source = paragraph.newParagraph ?? paragraph.oldParagraph
      const tag = source?.kind === 'heading' ? `h${Math.min(source.level ?? 1, 6)}` : 'p'
      const content = renderSegments(paragraph.segments, 'merged', paragraph)
      return `<${tag}>${content}</${tag}>`
    })
    .join('')

  // Word and LibreOffice honour inline styles on pasted HTML but ignore a
  // <style> block, so the colours have to travel on the elements themselves.
  return `<div style="font-family:Georgia,serif">${body}</div>`
    .replace(/<del>/g, '<del style="color:#B91C1C;text-decoration:line-through">')
    .replace(/<ins>/g, '<ins style="color:#166534;background-color:#A7F3C0;text-decoration:none">')
}

function sanitizeForFileName(value: string): string {
  return value.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').slice(0, 40)
}

/**
 * Opens the browser's print dialog on the report, for "Save as PDF".
 *
 * Rendered into a hidden iframe rather than a popup window: a popup is at the
 * mercy of the blocker and would fail silently for some users, and printing the
 * app's own screen instead would carry the toolbar, the scroll container and
 * the view-mode choice into the page. The iframe prints the same self-contained
 * report the HTML export produces, so what is filed as a PDF and what is filed
 * as HTML are the same document.
 *
 * Resolves once the dialog has been dismissed; the caller decides what to do
 * with the frame afterwards.
 */
export function printReport(diff: DocumentDiff): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    // Off-screen rather than display:none — a frame that is not displayed has
    // no layout, and printing it yields a blank page.
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0'

    const cleanUp = () => {
      // Deferred: removing the frame while the dialog is still settling can
      // cancel the print job in some browsers.
      setTimeout(() => frame.remove(), 1000)
    }

    frame.addEventListener('load', () => {
      try {
        const view = frame.contentWindow
        if (!view) throw new Error('The print frame did not open.')
        view.focus()
        view.print()
        resolve()
      } catch (problem) {
        reject(problem instanceof Error ? problem : new Error(String(problem)))
      } finally {
        cleanUp()
      }
    })

    frame.srcdoc = buildReportHtml(diff)
    document.body.appendChild(frame)
  })
}

export function reportFileName(diff: DocumentDiff): string {
  const stamp = diff.generatedAt.slice(0, 10)
  return `comparison_${sanitizeForFileName(diff.original.fileName)}_vs_${sanitizeForFileName(diff.revised.fileName)}_${stamp}.html`
}

export function downloadReport(diff: DocumentDiff): void {
  const blob = new Blob([buildReportHtml(diff)], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = reportFileName(diff)
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
