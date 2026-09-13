# Changelog

All notable changes to Devlog are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-13

First public release.

### Added
- Desktop app for macOS (Apple Silicon and Intel), Windows and Linux, built with Electron.
- One root folder with a subfolder per project, plus Log, Tasks and Info documents for each project.
- Today's date heading is added automatically, and Enter starts a new bullet stamped with the current time.
- Monthly, daily or single-file log partitioning, with custom date and time formats.
- Autosave with detection of external edits (reload the disk copy or overwrite it).
- Live Markdown preview in split, write and preview views.
- Export a project as one combined Markdown file or as a zip archive.
- Link and Find dialogs (`Cmd/Ctrl+K`, `Cmd/Ctrl+F`).
- Pending edits are saved before the app quits or the window closes.
- Only one app window runs at a time, so two windows can't write the same files.
- Browser version for Chromium-based browsers (File System Access API).
- Release workflow that builds installers for all three platforms on version tags.

### Fixed
- Text typed while a save was in progress could be lost.
- Leaving the editor (switching apps, clicking toolbar buttons) removed the in-progress bullet and moved the cursor to the end of the file.
- Tab, task toggle, quote and heading actions selected the whole line, so the next keystroke replaced it.
- The first keystroke on a new day or month could also land in the previous log file.
- Custom date formats inserted a new date heading on every keystroke.
- Unsaved text was discarded when switching notes while an external-edit conflict was pending.
- The app showed a load error on every launch after a project folder was deleted outside the app.
- Preview links with `&` in the URL were broken, and `&` in link text showed as `&amp;`.
- Zip exports garbled non-Latin (e.g. Cyrillic) file names and included hidden files like `.DS_Store`.
- The browser version kept serving outdated app files after an update.

[0.1.0]: https://github.com/julianmarinov/DevLogger/releases/tag/v0.1.0
