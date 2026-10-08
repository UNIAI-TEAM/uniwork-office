# Brand artwork

`app-icon.png` is the UniWork Office icon (the blue "W" mark). The packager icons
(`apps/shell/build/icon.*`, `icons/`, and the standalone Docs app's `build/icon.*`) are the
same artwork. All of it is the overlay under `tools/rebrand/assets/` and is rebuilt from the
master icon set with `node tools/rebrand/gen-brand-icons.mjs <master-dir>`.

The home sidebar shows the icon next to the text "UniWork Office" (no separate lockup file).

The original GenOffice / Genspark lockup was removed because Apache-2.0 does not grant trademark
rights in those names or logos. If an upstream sync brings `genoffice-logo.svg` back, delete it:
nothing imports it.
