# Changelog

All notable changes to DocR3V are recorded here. The version is stamped into every exported report, and it
changes whenever a release changes what the comparison reports about the same pair of documents.

## 1.0.0 — 2026-10-26

First public release.

### Comparison

- Word-level comparison of two revisions of a document, keeping the surrounding text visible.
- Input formats: Word (`.docx`), OpenDocument Text (`.odt`), Markdown (`.md`) and plain text (`.txt`), up to
  5 MB each.
- Formatting changes on otherwise unedited text: bold, italic, underline, strikethrough, superscript,
  subscript, all capitals, small capitals and paragraph style. The app lists what is and is not checked.
- Tables compared cell by cell by grid position, including merged cells and added or removed rows.
- A heavily rewritten paragraph is reported as one edit rather than as a deletion plus an insertion.

### Views and exports

- Side-by-side and merged (redline) views, with a change summary.
- Added text is marked by shading alone, so it stays readable in print.
- Exports: self-contained HTML report, ODT with native tracked changes (accept or reject each one in
  LibreOffice Writer), print / PDF, and a styled redline copied to the clipboard.

### Distribution

- A web version that can be installed from the browser and works offline after the first visit.
- A single offline `.html` file per release, published with its SHA-256 checksum.
- The web version switches to a newly published version as soon as it opens, unless a comparison has
  already been started.
- Everything runs in the browser: documents are never uploaded, and the Content Security Policy blocks any
  network request.
