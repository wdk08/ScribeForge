# StoryForge 1.0.0

StoryForge is Forge Studios’ local writing room for novels, short fiction, poetry, and other manuscripts. Each manuscript is one continuous rich-text document with a read-only Chapter Navigator.

Use [StoryForge in your browser](https://wdk08.github.io/StoryForge/) or see the [desktop downloads](https://github.com/wdk08/StoryForge/releases/latest).

## Development

Use Node.js 20.19+ or 22.12+ and run `npm ci` from this directory.

- Browser Dev — `npm run dev:browser`, then visit [localhost:4273](http://localhost:4273). Use this hostname consistently, since browser storage is origin-specific.
- macOS Dev — `npm run dev:mac`. Install the Xcode command line tools and Rust 1.90 or later first.
- Checks — `npm test`, `npm run test:browser`, and `npm run test:desktop`. The browser suite uses installed Google Chrome.
- Frontend assets — `npm run build:browser` or `npm run build:desktop:dev`. The Pages build uses the `/StoryForge/` base path. Run `npm run test:pages` after the browser build to verify it locally.

The macOS development app uses `~/Library/Application Support/com.storyforge.desktop.dev/`. A production desktop build would use the separate `com.storyforge.desktop` identifier and app-data directory. On Windows the directories live under roaming AppData. Browser development uses an IndexedDB database with the development identifier. The standalone browser build caches its application shell on HTTPS or localhost for offline reopening. Use **Export → StoryForge (.stf)** to create a portable backup. Managed saves and exports are separate. The Recovery Checkpoint opens the previous completed save as a separate manuscript.

## File formats

- **STF** preserves manuscript IDs, metadata, page settings, paragraph styles, formatting, and manual page breaks. Importing a changed file whose ID is already present asks before creating a separate copy.
- **PDF** uses the system print panel. Choose **Save as PDF**, use 100% scale, and turn off browser-generated headers and footers. Support for custom PDF headers, footers, and page counters varies by print engine. The on-screen writing surface scrolls continuously and shows estimated pages. Print performs final pagination.
- **DOCX** preserves supported run and paragraph formatting. Word and StoryForge can lay out the same fonts differently. Tables become paragraphs, link labels become text, and advanced Word features such as embedded objects, tracked deletions, fields, and list numbering can require conversion. StoryForge reports detected import limitations before creating a manuscript.
- **EPUB** uses reflowable sections and semantic headings. Reading apps control final fonts and page layout. EPUB import is unavailable.
- **TXT** uses UTF-8 and retains text, paragraphs, and form-feed page breaks.

The library card menu exports portable STF copies and supports undoable removal from the managed library. **Writing Statistics** shows library totals and recent activity. Typing and editing metrics are estimates based on local editor activity.

The paragraph-style selector includes **Create Style from Selection** and **Manage Styles**. A manuscript embeds applied style definitions. Editing or deleting a style in the shared library leaves existing manuscript definitions intact. The toolbar displays the selection’s resolved fonts, sizes, and alignment.

**Read to Me** uses one installed local speech voice. Voice availability depends on the browser and operating system. The Profanity Analyzer uses the ScriptForge v1.2.0 dictionary, with chapter filters and links to prose occurrences. The existing ScriptForge GPL license and attribution are retained. Desktop updates use the release downloads.
