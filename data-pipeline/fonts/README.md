# OG-card fonts

These TTFs are loaded by `generate_state_og.py` (via resvg's `font_dirs`) so the
social-share cards (`public/og-card.png` + `public/og/state-*.png`) render with
the site's brand type — Source Serif 4 and Inter — **deterministically on any
machine**, including the GitHub Actions runner that rebuilds the cards on every
deploy. resvg matches them by family name, so the output doesn't depend on the
runner's installed fonts; system fonts stay only as a last-resort fallback (so a
load failure degrades to a readable serif rather than blank text).

They are the Latin-subset variable fonts that already ship the website, just
decompressed from WOFF2 to plain TTF (resvg reads TTF/OTF, not WOFF2). Source:
`node_modules/@fontsource-variable/{inter,source-serif-4}/files/*-latin-wght-*.woff2`.

Both are licensed under the SIL Open Font License 1.1 — see `OFL-Inter.txt` and
`OFL-SourceSerif4.txt`.

## Regenerating

After bumping the `@fontsource-variable/*` packages, re-run (needs
`fonttools` + `brotli`):

```python
from fontTools.ttLib import TTFont
src = "node_modules/@fontsource-variable"
for rel, out in [
    ("source-serif-4/files/source-serif-4-latin-wght-normal.woff2", "SourceSerif4-Variable.ttf"),
    ("source-serif-4/files/source-serif-4-latin-wght-italic.woff2", "SourceSerif4-Italic-Variable.ttf"),
    ("inter/files/inter-latin-wght-normal.woff2", "Inter-Variable.ttf"),
]:
    f = TTFont(f"{src}/{rel}"); f.flavor = None
    f.save(f"data-pipeline/fonts/{out}")
```
