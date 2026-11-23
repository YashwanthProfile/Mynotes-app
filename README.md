# MyNotes

A free, open source handwriting notes app for iPad, built as an installable web app.
No App Store, no Mac, no fees. Notes are stored on your device.

## Features

- Notebook library with cover colours
- Paper styles: blank, lined, grid, dotted
- Works offline once installed
- Installs to the iPad Home Screen and opens full screen

Coming next: Apple Pencil writing, hold-to-snap shapes, fill colour, Google Drive sync, and PDF import and export.

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
js/app.js               App logic
js/db.js                On-device storage (IndexedDB)
icons/                  App icons
```

## License

MIT. See [LICENSE](LICENSE).
