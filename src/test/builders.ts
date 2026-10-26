/**
 * Builds real ODT and DOCX files in memory from a small description.
 *
 * Tests need documents whose expected parse is known exactly, and checking
 * binary fixtures into the repo would make it impossible to see, in a diff, what
 * a test document actually contains. The files these produce are structurally
 * complete — mimetype entry, manifest, content types, relationships — so the
 * same builders also generate the sample SOPs used for manual testing, and
 * those open in LibreOffice and Word.
 */

import JSZip from 'jszip'

export interface FixtureRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

export interface FixtureParagraph {
  /** Shorthand for a single unformatted run. */
  text?: string
  runs?: FixtureRun[]
  /** Heading level 1–6. Mutually exclusive with `list`. */
  heading?: number
  list?: boolean
  /**
   * Rows of cells; each cell is one paragraph of plain text. A cell may instead
   * declare a merge, so the parsers can be tested against the shapes real SOP
   * tables use — a heading spanning two columns, a role spanning three rows.
   * Positions covered by a merge are simply omitted from the row.
   */
  table?: FixtureCell[][]
}

export type FixtureCell = string | { text: string; colSpan?: number; rowSpan?: number }

const cellText = (cell: FixtureCell): string => (typeof cell === 'string' ? cell : cell.text)
const colSpanOf = (cell: FixtureCell): number =>
  typeof cell === 'string' ? 1 : (cell.colSpan ?? 1)
const rowSpanOf = (cell: FixtureCell): number =>
  typeof cell === 'string' ? 1 : (cell.rowSpan ?? 1)

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function runsOf(paragraph: FixtureParagraph): FixtureRun[] {
  return paragraph.runs ?? (paragraph.text !== undefined ? [{ text: paragraph.text }] : [])
}

// ---------------------------------------------------------------- ODT

const ODT_NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
].join(' ')

/** Each distinct formatting combination becomes one automatic text style. */
function odtSpanStyles(paragraphs: FixtureParagraph[]): Map<string, string> {
  const styles = new Map<string, string>()
  for (const paragraph of paragraphs) {
    for (const run of runsOf(paragraph)) {
      const key = `${run.bold ? 'b' : ''}${run.italic ? 'i' : ''}${run.underline ? 'u' : ''}`
      if (key === '' || styles.has(key)) continue
      styles.set(key, `T${styles.size + 1}`)
    }
  }
  return styles
}

function odtRuns(paragraph: FixtureParagraph, styles: Map<string, string>): string {
  return runsOf(paragraph)
    .map((run) => {
      const key = `${run.bold ? 'b' : ''}${run.italic ? 'i' : ''}${run.underline ? 'u' : ''}`
      const text = escapeXml(run.text)
      const styleName = styles.get(key)
      return styleName ? `<text:span text:style-name="${styleName}">${text}</text:span>` : text
    })
    .join('')
}

export async function buildOdt(paragraphs: FixtureParagraph[]): Promise<ArrayBuffer> {
  const spanStyles = odtSpanStyles(paragraphs)

  const automaticStyles = [...spanStyles.entries()]
    .map(([key, name]) => {
      const properties = [
        key.includes('b') ? 'fo:font-weight="bold"' : 'fo:font-weight="normal"',
        key.includes('i') ? 'fo:font-style="italic"' : 'fo:font-style="normal"',
        `style:text-underline-style="${key.includes('u') ? 'solid' : 'none'}"`,
      ].join(' ')
      return `<style:style style:name="${name}" style:family="text"><style:text-properties ${properties}/></style:style>`
    })
    .join('')

  const body = paragraphs
    .map((paragraph) => {
      if (paragraph.table) {
        const rows = paragraph.table
          .map(
            (row) =>
              `<table:table-row>${row
                .map((cell) => {
                  const spans =
                    (colSpanOf(cell) > 1 ? ` table:number-columns-spanned="${colSpanOf(cell)}"` : '') +
                    (rowSpanOf(cell) > 1 ? ` table:number-rows-spanned="${rowSpanOf(cell)}"` : '')
                  // ODF writes an explicit placeholder for each covered column.
                  const covered = '<table:covered-table-cell/>'.repeat(colSpanOf(cell) - 1)
                  return (
                    `<table:table-cell${spans}><text:p text:style-name="Table_20_Contents">` +
                    `${escapeXml(cellText(cell))}</text:p></table:table-cell>${covered}`
                  )
                })
                .join('')}</table:table-row>`,
          )
          .join('')
        // LibreOffice needs the column declaration to read the table as a grid;
        // without it a multi-column table opens as a single column and every
        // cell past the first is lost. Our own parser walks the rows directly
        // and never noticed, which made these fixtures quietly unrealistic.
        const columns = Math.max(
          ...paragraph.table.map((row) => row.reduce((n, c) => n + colSpanOf(c), 0)),
        )
        return (
          `<table:table table:name="T">` +
          `<table:table-column table:number-columns-repeated="${columns}"/>` +
          `${rows}</table:table>`
        )
      }
      const content = odtRuns(paragraph, spanStyles)
      if (paragraph.heading) {
        return `<text:h text:style-name="Heading_20_${paragraph.heading}" text:outline-level="${paragraph.heading}">${content}</text:h>`
      }
      if (paragraph.list) {
        return `<text:list><text:list-item><text:p text:style-name="List_20_Paragraph">${content}</text:p></text:list-item></text:list>`
      }
      return `<text:p text:style-name="Standard">${content}</text:p>`
    })
    .join('\n   ')

  const headingStyles = [1, 2, 3, 4, 5, 6]
    .map(
      (level) =>
        `<style:style style:name="Heading_20_${level}" style:display-name="Heading ${level}" style:family="paragraph" style:parent-style-name="Standard"/>`,
    )
    .join('')

  const zip = new JSZip()
  // The mimetype entry must be first and stored uncompressed for the file to be
  // recognised without unzipping it.
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' })
  zip.file(
    'META-INF/manifest.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
 <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
 <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
 <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`,
  )
  zip.file(
    'styles.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${ODT_NS} office:version="1.3">
 <office:styles>
  <style:style style:name="Standard" style:display-name="Default Paragraph Style" style:family="paragraph"/>
  <style:style style:name="List_20_Paragraph" style:display-name="List Paragraph" style:family="paragraph" style:parent-style-name="Standard"/>
  <style:style style:name="Table_20_Contents" style:display-name="Table Contents" style:family="paragraph" style:parent-style-name="Standard"/>
  ${headingStyles}
 </office:styles>
</office:document-styles>`,
  )
  zip.file(
    'content.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${ODT_NS} office:version="1.3">
 <office:automatic-styles>${automaticStyles}</office:automatic-styles>
 <office:body>
  <office:text>
   ${body}
  </office:text>
 </office:body>
</office:document-content>`,
  )

  return zip.generateAsync({ type: 'arraybuffer', mimeType: 'application/vnd.oasis.opendocument.text' })
}

// --------------------------------------------------------------- DOCX

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

function docxRuns(paragraph: FixtureParagraph): string {
  return runsOf(paragraph)
    .map((run) => {
      const properties = [
        run.bold ? '<w:b/>' : '',
        run.italic ? '<w:i/>' : '',
        run.underline ? '<w:u w:val="single"/>' : '',
      ].join('')
      const rPr = properties ? `<w:rPr>${properties}</w:rPr>` : ''
      return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`
    })
    .join('')
}

export async function buildDocx(paragraphs: FixtureParagraph[]): Promise<ArrayBuffer> {
  const body = paragraphs
    .map((paragraph) => {
      if (paragraph.table) {
        /*
         * Word does not omit the rows a vertical merge covers: it writes a real
         * w:tc carrying a bare <w:vMerge/> in each of them. Emitting those here
         * is what makes the fixture exercise the same path a Word document
         * does — without them the parser would never see a continuation cell.
         * Tracks, per column, how many further rows an open merge still covers.
         */
        const openMerges = new Map<number, { rows: number; span: number }>()
        const rows = paragraph.table
          .map((row) => {
            const cells: string[] = []
            let column = 0

            const emitContinuations = () => {
              let open = openMerges.get(column)
              while (open && open.rows > 0) {
                const span = open.span > 1 ? `<w:gridSpan w:val="${open.span}"/>` : ''
                cells.push(`<w:tc><w:tcPr>${span}<w:vMerge/></w:tcPr><w:p/></w:tc>`)
                open.rows -= 1
                if (open.rows === 0) openMerges.delete(column)
                column += open.span
                open = openMerges.get(column)
              }
            }

            for (const cell of row) {
              emitContinuations()
              const colSpan = colSpanOf(cell)
              const rowSpan = rowSpanOf(cell)
              const properties =
                colSpan > 1 || rowSpan > 1
                  ? `<w:tcPr>${colSpan > 1 ? `<w:gridSpan w:val="${colSpan}"/>` : ''}` +
                    `${rowSpan > 1 ? '<w:vMerge w:val="restart"/>' : ''}</w:tcPr>`
                  : ''
              cells.push(
                `<w:tc>${properties}<w:p><w:r><w:t xml:space="preserve">` +
                  `${escapeXml(cellText(cell))}</w:t></w:r></w:p></w:tc>`,
              )
              if (rowSpan > 1) openMerges.set(column, { rows: rowSpan - 1, span: colSpan })
              column += colSpan
            }
            emitContinuations()
            return `<w:tr>${cells.join('')}</w:tr>`
          })
          .join('')
        return `<w:tbl>${rows}</w:tbl>`
      }
      const properties = paragraph.heading
        ? `<w:pPr><w:pStyle w:val="Heading${paragraph.heading}"/></w:pPr>`
        : paragraph.list
          ? '<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'
          : ''
      return `<w:p>${properties}${docxRuns(paragraph)}</w:p>`
    })
    .join('\n   ')

  const headingStyles = [1, 2, 3, 4, 5, 6]
    .map(
      (level) =>
        `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style>`,
    )
    .join('')

  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
 <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  )
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS}>
 <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
 <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style>
 ${headingStyles}
</w:styles>`,
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}>
 <w:body>
   ${body}
   <w:sectPr/>
 </w:body>
</w:document>`,
  )

  return zip.generateAsync({ type: 'arraybuffer' })
}
