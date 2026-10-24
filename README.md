# Avalon

A fresh, English-first home for a personal Pathfinder setting. For now it has
only Books: a home-page button, a year-grouped book menu, and a JSON book reader.
There are no rule databases, translations, frameworks, or package dependencies.

## Run locally

With Node.js 20 or newer:

```sh
npm run serve:dev
```

Open http://localhost:8080. No install or build is needed. On Windows, use
`npm.cmd` if PowerShell blocks `npm`. Run checks with `npm test`.

## Appearance

Dark mode is the default, including the book reader. Open Settings in the
top-right corner and choose Dark or Light. Your choice is saved in this browser
and applies across the home page, library, reader, and hover previews.

## Add Player Core

Body paragraphs, including ability descriptions, stay flush left without
first-line indents. Labeled ability fields (such as Prerequisites, Trigger, and
Special) use a hanging indent: the label starts flush left, and wrapped lines
are indented. Centered flavor text and tables keep their existing alignment.

Player Core is registered in `data/books.json`. Its content file is
`data/book/book-pc1.json`. Add your English chapters to its `data` array, keeping
the source text separate from interface styling. The basic structure is:

```json
{
  "data": [
    {
      "name": "Introduction",
      "entries": [
        "Your chapter text goes here.",
        {
          "type": "h1",
          "name": "A section heading",
          "entries": [
            "Text with {@b bold}, {@i italics}, and {@as 1} action symbols.",
            { "type": "list", "items": ["First item", "Second item"] }
          ]
        }
      ]
    }
  ]
}
```

For demonstration content, add `"_meta": {"example": true}` alongside `data`
to display an example-content warning. Omit it when entering your actual book.

Refresh the browser after editing. The chapter list, section links, and
previous/next chapter links are generated from the JSON, not maintained separately.

### The three pieces to remember

- `data`: the list of chapters, in reading order.
- `name`: the title of a chapter or heading.
- `entries`: the paragraphs and smaller blocks inside it. Each string is a paragraph.

Use `h1` for a main section and `h2` for a subsection. Keep subsections
inside the parent section's `entries`. The reader already provides the chapter's
main title, so you do not need to repeat it as an entry.

The contents sidebar keeps chapter navigation and shows only explicit `h1` and
`h2` entries beneath the current chapter. Each level uses smaller text
and more indentation. Headings `h3` through `h6`, box titles, and note titles
stay visible in the book itself but are not listed in the sidebar. All headings
inside `box`, `inset`, `insetReadaloud`, and `sidebar` entries are also excluded
from the overview, even when their type is `h1`, `h2`, or `h3`. They remain
visible and linkable with their normal rule links and anchors.

To create nested overview groups, put the introductory `h2` sections inside an
`h1` named Introduction. Other `h1` sections, such as Character Creation and
Leveling Up, are siblings of Introduction in the chapter's `entries`. This lets
Introduction fold just its subsections, while the chapter row folds every group.

### Pages and folding sections

In the reader, each heading shows its printed `page` beside a small −/+ button.
Add `"page": 10` to an entry to set that number. Nested headings without their
own page inherit the containing section's page; missing or invalid page numbers
are not invented. The chapter title uses the chapter's own `page`.

Click − to hide a heading's entries, including nested sections, or + to show
them again. Folding a parent preserves the individual folded states inside it.
The chapter-title button folds the whole chapter text, leaving chapter navigation
available. Rule previews stay fully expanded.

The book title in the left overview is a permanent heading, not a collapse control.
The overview has independent expandable chapter and heading groups. Click
their +/− markers (or focus the summary and press Enter/Space) to fold a group;
click its title link to navigate. Collapse all and Expand all control the overview,
not the book text. A link into folded text automatically reopens its destination
and ancestors. Fold states last until the page reloads; printing includes all text.

### Lists without bullet points

Lists show bullet points by default. Add `"style": "list-no-bullets"` to hide
the markers and indentation and stack the items without extra paragraph gaps.
Use `items`, not `entries`, for the list's lines. This is useful for conversations
or play examples and also works inside rule hover previews:

```json
{
  "type": "list",
  "style": "list-no-bullets",
  "items": [
    "{@b Kyra (Jessica):} I cast a {@i light} spell ahead of us.",
    "{@b Erik:} Radiance spills forth, illuminating the ladder."
  ]
}
```

Omit `style` for a normal bulleted list. Use `"style": "list-decimal"` for a
numbered list. Formatting and links work inside every item. Normal paragraphs
and other lists keep their existing spacing.

### Lists and tables

These are entries too. Place either object inside an `entries` array:

```json
{
  "type": "list",
  "items": ["First item", "A {@b bold} second item"]
}
```

```json
{
  "type": "table",
  "caption": "A table title",
  "colLabels": ["First column", "Second column"],
  "rows": [["Row one", "Its value"], ["Row two", "Another value"]]
}
```

For centered flavor text, use `{"type":"flavor","entries":["Your text."]}`.
For a two-column conversation table, add `"style": "table-dialogue"` to the
table. Put the speaker in the first cell and their speech in the second. This
reserves a consistent speaker-column width, prevents names from breaking into
tiny fragments, and top-aligns both cells. On small screens the speaker sits
above their line. Ordinary tables are unchanged; captions and column labels
still work in this style.

For a callout, use `{"type":"inset","name":"Note","entries":["Your text."]}`.
Inline tags include `{@b bold}`, `{@i italic}`, `{@as 1}`, `{@as 2}`, `{@as 3}`,
`{@as r}` (reaction), and `{@as f}` (free action).
These use the original project's locally bundled `Pathfinder2eActions.ttf`
for the actual Pathfinder action glyphs, including in headings and previews.
The longer tag `{@actionsymbol 1}` also works. Screen readers receive the action
name rather than the font's underlying character. No external font request is needed.

### Actions, feats, and ability blocks

Use `ability` for a Pathfinder-style rules block. The name and action glyph
appear together, the kind/level sits at the right, and traits display as badges.
Only fields you supply are shown. This is a formatting example, not a published rule:

```json
{
  "type": "ability",
  "name": "Ability Name",
  "kind": "Feat",
  "level": 1,
  "actions": 1,
  "page": 15,
  "traits": ["General", "Skill"],
  "prerequisites": "Your prerequisites.",
  "frequency": "Once per day",
  "trigger": "The event that lets you use this ability.",
  "requirements": "What must be true to use it.",
  "entries": ["The ability's effect goes here."],
  "special": "Any additional rules."
}
```

Use `actions` values `1`, `2`, `3`, `"r"`, or `"f"` for the action icons;
omit it for a passive feat. `kind` is your display label (such as Action, Feat,
or Activity); omit `level` when the ability has none. `access` and `cost` are
also available. All fields except `name` and `type` are optional.
`level` accepts numbers or text, so `"level": "Level"` works for a template.
Omit `kind` if you want only “Level” at the right rather than “Feat Level”.

The main `entries` can contain paragraphs, lists, tables, and other book blocks.
You may alternatively use `effect` for the main text. Labeled fields and `special`
accept a string or an array of normal entries, and support the existing inline
tags. Trait badges can contain inline tags too, but do not require a trait database.

Ability blocks stay expanded and do not show page numbers or folding controls
in their header. Regular chapter/section headings keep their controls. A stored
`page` still provides source information in rule previews. Abilities can be linked with
`{@rule Ability Name|PC1}`. Their previews retain all the fields and badges.
They do not add entries to the h1–h2 overview. `ruleDefault`, `id`, `aliases`,
`setting`, and `settingNote` work just as they do on other named entries.

### Condensed abilities

Add `"compact": true` to an `ability` to show it as a short, flowing rules
paragraph instead of a full stat block. It uses the same font as normal ability
text, with a hanging indent for wrapped lines. Traits appear in parentheses;
labeled fields and the effect run together with semicolon separators.

```json
{
  "type": "ability",
  "compact": true,
  "name": "Action Name",
  "actions": 1,
  "traits": ["Concentrate"],
  "frequency": "Once per day",
  "trigger": "An enemy approaches.",
  "requirements": "You are standing.",
  "entries": ["Describe what the ability does."]
}
```

The normal ability fields, rule links, and setting markers still work. If
provided, kind/level appears in parentheses beside the name. Omit `compact`
or set it to `false` for the full version. Short text works best here; nested
lists or tables still render as separate blocks rather than being flattened.

### Decorative rule boxes

Use `box` for a dark-green panel with a brass double border and a title.
Add this object anywhere inside an `entries` array:

```json
{
  "type": "box",
  "name": "The First Rule",
  "entries": [
    "Your text goes here. You can use {@b bold} and {@i italics}.",
    "Each string becomes another paragraph."
  ]
}
```

The title stays inside the box and is not listed in the contents sidebar.
Omit `name` for a box without a title.
Its `entries` can also contain lists or other normal book blocks. Existing
`inset` notes keep their simpler appearance.

For another box-style title within the same panel, add a `box-section` inside
the box's `entries`. It has a title divider but no extra border or background:

```json
{
  "type": "box",
  "name": "First Title",
  "entries": [
    "Text under the first title.",
    {
      "type": "box-section",
      "name": "Second Title",
      "entries": ["Text under the second title."]
    }
  ]
}
```

Repeat `box-section` for more titled parts. You can also omit the outer box's
`name` and put every title in its own section. Box sections accept normal entries,
inline tags, and optional page metadata; their headings remain linkable and
support folding, but are not listed in the left overview.

### Book links and cover previews

Use `{@book Player Core|PC1}` in a paragraph to link to the book and show its
cover in a framed preview on hover or keyboard focus. Clicking the text, the
preview cover, or its Open book link opens the reader at the start of that book.
Escape closes the preview, just as it does for rule previews.

You can also use `{@book Player Core}` or `{@book PC1}`: the reader looks up the
book's title, id, or source in `data/books.json`, ignoring capitalization. Use a
third part for custom display text: `{@book Player Core|PC1|the core book}`.
With an explicit id in the second part, that id determines which book opens.

The preview uses the book's existing `cover` image path from `data/books.json`
and displays it without cropping. A book without a cover still opens normally;
its preview says that no cover has been added. References to books that are not
registered yet, such as `{@book GM Core}` while only PC1 exists, display an
unavailable message instead of a broken link. Add that book to the index and
provide its JSON content and cover when you are ready to include it.

### Avalon additions and adaptations

Add `"setting": "modified"` to an entry you have changed from the sourcebook,
or `"setting": "original"` for your own material. The reader gives it a colored
margin and an expandable **Avalon · Adapted** or **Avalon · Original** badge.
Click the badge to see the explanation and optional `settingNote`:

```json
{
  "type": "h4",
  "name": "Avalon",
  "page": 10,
  "setting": "modified",
  "settingNote": "Golarion has been replaced with Avalon.",
  "entries": ["Your setting-specific description goes here."]
}
```

Mark the smallest entry containing the change. To mark a single paragraph, wrap
it in `{"setting":"modified","entries":["Your changed paragraph."]}`.
Unmarked entries keep their normal appearance. These properties do not alter
heading anchors or add extra entries to the contents sidebar.

Rule previews retain the same marker, including when the linked rule is inside
a marked section. Adaptations say **Adapted from** rather than **Source**;
original entries show the book only as a reference location, without attributing
your original text to a printed page. The original/adapted distinction is always
written out, not conveyed by color alone. This is a manual editorial marker:
it does not automatically detect changes or keep a copy of the original text.

### Rule links and hover previews

Write `{@rule Action|PC1}` inside a paragraph to link to the named `Action`
entry in Player Core. Hover or focus the link to see its description and source;
click it to open the correct chapter and scroll to that heading. Press Escape
to dismiss the preview. You can move the pointer into the preview to read it or
follow its links. With the link focused, Alt+Down moves focus into the preview.

For different visible text, use `{@rule Action|PC1|actions}`. Omitting the source,
as in `{@rule Action}`, uses the current book. Matching ignores capitalization
and extra spaces; the displayed text is preserved.

Define the destination once, in the book's normal `entries`:

```json
{
  "type": "h4",
  "name": "Action",
  "page": 10,
  "aliases": ["actions"],
  "entries": [
    "Your rule description goes here. It can include {@b formatting} and other rule links."
  ]
}
```

`page` is optional and supplies the printed page number in the source line. It
can also be inherited from a containing section or chapter. No page number is
invented if it is absent. The text of the definition is also the preview text,
so there is no separate rules database to maintain. The definition stays out of
the contents sidebar when its type is `h4` or below, but is still linkable.

`aliases` is optional: it lets `{@rule actions|PC1}` find the same definition.
Normal headings, named boxes/notes, and chapter titles can all be destinations.
Links can use any source registered in `data/books.json`; their book files must
be present.

If a term has both a short introduction and a full rules section, add
`"ruleDefault": true` only to the full definition:

```json
{
  "type": "h1",
  "name": "Perception",
  "ruleDefault": true,
  "entries": ["Your complete Perception rules go here."]
}
```

Now `{@rule Perception|PC1}` goes straight to that definition and previews its
full text, even if other headings are also named Perception. This works for
aliases too, is independent of chapter order, and does not require an id.
The flag belongs to that entry only, not its children.

To link specifically to the introductory summary, give that entry an id such
as `"id": "perception-summary"`, then use
`{@rule perception-summary|PC1|Perception}`. Explicit ids take precedence over
name or alias matches. If multiple matching entries are marked as the default,
the link remains ambiguous rather than choosing one arbitrarily. Without a
default, duplicate names can still be targeted with unique ids. Missing and
ambiguous references show a helpful preview message instead of a broken link.

Links include the rule name or id as well as the chapter and heading. The reader
resolves the name again when opened, so adding earlier chapters or headings does
not make existing rule links jump to the wrong place.

JSON requires double quotes and commas between neighboring entries. Do not put
a comma after the last item, and do not add comments inside the JSON file.
To put quotation marks inside a paragraph, escape them as `\"`.

The reader also accepts a chapter array directly, a single object with `entries`,
or an export shaped like `{"bookData":[{"id":"PC1","data":[...]}]}`.

Supported blocks include `entries`, `section`, `h1` through `h6`, lists,
tables, images, insets/sidebars, quotes, and flavor text. It supports common inline
formatting tags, links, dice text, and action symbols. Entity references such as
`{@spell fireball|PC1}` display their text without linking to removed tools.
Spell tags automatically italicize their names, including custom labels such as
`{@spell light|PC1|a golden light}`. No extra `{@i ...}` wrapper is needed.
This is a small reader, not the complete legacy Pf2eTools renderer; specialized
entry types can be added as the actual book requires them.

Images can reference site-relative files such as `img/books/pc1/example.webp`
using `{"type":"image","href":{"type":"internal","path":"img/books/pc1/example.webp"}}`.
Add those image files when needed. The local server supports an `img/` directory.

### Labeled entries

For a labeled line with indented wrapping, use an `item` with
`"style": "hanging"` in its `entries`:

```json
{
  "type": "item",
  "style": "hanging",
  "name": "Edicts",
  "entry": "Your edicts go here; wrapped lines are indented."
}
```

Use another item named Anathema for that field. Labels are not hardcoded, so
other names or translations work too. Regular paragraphs elsewhere keep their
normal spacing and do not get a first-line indent.

## GitHub Pages

Book covers are configured with the optional `cover` path in `data/books.json`.
Player Core uses `img/books/pc1-cover.jpg`, a local copy of the cover displayed
on [Paizo's product page](https://store.paizo.com/pathfinder-player-core/).
The cover is shown in full, without cropping. Cover artwork belongs to its
respective copyright holders and is not covered by this site's MIT software license.
The restored action-symbol font in `fonts/Pathfinder2eActions.ttf` comes from the
previous project; this site's MIT software license does not relicense that font.

This is a buildless static site. In the repository's Pages settings, deploy from
the chosen branch's root folder. All links and data paths are relative, including
on a project URL such as `/avalontools/`. No deploy workflow, Docker, service worker,
or custom domain is configured. Nothing is published by running the local server.
Only commit book text and images you are permitted to publish.

## What was kept

Git history and the original `LICENSE.md` remain. The previous working files,
including uncommitted changes, were moved into the sibling backup directory
`AvalonTools-before-reset-20261024`. That backup is outside the website and is
not served or published with it.

Portuguese can be introduced as a separate translation layer later; English
source JSON should stay unchanged.
