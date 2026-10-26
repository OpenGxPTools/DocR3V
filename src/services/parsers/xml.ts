/**
 * Small helpers shared by the ODT and DOCX parsers.
 *
 * Both formats are ZIP archives containing namespaced XML. We match on
 * `localName` rather than namespace URIs: the prefixes differ between producers
 * (LibreOffice, Word, Google Docs) but the local names are stable, and no
 * supported format has colliding local names in the elements we care about.
 */

import { DocumentParseError, FORMATTING_KEYS, type RunFormatting } from '../../types/document.ts'

export function parseXml(source: string, description: string): Document {
  const doc = new DOMParser().parseFromString(source, 'application/xml')
  // DOMParser reports malformed XML as a <parsererror> element rather than throwing.
  if (doc.getElementsByTagName('parsererror').length > 0 || !doc.documentElement) {
    throw new DocumentParseError(`The ${description} inside this file is not valid XML.`)
  }
  return doc
}

/** Direct element children of `node`, in document order. */
export function childElements(node: Element): Element[] {
  const out: Element[] = []
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]
    if (child.nodeType === 1) out.push(child as Element)
  }
  return out
}

/** First descendant with the given local name, or undefined. */
export function findByLocalName(root: Element | Document, localName: string): Element | undefined {
  const all = root.getElementsByTagName('*')
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === localName) return all[i]
  }
  return undefined
}

/** All descendants with the given local name, in document order. */
export function collectByLocalName(root: Element | Document, localName: string): Element[] {
  const all = root.getElementsByTagName('*')
  const out: Element[] = []
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === localName) out.push(all[i])
  }
  return out
}

/**
 * Reads an attribute by local name, ignoring its prefix.
 *
 * `getAttribute('w:val')` only works when the producer used the `w` prefix, and
 * `getAttributeNS` needs the exact namespace URI. Scanning is cheap here because
 * the elements carrying attributes we read have a handful of them at most.
 */
export function attr(element: Element, localName: string): string | undefined {
  const direct = element.getAttribute(localName)
  if (direct !== null) return direct
  for (let i = 0; i < element.attributes.length; i++) {
    const a = element.attributes[i]
    if (a.localName === localName) return a.value
  }
  return undefined
}

/**
 * Layers an override over a base, attribute by attribute. Driven by
 * FORMATTING_KEYS so a newly tracked attribute inherits through style chains
 * automatically instead of being silently dropped here.
 */
export function mergeFormat(base: RunFormatting, override: Partial<RunFormatting>): RunFormatting {
  const merged = {} as RunFormatting
  for (const key of FORMATTING_KEYS) merged[key] = override[key] ?? base[key]
  return merged
}

export { formatsEqual } from '../../types/document.ts'
