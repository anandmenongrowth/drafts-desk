# Drafts Desk

Phone app for capturing writing ideas and reviewing short-post drafts. It stores nothing itself. It talks to a
private writing repo through the GitHub API, using a fine-grained token that stays on your phone.

Open the app, connect once (repo as owner/name plus a token with Contents read and write on that repo only),
then install it (Android Chrome menu, Install app. iPhone Safari, Share, Add to Home Screen).

Files: `index.html` (app), `core.js` (logic, tested in `tools/test.html`), `sw.js`, `manifest.webmanifest`,
icons and the albatross mascot (`mascot.svg`, built from `mascot-body.svgfrag` by `tools/`).
