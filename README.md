# Devlog

Devlog is a zero-dependency PWA for project-centric work logging. It stores Markdown directly in a user-chosen folder using the browser File System Access API, so project data stays portable and sync-friendly.

## What this build includes

- Root-folder onboarding backed by the File System Access API
- Root `manifest.json` plus per-project `project.json`
- Project sidebar sorted by `lastEdited`
- Log, Tasks, and Info documents per project
- Monthly, daily, or single-file log partitioning
- Auto date header insertion on first edit of the day
- Auto timestamped bullets in log mode
- Debounced autosave
- Live Markdown preview
- Export as combined Markdown or zip
- Delete project from the selected root folder
- Offline shell caching via a service worker

## How to run it

Serve the folder with a simple static server, then open it in a Chromium-based browser:

```bash
cd "/Users/julianmarinov/Documents/Programming/Codex Projects/WP Maintenance Project"
python3 -m http.server 4173
```

Then visit [http://localhost:4173](http://localhost:4173).

## Notes

- This build targets Chrome, Edge, Arc, and other Chromium browsers. Safari and Firefox do not fully support the folder-writing workflow used here.
- Project deletion is permanent in this browser-based build. Browsers do not expose a system Trash integration for folder handles.
- External file changes are detected on save and surfaced as a reload/overwrite conflict instead of silently overwriting disk content.
