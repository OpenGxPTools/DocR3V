/**
 * Stamped into every exported report so a printed comparison is traceable.
 *
 * Bump this whenever a release changes what the comparison *says* about the
 * same pair of documents, not only when features are added. Two reports
 * carrying the same version are expected to agree; if the classification of a
 * change can differ between builds and the version does not move, a filed
 * report cannot be reproduced from the version it names.
 *
 * 0.2.0 — table support, tracked-changes ODT and PDF export, and a pairing
 * floor that reports a heavily rewritten paragraph as one edit rather than as
 * a deletion plus an insertion.
 *
 * 1.0.0 — first public release. Added text is marked by shading alone (no
 * longer also bold and underlined), and the web version switches to a newly
 * published build as soon as it opens.
 */
export const APP_NAME = 'DocR3V'
export const APP_VERSION = '1.0.0'
