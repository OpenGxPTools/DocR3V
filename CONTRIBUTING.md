# Contributing to DocR3V

Thank you for your interest. DocR3V is a community project maintained on a best-effort basis.

## Feedback

- **Questions, ideas and experiences:** use GitHub **Discussions**.
- **Bugs:** open an **Issue** using the bug-report form. Include the steps to reproduce it, what you expected
  and what happened.
- **Feature requests:** open an **Issue** using the feature-request form.
- **Security problems:** follow [SECURITY.md](SECURITY.md) and never post them publicly.

Never attach real or confidential documents to issues or discussions. Make a small made-up pair of files that
shows the problem instead.

## Code contributions

1. Open an issue first to discuss larger changes.
2. Keep each pull request focused on one change, and match the style of the surrounding code.
3. What the comparison reports is the core of the tool. Explain any change to it clearly in the pull request,
   and bump `APP_VERSION` in `src/version.ts` if the same pair of documents would now be reported differently.
4. Run `npm run typecheck`, `npm run lint` and `npm run test:run`, and add tests for what you change.
5. Keep the app free of network calls: no analytics, fonts, CDNs or other external requests.
6. Update the [README](README.md) or the [getting-started guide](docs/getting-started.html) when behaviour
   changes.

By submitting a contribution you agree that it is licensed under the Apache License, Version 2.0, the
licence of this project, and that you have the right to submit it.
