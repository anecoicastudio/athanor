# OG-card fonts (build-time only)

Static Hanken Grotesk TTF instances (400, 600, 400-italic) for the Satori render in
`app/[handle]/opengraph-image.tsx`. Satori parses TTF/OTF/WOFF but **not woff2**, so the
self-hosted woff2 files in `app/fonts/` cannot be reused here.

These files are read with `fs.readFile` during `next build` and never ship in the Worker
bundle — the runtime path of the OG route redirects instead of rendering (10 ms CPU budget).

Source: Google Fonts static instances of Hanken Grotesk v12 (fonts.gstatic.com).
License: SIL Open Font License — see `../../app/fonts/OFL-hanken-grotesk.txt`.
