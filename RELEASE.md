# Releasing ScribeForge

On a clean `main` checkout with write access to `wdk08/ScribeForge`, run `npm ci` and then `npm run release`. Have Chrome and the native Rust toolchain installed for the local checks.

Choose patch, minor, major, or a custom stable version. Add a short release summary when prompted, or commit detailed notes in `releases/scribeforge/vX.Y.Z.md` beforehand. The command synchronizes the application versions, runs validation, and asks you to type the tag before it commits and pushes.

The tag triggers the existing GitHub Actions installer workflow. It publishes the release after the Apple Silicon, Intel macOS, and Windows x64 installers pass asset validation. See [release configuration](RELEASING.md) for signing, updater artifacts, and the separate Pages deployment.

To validate an already prepared release, run `npm run release -- --check vX.Y.Z`. If validation or confirmation stops the interactive command, the prepared files stay in your checkout. After reviewing them, validate any edits, commit the prepared files, and push `main` and the matching annotated tag together with `git push --atomic origin main vX.Y.Z`. If the push itself fails, inspect the local commit and tag before retrying the push.
