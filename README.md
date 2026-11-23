# MyNotes

A free, open source handwriting notes app for iPad, built as an installable web app.
No App Store, no Mac, no fees. Notes are stored on your device.

## Features

- Apple Pencil writing with pressure: fountain, ballpoint and brush pens, solid, dashed or dotted lines
- Fast live ink that draws only the newest part of each stroke, with adjustable stabilization
- Hold at the end of a stroke to snap it to a neat line, triangle, rectangle, parallelogram, polygon, ellipse or circle, keeping its rotation
- Colour fill for closed shapes, a full colour palette and a custom colour picker
- Dark pages, search for typed text and sticky notes, and up to 600% zoom
- Highlighter, stroke eraser, colours and sizes, undo and redo
- Laser pointer with a fading trail or a dot that disappears when you lift the Pencil
- Lasso selection: move, resize, rotate, recolour, change thickness or pen style, copy, paste, duplicate and delete
- Text boxes, sticky notes, and images from Photos or Files with cropping
- Pinch to zoom, continuous page scrolling, pull up past the last page to add one
- Pages panel in two columns with bookmarks and a bookmarked-only filter
- Every notebook starts with a cover page you can write on, shown in the library
- Six page templates (blank, lined, narrow, grid, dotted, Cornell) and paper colours, per page or whole notebook
- Opens read-only by default with an Edit switch, plus a presentation mode with a floating toolbar
- Folders (nested) with colours, multi-select, move, rename and a Trash that keeps items for 30 days
- Light, dark or system appearance, and an option to draw with a finger
- Works offline once installed, and installs to the iPad Home Screen

Coming next: export and backup, Google Drive sync, PDF import.

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
js/ink.js               Pen types, stroke drawing, laser and eraser hit testing
js/items.js             Text boxes, images and sticky notes
js/shapes.js            Hold-to-snap shape recognition
js/fill.js              Colour fill
js/templates.js         Page templates and paper colours
js/ui.js                Shared menus, dialogs and icons
js/settings.js          Per-device preferences
js/db.js                On-device storage (IndexedDB)
icons/                  App icons
```

## License

MIT. See [LICENSE](LICENSE).
