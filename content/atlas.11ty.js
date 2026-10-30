import { renderWikiPage } from "../scripts/wiki-build.mjs";

export default class {
  data() {
    return {
      pagination: { data: "atlas.pages", size: 1, alias: "entry" },
      permalink: data => data.entry.output,
      eleventyExcludeFromCollections: true,
    };
  }
  render({ atlas, entry }) { return renderWikiPage(atlas, entry); }
}
