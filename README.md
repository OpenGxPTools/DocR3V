# DocR3V

Word-level comparison of two revisions of the same document — procedures,
contracts, specifications, reports.

Standard diff tools and LibreOffice's compare feature show an entire paragraph
as deleted and re-inserted when a handful of words change. In any document
where the wording is the point, that hides the changes that matter — "Quality
Manager" becoming "Quality Director", "must" becoming "should", a limit moving
by two degrees. None of those should take a paragraph-by-paragraph read to
find.

DocR3V compares two documents and highlights the individual words that changed,
keeping the surrounding text visible for context.

> **Disclaimer.** DocR3V is provided free, "as is", without warranty of any
> kind, under the Apache License 2.0. It is a review aid and is **not
> validated** for any regulated use. Each organisation that uses it is
> responsible for deciding whether its output may support a quality or
> regulatory decision. It is not endorsed by, or affiliated with, the TGA or any
> other regulator. See [DISCLAIMER.md](DISCLAIMER.md).

## Getting it

Two ways in, both free of anything to install and of any upload:

**Use it in your browser** — open
[opengxptools.github.io/DocR3V](https://opengxptools.github.io/DocR3V/) and
start comparing. Your browser will
offer to install it, which puts it in your Start menu or dock and lets it work
without an internet connection afterwards.

**Download the offline file** — one `.html` file from the
[latest release](../../releases/latest). Save it, double-click it, done. Nothing
is installed and no connection is needed, ever. This is the version to keep
alongside a filed comparison: the file is fixed at the version it was built as,
and its published SHA-256 proves the copy you archived is the copy that was
published.

[`docs/getting-started.odt`](docs/getting-started.odt) walks a non-technical
reviewer through both routes, step by step.

## Status

Version 1.0.0, the first public release: word-level text comparison, eight
inline formatting attributes, table diffing, and HTML, tracked-changes ODT and
PDF export. See the [CHANGELOG](CHANGELOG.md) for what each release changed.

Not yet validated for regulated use. The version is stamped into every export,
and it moves whenever a release changes what the comparison reports about the
same pair of documents — so a filed report can be reproduced from the version
it names.

## Privacy

Everything runs in the browser. Documents are read from the local file system,
parsed, compared and rendered without a network request — there is no backend
and no upload. The built app is a folder of static files; opening it from a
local web server is enough.

That is enforced rather than promised. Both builds ship a Content Security
Policy that gives the page no origin it is allowed to contact: `connect-src` is
`'none'` in the offline file, and `'self'` in the hosted app only so the service
worker can cache the app's own files. A network call would not be an
unnoticed bug — the browser would refuse it and log the refusal.

## Supported formats

| Format | Extension | Notes |
| --- | --- | --- |
| Word | `.docx` | Text, headings, lists, bold/italic/underline |
| OpenDocument Text | `.odt` | Text, headings, lists, bold/italic/underline |
| Markdown | `.md` | Headings, lists, code blocks, emphasis |
| Plain text | `.txt` | Text only |

PDF is not supported as an input: its text extraction is too lossy for a
clause-level comparison. Save as DOCX or ODT first.

Maximum file size is 5 MB per document.

## What counts as a change

Word-level text changes are the primary output. Alongside them the comparison
reports formatting changes on text that is otherwise unedited — a phrase that
gained bold is not a text change, but it is reportable.

These attributes are checked:

| Detected | Not detected |
| --- | --- |
| bold, italic, underline | font family and size |
| strikethrough | text colour, highlighting |
| superscript, subscript | alignment, indentation, spacing |
| all capitals, small capitals | table layout and cell structure |
| paragraph style name | headers, footers, footnotes |

The same list is shown in the app behind the **What is checked** button, so a
reviewer never has to consult this file to learn the boundary of the evidence.
That boundary matters: *no formatting note does not mean no formatting change*.
Anything in the right-hand column above is invisible to the comparison, and a
document that differs only in those respects will be reported as matching.

Adding an attribute means adding it to `FORMATTING_KEYS` in
`src/types/document.ts`, teaching each parser to read it, and giving it a label
and a rendering. Every comparison in the codebase derives from that one list, so
a missing parser mapping shows up as a type error rather than as an attribute
that is silently never reported.

## Requirements

Node.js 18 or later (developed against Node 22 LTS).

If Node is installed through [nvm](https://github.com/nvm-sh/nvm), activate it
first:

```bash
source ~/.nvm/nvm.sh && nvm use --lts
```

## Running it

```bash
npm install
npm run dev          # development server, http://localhost:5173 by default
```

```bash
npm run build        # hosted build into dist/
npm run preview      # serve the production build, http://localhost:4173 by default
npm run build:offline # one self-contained .html into dist-offline/, with its SHA-256
```

`npm run dev` and `npm run preview` are development conveniences. Nobody using
the app ever sees them — see [Shipping](#shipping).

Both ports are defaults, not guarantees: neither is pinned in `vite.config.ts`,
so if the port is already taken Vite prints `Port 5173 is in use, trying another
one...` and moves up to 5174, 5175 and so on. Read the URL Vite prints rather
than assuming. The usual cause is a dev server still running in another
terminal — which is also why a stale tab can keep showing old code while your
edits appear to do nothing. To pin the port and have Vite fail loudly instead of
drifting, add `server: { port: 5173, strictPort: true }` to `vite.config.ts`.

```bash
npm test             # unit tests (watch mode)
npm run test:run     # unit tests, once
npm run typecheck    # TypeScript
npm run lint         # static analysis
```

## Sample documents

```bash
npm run fixtures     # writes sample SOP pairs into fixtures/
```

This generates matching v1/v2 pairs of the same fictional SOP in each supported
format, plus a deliberately corrupt file for checking the error path. Compare
any matching pair in the app:

| Pair | What it exercises |
| --- | --- |
| `sop_v1.odt` / `sop_v2.odt` | Headings, lists, bold, italic, a table |
| `sop_v1.docx` / `sop_v2.docx` | The same content saved as Word |
| `simple-sop_v1.md` / `simple-sop_v2.md` | Markdown structure, ~500 words |
| `medium-sop_v1.txt` / `medium-sop_v2.txt` | Eight sections, ~2000 words |
| `unicode-sop_v1.txt` / `unicode-sop_v2.txt` | Accented, CJK and symbol text |
| `corrupt.docx` | The "could not be read" error path |

The files are produced by the same builders the test suite uses, so what the
tests assert and what you see on screen come from the same documents.

## Exports

| Export | What it is | What you can do with it |
| --- | --- | --- |
| **Download HTML** | Self-contained report, both views, no external files | Email, print, file in a document system |
| **Download ODT (tracked)** | OpenDocument with **native tracked changes** | Accept or reject each change in LibreOffice Writer |
| **Print / PDF** | The same report, through your browser's print dialog | Choose "Save as PDF" for a paginated, signable copy |
| **Copy redline** | Styled HTML on the clipboard | Paste a coloured redline into Writer or Word |

The PDF comes from the browser's own print engine rather than a bundled PDF
library. Pagination, font embedding and Unicode are what a print engine is for,
and re-solving them would mean a large dependency in an app whose premise is
that it is a folder of static files. The output is A4, with the summary on a
cover page and each view starting on a fresh one; changes are never split
across a page break, and the column headings repeat on every page.

Two consequences worth knowing. It opens a *dialog* rather than downloading
directly, unlike the other three buttons. And **page numbers come from your
browser's own "Headers and footers" print option** — the CSS that would draw
them (`@bottom-center` and friends) is still unimplemented in Chrome, so
switch that option on if you want them.

"Copy redline" and the tracked ODT are not the same thing. The clipboard
redline is character formatting — it reads correctly but there is nothing to
accept or reject. The ODT export writes real `<text:tracked-changes>` regions,
so Writer offers them under Edit ▸ Track Changes ▸ Manage.

The property that matters: **rejecting every change reproduces the original
exactly, and accepting every change reproduces the revision exactly.** Both
directions are verified against LibreOffice 24.2. The changes are attributed to
`DocR3V <version>` rather than to a person, because nobody typed them.

## Shipping

The same code ships in two shapes, because they answer different needs and
neither one covers both.

| | Hosted app (`dist/`) | Offline file (`dist-offline/`) |
| --- | --- | --- |
| How someone gets it | Follows a link | Downloads one `.html` |
| Install | Optional, via the browser | None |
| Works without a network | After the first visit | Always |
| Version | Updates itself | Frozen, and hashed |
| Built by | `npm run build` | `npm run build:offline` |

The hosted build is the low-friction way in: no download, no admin rights, no
IT ticket. The offline file is the one to archive, because a filed comparison
has to stay reproducible long after the hosted app has moved on.

Three workflows publish them, and none of them need a person to run a command:

| Workflow | Fires on | Does |
| --- | --- | --- |
| `.github/workflows/ci.yml` | every push and PR | typecheck, lint, tests, both builds |
| `.github/workflows/pages.yml` | push to `main` | deploys the hosted app to GitHub Pages |
| `.github/workflows/release.yml` | tag `v*` | publishes the offline `.html` and its SHA-256 as a release |

Releasing is therefore: bump `APP_VERSION` in `src/version.ts` and the version
in `package.json`, commit, then

```bash
git tag v0.2.1 && git push origin v0.2.1
```

The release workflow refuses to publish if the tag and `APP_VERSION` disagree.
A download whose file name contradicts the version stamped inside its own
reports would defeat the point of stamping them.

### Rehearsing a release before going public

Every part of this can be exercised without a public repository — see
`docs/getting-started.odt` for the reviewer-facing walkthrough, and the
following for the publishing side.

Serve the hosted build exactly as a static host would, and install it:

```bash
npm run build
npm run preview        # http://localhost:4173
```

`localhost` counts as a secure origin, so the service worker registers and the
browser's install prompt appears there just as it would over HTTPS. To confirm
the offline behaviour, load it once, then in DevTools ▸ Network tick **Offline**
and reload: the app should come back with no network at all.

To rehearse the GitHub Pages path specifically — the one thing `preview` does
not reproduce, because Pages serves a project from a subdirectory:

```bash
PUBLIC_BASE=/DocR3V/ npm run build
mkdir -p /tmp/pages/DocR3V && cp -r dist/* /tmp/pages/DocR3V/
python3 -m http.server --directory /tmp/pages 8080   # http://localhost:8080/DocR3V/
```

And the offline download, opened the way someone who downloaded it would:

```bash
npm run build:offline
xdg-open dist-offline/DocR3V-*.html
```

For the workflows themselves, a **private** GitHub repository runs Actions and
releases normally; only Pages needs the repository to be public (or a paid
plan). So the honest full-dress rehearsal is a private repo for the release
workflow, plus a drag-and-drop static host for the Pages half.

## Performance

Measured in Chromium on synthetic SOP-shaped documents, from clicking Compare
to the comparison being on screen:

| Document | Diff engine | Total |
| --- | --- | --- |
| 500 KB (2,000 paragraphs) | 50 ms | ~0.9 s |
| 2.1 MB (8,000 paragraphs) | 230 ms | ~2.7 s |

The spec's target is under 3 seconds for 500 KB, so there is room to spare.

The diff itself is a small fraction of the cost — the time goes on laying out
tens of thousands of elements. `content-visibility` lets the browser skip that
work for anything scrolled out of view, which is what keeps the larger figure
under the target: the same 2.1 MB comparison takes about 5.2 s without it.

Paragraphs stay in the DOM rather than being virtualised. Windowing would be
faster still, but it breaks find-in-page and printing, and a reviewer who
cannot Ctrl-F for a clause is not being served by the extra frames. Above
roughly 3 MB the render time does start to dominate; the 5 MB ceiling is a
memory-and-patience limit rather than a performance guarantee.

## Project layout

```
src/
  components/    React UI
  services/
    parsers/     One module per input format, all producing ParsedDocument
    documentParser.ts  Format detection, size validation, dispatch
    tokenDiff.ts       Word-level diffing on top of diff-match-patch
    diffEngine.ts      Paragraph alignment, then word diff, then summary
    export.ts          Self-contained HTML report generation
  types/         Shared interfaces for parsed documents and diff results
docs/            The reviewer's getting-started guide
public/          Static assets: icons, and _headers for hosts that read one
scripts/         Test fixtures, install icons, the offline build stamp, the guide
.github/         CI, GitHub Pages deployment, offline-download releases
```

`docs/getting-started.odt` is generated from `docs/getting-started.html` by
`./scripts/make-guide.sh` — edit the HTML, not the ODT. Both are committed,
because the people who need the guide do not have a checkout to build it from.

## Feedback and support

- **Questions and ideas:** GitHub [Discussions](../../discussions).
- **Bugs and feature requests:** GitHub [Issues](../../issues). Never attach
  real or confidential documents; a small made-up pair of files is enough.
- **Security problems:** report them privately, as described in
  [SECURITY.md](SECURITY.md).
- **Contributions:** welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

Copyright © 2026 DocR3V contributors.

Licensed under the [Apache License, Version 2.0](LICENSE). You may use, change
and share DocR3V freely, including at work and in commercial settings, provided
the licence and [NOTICE](NOTICE) travel with it.

All runtime dependencies are open source: React (MIT), JSZip (MIT, used here
under MIT), diff-match-patch (Apache 2.0) and Tailwind CSS (MIT).
