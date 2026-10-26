/**
 * Content for the sample SOPs used in manual testing.
 *
 * Written as one document with the revisions marked, rather than as two
 * independent documents, so that it is obvious from reading this file exactly
 * which changes the app is supposed to find. `revised` is the v2 wording;
 * omitting it means the block is identical in both versions.
 */

import type { FixtureParagraph } from './builders.ts'

export interface Block {
  heading?: number
  list?: boolean
  /** Emphasised phrase within `text`, if any. */
  boldPhrase?: string
  boldPhraseInRevision?: string
  italicPhrase?: string
  text: string
  /** v2 wording. `null` means the block was deleted in v2. */
  revised?: string | null
  /** v2 only: the block did not exist in v1. */
  addedInRevision?: boolean
}

export const SOP_TITLE = 'SOP-QA-017 Deviation Management'

/** Three sections, roughly 500 words. Used for the simple fixture pair. */
export const SIMPLE_SOP: Block[] = [
  { heading: 1, text: SOP_TITLE },
  {
    text: 'Effective date: 01 March 2026. Supersedes revision 3.',
    revised: 'Effective date: 01 September 2026. Supersedes revision 4.',
  },

  { heading: 2, text: '1. Purpose' },
  {
    text: 'This procedure defines the process for recording, investigating and closing deviations from approved manufacturing and quality control procedures at the site. It applies to planned and unplanned deviations affecting product quality, process consistency or data integrity.',
    revised:
      'This procedure defines the process for recording, investigating and closing deviations from approved manufacturing and quality control procedures at the site. It applies to planned and unplanned deviations affecting product quality, process consistency, data integrity or the validated state of equipment.',
  },
  {
    text: 'Deviations relating to clinical trial material are covered by SOP-CT-004 and are outside the scope of this procedure.',
  },

  { heading: 2, text: '2. Responsibilities' },
  {
    boldPhrase: 'Quality Assurance Manager',
    text: 'The Quality Assurance Manager shall review all deviations within five working days of notification and determine the classification. The classification decision shall be documented in the deviation record together with its justification.',
    revised:
      'The Quality Assurance Director shall assess all deviations within three working days of notification and determine the classification. The classification decision shall be documented in the deviation record together with its justification.',
    boldPhraseInRevision: 'Quality Assurance Director',
  },
  {
    list: true,
    text: 'Area Supervisor: raise the deviation record and secure any affected material.',
  },
  {
    list: true,
    text: 'Investigation Owner: complete the root cause investigation and propose corrective actions.',
  },
  {
    list: true,
    text: 'Qualified Person: confirm that no affected batch is certified until the deviation is closed.',
    addedInRevision: true,
  },

  { heading: 2, text: '3. Procedure' },
  {
    text: 'Any employee who identifies a deviation shall notify their supervisor immediately and, in any case, before the end of the shift on which the deviation was identified.',
    revised:
      'Any employee who identifies a deviation shall notify their supervisor immediately and, in any case, within four hours of identification.',
  },
  {
    text: 'The Area Supervisor shall raise a deviation record in the quality management system within one working day. The record shall describe what happened, when it was identified, which batches or systems are affected, and what immediate action was taken to contain the issue.',
  },
  {
    italicPhrase: 'critical',
    text: 'Deviations classified as critical shall be escalated to the Site Head and to the Qualified Person on the day of classification. A critical deviation shall not be closed without a documented product impact assessment.',
  },
  {
    text: 'Corrective and preventive actions shall be assigned an owner and a target date. Extension of a target date requires the written approval of the Quality Assurance Manager and a justification recorded against the action.',
    revised:
      'Corrective and preventive actions shall be assigned an owner and a target date. Extension of a target date requires the written approval of the Quality Assurance Director and a justification recorded against the action. No action may be extended more than twice.',
  },
  {
    text: 'Deviation records shall be retained for the shelf life of the affected product plus one year.',
    revised: null,
  },
]

/** Eight sections, roughly 2000 words. Used for the medium fixture pair. */
export const MEDIUM_SOP: Block[] = [
  ...SIMPLE_SOP.slice(0, SIMPLE_SOP.length - 1),

  { heading: 2, text: '4. Classification' },
  {
    text: 'Deviations shall be classified as critical, major or minor. Classification determines the depth of investigation required, the approval level for closure and the reporting obligations to management. The classification shall be reviewed once the investigation is complete and revised if the findings warrant it.',
  },
  {
    text: 'A critical deviation is one that has caused, or could reasonably have caused, a product to fail to meet its registered specification, or that represents a significant breach of Good Manufacturing Practice. Critical deviations require a full root cause investigation using a structured methodology.',
    revised:
      'A critical deviation is one that has caused, or could reasonably have caused, a product to fail to meet its registered specification, that represents a significant breach of Good Manufacturing Practice, or that affects the integrity of GMP-relevant data. Critical deviations require a full root cause investigation using a structured methodology.',
  },
  {
    text: 'A major deviation is one that could affect product quality but where the available evidence indicates no impact on the registered specification. A minor deviation is one with no foreseeable product quality impact, typically a documentation or procedural error identified and corrected at the point of occurrence.',
  },
  {
    text: 'Repeated minor deviations of the same type shall be reviewed for escalation to major at the quarterly quality review.',
    revised:
      'Three or more minor deviations of the same type within a rolling twelve-month period shall be escalated to major and investigated as a trend.',
  },

  { heading: 2, text: '5. Investigation' },
  {
    text: 'The investigation shall establish the sequence of events, the immediate cause and the root cause. Evidence shall be gathered from batch records, equipment logs, electronic data, training records and interviews with the personnel involved. All evidence reviewed shall be referenced in the investigation report.',
  },
  {
    text: 'Investigations for critical deviations shall be completed within thirty calendar days of the deviation being raised. Where this is not achievable, an interim report shall be issued and an extension approved by the Quality Assurance Manager, with the reason for the delay documented.',
    revised:
      'Investigations for critical deviations shall be completed within twenty calendar days of the deviation being raised. Where this is not achievable, an interim report shall be issued and an extension approved by the Quality Assurance Director, with the reason for the delay documented.',
  },
  {
    text: 'Human error shall not be recorded as a root cause unless the investigation has established why the error was possible and why existing controls did not prevent it. Where human error is confirmed, the investigation shall assess the adequacy of the procedure, the training and the working environment.',
  },
  {
    text: 'The investigation report shall state whether other batches, products or systems are potentially affected, and shall document the basis for that conclusion.',
  },

  { heading: 2, text: '6. Product Impact Assessment' },
  {
    text: 'A product impact assessment shall be performed for every critical and major deviation. The assessment shall consider the affected batch, batches manufactured on the same equipment since the last verified clean, and any batch that shares the affected raw material lot.',
  },
  {
    text: 'The assessment shall be performed by a subject matter expert independent of the area in which the deviation occurred and shall be approved by the Quality Assurance Manager.',
    revised:
      'The assessment shall be performed by a subject matter expert independent of the area in which the deviation occurred and shall be approved by the Quality Assurance Director. Where the deviation affects sterility assurance, the assessment shall additionally be reviewed by the Microbiology Lead.',
  },
  {
    text: 'Where the assessment concludes that product quality may be affected, the affected material shall be placed on hold and shall not be released until the deviation is closed and a disposition decision has been recorded.',
  },

  { heading: 2, text: '7. Corrective and Preventive Action' },
  {
    text: 'Corrective actions address the specific occurrence. Preventive actions address the potential for recurrence across the site. Every critical deviation shall result in at least one preventive action, or a documented justification for why none is required.',
  },
  {
    text: 'The effectiveness of preventive actions shall be verified no earlier than three months after implementation. Effectiveness verification shall use objective evidence, such as deviation rates, in-process data or audit findings, and shall not rely solely on confirmation that the action was completed.',
  },
  {
    text: 'Where effectiveness cannot be demonstrated, the deviation shall be reopened and a further investigation performed.',
    addedInRevision: true,
  },

  { heading: 2, text: '8. Closure and Records' },
  {
    text: 'A deviation may be closed when the investigation is complete, the product impact assessment is approved, all corrective actions are implemented, and preventive actions are approved with target dates assigned. Closure requires the signature of the Quality Assurance Manager.',
    revised:
      'A deviation may be closed when the investigation is complete, the product impact assessment is approved, all corrective actions are implemented, and preventive actions are approved with target dates assigned. Closure requires the signature of the Quality Assurance Director.',
  },
  {
    text: 'Deviation records, investigation reports, impact assessments and effectiveness verifications shall be retained for the shelf life of the affected product plus one year, and in no case for less than six years.',
  },
  {
    text: 'A summary of open and closed deviations shall be presented at the monthly quality review meeting, including any action overdue by more than thirty days.',
    revised:
      'A summary of open and closed deviations shall be presented at the monthly quality review meeting, including any action overdue by more than fourteen days.',
  },
]

/** Non-English and typographic content, for the character-handling fixture. */
export const UNICODE_SOP: Block[] = [
  { heading: 1, text: 'PON-QA-017 — Gestion des déviations' },
  {
    text: 'Température de stockage des échantillons de rétention : 2–8 °C, contrôlée en continu.',
    revised:
      'Température de stockage des échantillons de rétention : 15–25 °C, contrôlée en continu.',
  },
  {
    text: 'Le responsable Assurance Qualité examine chaque déviation dans un délai de cinq jours ouvrés.',
    revised:
      'Le directeur Assurance Qualité examine chaque déviation dans un délai de trois jours ouvrés.',
  },
  { text: 'Anexo Ⅲ — Registro de desviaciones (§ 4.2, ¶ 7).' },
  { text: '保存期間：製品の有効期限に一年を加えた期間とする。' },
  {
    text: 'Grenzwert: ≤ 0,5 µg/mL; Abweichung > 10 % ist meldepflichtig.',
    revised: 'Grenzwert: ≤ 0,2 µg/mL; Abweichung > 5 % ist meldepflichtig.',
  },
]

// ------------------------------------------------------------------ rendering
//
// Turning the block list above into each supported format. Shared by the
// fixture script and the end-to-end tests, so the files a reviewer opens by
// hand and the documents the tests assert against are the same documents.

export type Version = 'v1' | 'v2'

/** Resolves a block to the text it has in the given version, or null if absent. */
export function textFor(block: Block, version: Version): string | null {
  if (version === 'v1') return block.addedInRevision ? null : block.text
  if (block.revised === null) return null
  return block.revised ?? block.text
}

export function emphasisFor(block: Block, version: Version): string | undefined {
  return version === 'v2' ? (block.boldPhraseInRevision ?? block.boldPhrase) : block.boldPhrase
}

/** Splits text around an emphasised phrase into runs. */
export function toRuns(text: string, bold?: string, italic?: string): FixtureParagraph['runs'] {
  const phrase = bold ?? italic
  if (!phrase) return [{ text }]

  const at = text.indexOf(phrase)
  if (at === -1) return [{ text }]

  const runs: FixtureParagraph['runs'] = []
  if (at > 0) runs.push({ text: text.slice(0, at) })
  runs.push({ text: phrase, bold: bold !== undefined, italic: italic !== undefined })
  const tail = text.slice(at + phrase.length)
  if (tail) runs.push({ text: tail })
  return runs
}

export function toFixtureParagraphs(blocks: Block[], version: Version): FixtureParagraph[] {
  const out: FixtureParagraph[] = []
  for (const block of blocks) {
    const text = textFor(block, version)
    if (text === null) continue
    out.push({
      heading: block.heading,
      list: block.list,
      runs: toRuns(text, emphasisFor(block, version), block.italicPhrase),
    })
  }
  return out
}

export function toMarkdown(blocks: Block[], version: Version): string {
  const lines: string[] = []
  for (const block of blocks) {
    const raw = textFor(block, version)
    if (raw === null) continue

    const bold = emphasisFor(block, version)
    let text = raw
    if (bold && text.includes(bold)) text = text.replace(bold, `**${bold}**`)
    if (block.italicPhrase && text.includes(block.italicPhrase)) {
      text = text.replace(block.italicPhrase, `*${block.italicPhrase}*`)
    }

    if (block.heading) lines.push(`${'#'.repeat(block.heading)} ${text}`, '')
    else if (block.list) lines.push(`- ${text}`)
    else lines.push(text, '')
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

export function toPlainText(blocks: Block[], version: Version): string {
  const lines: string[] = []
  for (const block of blocks) {
    const text = textFor(block, version)
    if (text === null) continue
    lines.push(block.list ? `- ${text}` : text, '')
  }
  return `${lines.join('\n').trim()}\n`
}

/** A responsibilities table, to exercise the Phase 1 "tables as text" path. */
export const RESPONSIBILITY_TABLE: Record<Version, FixtureParagraph> = {
  v1: {
    table: [
      ['Role', 'Responsibility', 'Timescale'],
      ['Area Supervisor', 'Raise the deviation record', '1 working day'],
      ['Quality Assurance Manager', 'Classify the deviation', '5 working days'],
      ['Investigation Owner', 'Complete root cause investigation', '30 calendar days'],
    ],
  },
  v2: {
    table: [
      ['Role', 'Responsibility', 'Timescale'],
      ['Area Supervisor', 'Raise the deviation record', '4 hours'],
      ['Quality Assurance Director', 'Classify the deviation', '3 working days'],
      ['Investigation Owner', 'Complete root cause investigation', '20 calendar days'],
      ['Qualified Person', 'Confirm batch certification is held', 'Before certification'],
    ],
  },
}
