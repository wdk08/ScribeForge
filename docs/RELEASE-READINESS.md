# Public release readiness

This records acceptance requirements, not a claim that an update has shipped. The
owner authorized pushing the clean GPLv3 history and publishing v1.0.0 after all
required checks pass. No release is triggered by a source push.

## Locally configured

- First official version 1.0.0, main branch, repository wdk08/ScriptForge.
- Existing app identifier com.scriptforge.desktop retained.
- Official Tauri v2 updater, HTTPS GitHub metadata, version-bound signature verification and default newer-only comparison.
- Owner's public verification key embedded; private key/password remain outside source/packages.
- Native once-per-launch state, manual Help check, one About dialog using actual native version, styled dialogs and real/indeterminate progress.
- Verified download/install phases, Windows installer exit handling, macOS restart deferral, and save/recovery/preference barriers.
- Manual release workflow for both macOS architectures and Windows x64, signed updater artifacts, Mac ad hoc signature/architecture checks and unsigned Windows status checks.
- Secrets/user data/historical validation excluded. Curated test fixtures anonymized; third-party notices retained.
- Initial commit identity configured locally as wdk08 with the owner's approved GitHub no-reply address; global Git settings unchanged.

## Still required before publication

- Conditional release authorization was provided for v1.0.0. Preserve the original development commit privately and push only the clean publication history.
- Validate the new GPLv3 source/notice packaging in the approved cross-platform workflow. The owner authorized GPL-3.0-only for original code/artwork. Piper is rebuilt from pinned sources; actual source archive and voice tests are required. See docs/LICENSING-REVIEW.md.
- Every native build must verify real updater bytes and signed versions against the embedded public key. No paid Apple/Windows credentials are required under the owner-selected ad hoc/unnotarized Mac and unsigned Windows policy. Repository security settings are not changed automatically.
- Review the source inventory and full-history audit. No destructive Git operation is required.
- Execute Intel/Windows CI builds and verify actual signatures/installers on those platforms. Apple Silicon compilation alone proves neither.
- Verify public metadata/binary access after an approved release exists.
- Validate desktop builds must pass on the exact main SHA, including real installed-version download/install/restart/data-preservation tests on both Mac architectures and Windows. Official release enforces this prerequisite before creating a draft. See docs/PLATFORM-VALIDATION.md for test isolation and OS-policy limits.

## Audit boundaries

.gitignore excludes dependencies/build outputs, .env/private key/certificate files, local grants, databases, local screenplay folders, recovery/backups and historical validation/. Curated screenplay/media fixtures remain included. No private signing key is read by the public-key helper. GPL-3.0-only is explicitly authorized for original work, with third-party licenses retained. Original development commit 3ae83aa is preserved privately; public history starts with clean licensed snapshot f6e9776.

The audit prints filenames/categories rather than matched secret values. Pattern scanning supplements manual review; it cannot guarantee detection of every sensitive item. Third-party license obligations remain separate and mandatory.

## Licensing and next steps

Local GPL metadata, full license/notices, packaged legal UI, traceable Piper source build and source-release workflow gates have been implemented. No functionality was removed. No voice weights are bundled. Source archives are generated locally before any approved upload. See docs/PLATFORM-VALIDATION.md for the owner-confirmed choice to omit paid publisher credentials and the remaining separate Intel/Windows/real-installed-update checks. Nothing in local licensing preparation proves a public or installed update has succeeded.
