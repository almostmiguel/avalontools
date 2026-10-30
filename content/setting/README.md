# Avalon setting wiki

The wiki is authored in Markdown and built into complete HTML pages by Eleventy.
Articles no longer live in JSON or need JavaScript to display their text.

## Run and publish

```sh
npm install
npm start
```

Open http://localhost:8080/setting.html. The development server rebuilds and
reloads when an article, template, stylesheet, or shared navigation changes.
After deleting or renaming an article, restart `npm start` to clear old preview
pages. Production builds always start with clean output.

`npm run build` creates the complete publishable website in `_site/`: the
existing rules and tools plus the generated setting pages. The build cleans
that output directory first so removed articles are not published again.
`npm test` builds the site and runs the checks. Do not edit `_site/` directly.

`.github/workflows/pages.yml` builds, tests, and publishes `_site/` after pushes
to `main`, and can also be run manually. In GitHub repository settings, set
**Pages → Build and deployment → Source → GitHub Actions**. No deployment or
repository settings changes are made by the local build.

## Write an article

Add a file such as `content/setting/articles/the-crossroads.md`:

```markdown
---
title: The Crossroads
category: places
summary: A roadside settlement where three roads meet.
draft: true
sample: false
facts:
  - label: Connected to
    value: "[[The Lantern Company]]"
---

> All roads lead somewhere.

Write the introduction here. Meet [[Keeper Mara]] or visit
[[the-lantern-company|the company]].

## The market square

Use ordinary Markdown paragraphs, **emphasis**, lists, tables, and images.

### A smaller detail

Game references still work: {@action Stride|PC1}, {@trait move}, and
{@rule Actions}.
```

The filename supplies the stable article ID and URL:
`setting/the-crossroads.html`. Titles must be unique. Put the title in the
front matter and start article sections at `##`; `###` creates a subsection.
The contents list and unique heading anchors are generated automatically.

The six bundled articles remain explicitly labeled draft examples, not
established Avalon lore. Replace their text and remove `sample: true` as real
lore is written. Remove `draft: true` when an article is ready.

## Links and infoboxes

- `[[The Crossroads]]` resolves by title or filename ID.
- `[[the-crossroads|the settlement]]` sets custom display text.
- Standard Markdown links like `[the settlement](the-crossroads.md)` also work.
- Existing `{@wiki The Crossroads}` references remain supported.
- Links in prose and infobox facts generate backlinks automatically. Code
  examples are excluded. Missing wiki targets fail the build with an article
  name so they can be corrected before publishing.
- `facts` is optional; its values support inline Markdown, wiki links, and game
  references. This small front matter section produces the infobox.
- Local image paths are relative to the site root, e.g.
  `![The settlement](img/setting/the-crossroads.webp)`. Place assets in `img/`.
- Action and catalog references retain the existing hover previews.

Old `setting.html?article=…`, `?category=…`, and `?view=all` links redirect to
the generated pages. Previous article heading anchors are retained as aliases.

## Collections and implementation

`content/setting/atlas.json` holds the atlas title and small category directory.
Article prose is kept entirely in the `.md` files. Categories, article listings,
infoboxes, contents, and backlinks are rendered during the build. Browser
JavaScript only enhances name search, mobile navigation, old links, and previews.

`content/atlas.11ty.js` is the Eleventy page template.
`scripts/wiki-build.mjs` loads the Markdown and renders the shared page shell;
the top navigation is reused from `index.html`. `css/wiki.css` keeps Avalon's
fonts and colors. Published paths and assets work both at a domain root and
under a GitHub Pages project path.

This remains a static reading wiki with Git history. It does not need a
database or application server, and does not provide a browser editor.

## Design references

The layout takes inspiration from
[MediaWiki's Vector skin](https://www.mediawiki.org/wiki/Skin:Vector) and
[Just the Docs](https://github.com/just-the-docs/just-the-docs).
Their source was reviewed; their CSS and JavaScript were not copied.
Eleventy, gray-matter, and markdown-it are build dependencies; no Markdown
parser or wiki article data is downloaded by visitors.
