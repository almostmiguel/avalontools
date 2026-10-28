# Lucide icons

Source: https://github.com/lucide-icons/lucide
Revision: `2ca268e74888d3506b3319fb8f94aaaaf70ceca9`
License: ISC, with MIT notices for icons derived from Feather; see LICENSE.txt.

The local sprite contains only the icons used by Avalon. Geometry is unchanged
from the upstream SVGs. Root SVG attributes are supplied by each usage so colors
and size follow the site theme. Four standalone SVGs are used by CSS masks.

In HTML, use an accessible, decorative SVG inside an already labeled control:

```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <use href="img/icons/lucide.svg#book-open"></use>
</svg>
```

In renderer code, use `renderIcon(name, className, { filled })` from
`content-renderer.js`. Give icon-only controls an `aria-label`.

The site does not request icons from third-party servers or load the complete
Lucide JavaScript package.
