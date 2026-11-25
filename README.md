# GitHub CODEOWNERS Filter

Chrome extension that adds a **Code owners** filter to the GitHub pull request "Files changed" page. GitHub only offers "Only files owned by you"; this lets you filter by **any** owner (user or team) in `CODEOWNERS`.

## Install

From source:

1. Clone this repo
2. Open `chrome://extensions` and turn on **Developer mode**
3. Click **Load unpacked** and pick the cloned folder

## Use

Open any PR's **Files changed** tab. Next to GitHub's filter button there's a new people icon:

- Lists every owner who owns at least one changed file, with a file count
- Select one or more owners. Files owned by **any** selected owner stay visible, in both the diff list and the file tree
- **No owner** shows files that no CODEOWNERS rule covers
- The selection is remembered per repository. Use **Clear** to reset it

## How it works

- Reads the PR's changed files and base branch from the data GitHub embeds in the page
- Fetches `CODEOWNERS` from the base branch (`.github/`, the repo root, then `docs/`) using your existing GitHub session, so private repos work without a token
- Matches paths the way GitHub does (gitignore-style patterns, last matching rule wins)
- Hides files by injecting a stylesheet, so GitHub's own filters keep working alongside it

## Files

- `manifest.json`: MV3 manifest
- `codeowners.js`: CODEOWNERS parser and matcher
- `content.js`: data loading, filter UI, hiding logic
- `content.css`: styles that use GitHub's theme variables, so light and dark mode both work
- `icons/`: extension icons
- `package.sh`: builds the zip for the Chrome Web Store

## Releasing

1. Bump `version` in `manifest.json`
2. Run `./package.sh` to build `dist/github-codeowners-filter-<version>.zip`
3. Upload the zip in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)

## Privacy

No data is collected. See [PRIVACY.md](PRIVACY.md).

## License

MIT
