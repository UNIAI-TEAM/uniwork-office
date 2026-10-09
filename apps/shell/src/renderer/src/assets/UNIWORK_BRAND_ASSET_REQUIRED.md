# Brand artwork

`app-icon.png` is the UniWork Office icon (the "Page" mark: a W of two people on a blue-cyan gradient page tile). The packager icons
(`apps/shell/build/icon.*`, `icons/`, and the standalone Docs app's `build/icon.*`) are the
same artwork. All of it is the overlay under `tools/rebrand/assets/` and is rebuilt from the
logo vector (`tools/rebrand/assets/_source/uniwork-office-logo.svg`) with `node tools/rebrand/gen-brand-icons.mjs`.

The home sidebar shows the icon next to the text "UniWork Office" (no separate lockup file).

The original GenOffice / Genspark lockup was removed because Apache-2.0 does not grant trademark
rights in those names or logos. If an upstream sync brings `genoffice-logo.svg` back, delete it:
nothing imports it.
