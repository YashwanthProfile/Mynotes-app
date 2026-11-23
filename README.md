# MyNotes

A free, open source handwriting notes app for iPad, built as an installable web app.
No App Store, no Mac, no fees. Notes are stored on your device.

## Features

- Apple Pencil writing with pressure: pen, highlighter and eraser, with colours and sizes
- Undo and redo, add, clear and delete pages
- Folders (nested) to organise notebooks, with move and rename
- Paper styles: blank, lined, grid, dotted
- Light, dark or system appearance, and an option to draw with a finger
- Works offline once installed, and installs to the iPad Home Screen

Coming next: hold-to-snap shapes, fill colour, Google Drive sync, and PDF import and export.

## Install on iPad

1. Open the app's address in Safari.
2. Tap the Share button, then **Add to Home Screen**.
3. Open MyNotes from the Home Screen.

## Run locally

There is no build step. The folder is the app. Serve it with any static file server, for example:

```
python -m http.server 8000
```

Then open http://localhost:8000.

## Publishing an update

1. Change the files.
2. Bump `VERSION` in `sw.js` (for example `0.1.0` to `0.1.1`).
3. Commit and push. GitHub Pages republishes automatically, and the app on the iPad shows an **Update** button the next time it is opened.

## Project layout

```
index.html              App page
manifest.webmanifest    Home Screen install details
sw.js                   Offline support and updates
css/app.css             Styles
js/app.js               Library, folders and settings
js/editor.js            Notebook editor: pages, Pencil input, tools, undo
js/ink.js               Stroke drawing and eraser hit testing
js/ui.js                Shared menus, dialogs and icons
js/settings.js          Per-device preferences
js/db.js                On-device storage (IndexedDB)
icons/                  App icons
```

## License

MIT. See [LICENSE](LICENSE).
