# Avalon

A setting hub and curated rules reference for Pathfinder. The current site has
Home and Rules, with a list and detail workspace. Rules are written independently of books.
There are no frameworks, dependencies, or build step.

Future sections can hold a player's guide, character options, spells, equipment,
world lore, and campaign diaries. They can be added when needed.

## Run locally

With Node.js 20 or newer:

```sh
npm run serve:dev
```

Open http://localhost:8080. On Windows, use `npm.cmd` if PowerShell blocks
`npm`. Run the checks with `npm test`.

Dark mode is the default. Settings lets you switch to Light; the choice is
remembered in your browser.

Typography uses Gin from the original project for major headings, Source Sans 3
for the interface and rule text, and Source Serif 4 for flavor text, quotations,
and callout prose. Fonts are served locally, including real italic faces and
variable weights for the Source families. Pathfinder action symbols keep their
dedicated font. Font sources and notices are in `fonts/README.md`.

## Add a rule

Edit the `rules` array in `data/rules.json`. Add an object like this:

```json
{
  "id": "your-rule",
  "name": "Your Rule",
  "topic": "Encounters",
  "kind": "core",
  "source": "PC1",
  "entries": [
    "Your text goes here.",
    {
      "type": "h2",
      "name": "A Subsection",
      "entries": ["More details."]
    }
  ]
}
```

Save and refresh the browser. Search matches rule names and aliases only;
descriptions and topics are excluded. Topic, source, and type filters can be
combined with name search and shared by URL.
Click Name, Type, or Source above the list to sort it. Switching columns starts
A–Z; clicking the active column reverses its direction. Name is selected A–Z by
default, so clicking it initially switches to Z–A. An arrow shows the current
order, which is also preserved in the URL.
Sorting keeps the selected rule open. Until you choose a sort, searches rank
the most relevant matches first.

The list stays on the left while the selected rule appears instantly on the right.
The first matching rule opens automatically. Clicking another rule does not reload
the page. The URL includes its id, so reloading, sharing, and Back/Forward restore
selection. Ctrl/Cmd-click still opens a rule in a new tab. On smaller screens the
rule appears below the list, with a Rule list button to return to search.

Rule links inside descriptions and hover cards also select their destination in
place. If current filters exclude that destination, they are cleared to reveal it.

- `id`: required and unique within its source. Keep it when renaming or moving a rule.
- `name`: required display title.
- `topic`: one category or an array of categories; defaults to General.
- `kind`: `core`, `optional`, or `setting`.
- `source`: a citation identifier, such as PC1; defaults to Avalon.
- `page`: optional printed source page.
- `aliases`: optional array of alternative names.
- `setting`: `original` for Avalon material or `modified` for an adaptation.
- `settingNote`: optional explanation shown with the setting marker.

Original setting rules default to the Setting type unless you supply `kind`.
For two topics, write `"topic": ["Playing the Game", "Checks"]`. The rule appears
under either topic filter, both topics are searchable, and both show above its
title. Existing single-topic strings still work. A rule remains one entry even
when it belongs to multiple topics.

The `sources` array in the same file supplies citation names, for example
`{"id":"PC1","name":"Player Core"}`. It never imports content from a book.
Top-level objects in `rules` become database entries. Nested blocks stay within
their parent unless you explicitly promote them.

### Make a nested block its own rule

Add `"rule": true`, a unique `id`, and a `name` to a heading, box, or other block
inside a rule's `entries`:

```json
{
  "type": "h4",
  "name": "Attribute Modifier",
  "id": "attribute-modifier-pc1",
  "rule": true,
  "entries": ["Your explanation goes here."]
}
```

It stays in the parent and also appears as its own searchable rule. Link to it
with `{@rule Attribute Modifier}`. Its detail view and hover preview contain
that block's content, and its detail header links back to the containing rule.
Your existing Attribute Modifier section demonstrates this.

To keep a longer heading inside its parent but use a shorter rule title, set
`ruleName`:

```json
{
  "type": "h2",
  "name": "Step 4: Degree of Success",
  "ruleName": "Degree of Success",
  "id": "degree-of-success-pc1",
  "rule": true,
  "entries": ["Your explanation goes here."]
}
```

The parent keeps **Step 4: Degree of Success**. The list, standalone rule title,
and hover preview use **Degree of Success**, and `{@rule Degree of Success}`
links to it. The original heading name still works in searches and rule links.
`ruleName` belongs to that entry and is not inherited by its children.

The promoted rule uses the top-level parent rule's title as its default topic.
Attribute Modifier and Multiple Attack Penalty both get Checks, including when
nested inside Attack Rolls or other promoted rules. Set an explicit `topic` to
override this. It inherits the nearest containing source,
page, rule type, and setting marker unless you supply overrides. Its id, aliases, and
`ruleDefault` are its own; they are not inherited. Ordinary headings and boxes
remain unlisted. You can promote blocks at any nesting depth, including within
lists or boxes. Keep the content in one place; do not copy it to the top-level
array. Ability blocks keep their printed `kind` (such as Feat) while inheriting
the containing rule's Core/Optional/Setting type.

## Rule links and formatting

Use `{@rule Your Rule|PC1}` to link to an authored rule and show its
description on hover or keyboard focus. A third part changes the displayed text:
`{@rule Your Rule|PC1|a check}`. Omitting the source, as in
`{@rule Difficulty Classes}`, searches every source and uses the first matching
rule in the JSON's order. Links can also use an alias or explicit id. An explicit
source still restricts the lookup to that source.

For duplicate titles within an explicitly specified source, mark only the main
definition `"ruleDefault": true`.
Explicit ids take precedence over names. Missing and ambiguous references show
an explanation rather than choosing an arbitrary destination.

Escape dismisses a preview. You can move the pointer into it; Alt+Down while
focused on a rule link moves keyboard focus into its preview.

Inline tags include:

- `{@b bold}`, `{@i italic}`, `{@code code}`.
- `{@spell light}` for italic spell names.
- `{@as 1}`, `{@as 2}`, `{@as 3}`, `{@as r}`, and `{@as f}` for action symbols.
- `{@dice 1d20}`, `{@dc 15}`, and `{@hit 3}` for readable rules notation.
- `{@link Label|https://example.com}` for an external link.

Other entity tags remain readable text until their sections are implemented.

## Content blocks

Each string in `entries` is a paragraph. Nested objects add structured content.
Headings use `h1` through `h6`. These are content headings, below the page title.
Each level gets progressively smaller; `h6` uses a small italic heading to remain
distinct from `h5`. The hierarchy also applies inside hover previews.

For a list, use `items`:

```json
{
  "type": "list",
  "style": "list-decimal",
  "items": ["First step.", "Second step."]
}
```

Omit `style` for bullets, or use `list-no-bullets` for tightly stacked lines
without markers.

For a table, `caption` is the title and `colLabels` defines column names:

```json
{
  "type": "table",
  "caption": "Example Table",
  "colLabels": ["Roll", "Result"],
  "rows": [["1–10", "First outcome"], ["11–20", "Second outcome"]]
}
```

Use `"style": "table-dialogue"` for a speaker/speech table.

For a callout:

```json
{
  "type": "box",
  "name": "A Useful Reminder",
  "entries": [
    "Your text.",
    {
      "type": "box-section",
      "name": "Another Title",
      "entries": ["Another part of the same box."]
    }
  ]
}
```

For a collapsible Paizo clarification, add this inside a rule's `entries`:

```json
{
  "type": "clarification",
  "entries": [
    "The clarification text goes here.",
    "Another paragraph, with {@b emphasis} or a reference to {@rule Checks}."
  ]
}
```

The title defaults to **Paizo Clarification**, and the box starts collapsed.
Set `name` to customize the title, or `"open": true` to start expanded.
Clarifications support the same formatted
text, lists, and other blocks as rules, including inside hover previews.

For a centered calculation with a gold-accented panel, use `formula`:

```json
{
  "type": "formula",
  "name": "Melee Attack Roll Result",
  "entry": "d20 + Strength modifier + proficiency bonus + other bonuses − penalties"
}
```

The `name` is an optional small label above the calculation. Use `entry` for a
single line or `entries` for multiple paragraphs. Inline formatting and rule
links work normally, and the panel also appears in hover previews.

Additional blocks include `flavor` for centered italic text, `quote` with an
optional `by`, `image` with an `href` and optional `alt`/`title`, and
`item` with a bold `name` and an `entry`. Add `"style": "hanging"` to an item
for indented continuation lines, such as Edicts or Anathema. Body paragraphs
otherwise stay flush left.

### Ability blocks

Put an ability block inside a rule's `entries`:

```json
{
  "type": "ability",
  "name": "Ability Name",
  "kind": "Feat",
  "level": 1,
  "actions": 1,
  "traits": ["General", "Skill"],
  "prerequisites": "Your prerequisites.",
  "frequency": "Once per day",
  "trigger": "What lets you use the ability.",
  "requirements": "What must be true.",
  "entries": ["The ability's effect."],
  "special": "Additional rules."
}
```

Here `kind` is the ability's printed label, separate from the containing rule's
Core/Optional/Setting type. `level` accepts a number or a label such as Level.
`actions` accepts `1`, `2`, `3`, `r`, or `f`; omit it for a passive ability.
`access`, `cost`, and an `effect` alternative to `entries` are also supported.
Optional fields are omitted when empty. Add `"compact": true` for the condensed
inline format with hanging text.

## Project files

- `index.html`, `rules.html`: Home and the rules workspace.
- `rule.html`: preserves existing standalone links.
- `data/rules.json`: authored rules and citation metadata.
- `js/content-renderer.js`: rich text, content blocks, and action symbols.
- `js/rules-library.js`: rule data, lookup, search, and result rendering.
- `js/rules-app.js`: rules-page interactions.
- `js/rule-links.js`: rule hover previews.
- `js/theme.js`: appearance preferences.
- `css/`: shared, Home, and Rules styles.
- `scripts/serve.mjs`: local static server.
- `test/`: checks for the current features and local server.

## GitHub Pages

Deploy the chosen branch's root folder. All asset and data URLs are relative,
so project sites work too. Running the local server does not publish anything.
Only include text and assets you have permission to publish.

The original `LICENSE.md` remains. The bundled
`fonts/Pathfinder2eActions.ttf` came from the original project and is not
relicensed by this site's MIT software license.
