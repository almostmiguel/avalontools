# Local fonts

The site loads these assets from its own `fonts/` directory. No external font
stylesheet or runtime request is required. Text fonts use `font-display: swap`;
the main UI and heading fonts are preloaded.

| Font | Role | Origin |
| --- | --- | --- |
| Gin Regular | Brand, major headings, box titles, ability titles | Restored unmodified from the original project's backup |
| Source Sans 3 | Interface, lists, rule text | Adobe; variable Latin WOFF2 files distributed by Fontsource |
| Source Serif 4 | Flavor text, quotations, callout prose | Adobe; variable Latin WOFF2 files distributed by Fontsource |
| Pathfinder2eActions | Action, reaction, and free-action glyphs | Retained from the original project |

Source Sans 3 and Source Serif 4 include regular and italic faces with variable
weights from 200 to 900. The Latin subset covers Portuguese accents. Fonts are
unmodified; the site's CSS uses local family names to assign their roles.

## Sources and licenses

- [Gin, Fort Foundry](https://fortfoundry.com/fonts/gin)
- [Source Sans, Adobe](https://github.com/adobe-fonts/source-sans)
- [Source Serif, Adobe](https://github.com/adobe-fonts/source-serif)
- [Source Sans 3 web files](https://github.com/fontsource/font-files/tree/main/fonts/variable/source-sans-3/files)
- [Source Serif 4 web files](https://github.com/fontsource/font-files/tree/main/fonts/variable/source-serif-4/files)

The Adobe families are distributed under the SIL Open Font License 1.1; their
license texts are included in `SourceSans3-LICENSE.md` and
`SourceSerif4-LICENSE.md`.

Gin and Pathfinder2eActions remain subject to their original font licenses.
Restoring these existing project assets does not relicense them under the site's
MIT software license.
