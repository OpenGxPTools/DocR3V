# Security policy

## Reporting a vulnerability

Please **do not** report security problems in a public issue or discussion.

Use GitHub's private reporting instead:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.

Please include:

- what the problem is and where it is (screen, export or file)
- the steps to reproduce it, with a made-up sample document if one is needed
- which version you tested, and whether it was the web version or the offline file
- what an attacker could achieve

You should receive an acknowledgement within 14 days. Fixes are made on a best-effort basis (see
[DISCLAIMER.md](DISCLAIMER.md)). Once a fix is available, the problem is described in the
[CHANGELOG](CHANGELOG.md), with credit to the reporter if they wish.

## Supported versions

Only the latest release receives security fixes. The web version updates itself; if you keep an offline
file, download the latest release to get fixes.

## Scope

DocR3V runs entirely in the browser and sends nothing over the network; its Content Security Policy forbids
it. Of particular interest:

- a document that, when compared, runs script or loads anything from the network
- an exported report (HTML, ODT, PDF, clipboard) that runs script or loads anything when opened
- any way the content of a compared document leaves the user's computer

Out of scope:

- vulnerabilities in third-party components, which should go to their maintainers (please tell us if
  DocR3V is affected)
- problems that need an already-compromised computer or browser
- findings from automated scanners without a demonstrated impact
