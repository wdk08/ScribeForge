# GPLv3 licensing review — ScriptForge 1.0.0

Prepared October 19, 2026. This is an engineering compliance review of the locked
source/assets, not a legal opinion. No public upload or release has occurred.
Initial commit `3ae83aa` remains unchanged; licensing work is a new working change.

## Decision and ownership

The owner explicitly authorized making ScriptForge open source under GPLv3,
and confirmed ownership/permission for the user-supplied logo and app icons.
Original ScriptForge work is now **GPL-3.0-only**, Copyright (C) 2026 wdk08.
Copyright is retained; GPL grants recipients use, modification and redistribution,
including commercial redistribution, subject to its conditions. It cannot be
combined with the former blanket prohibition on modification/redistribution.
There is no copyright assignment to the FSF, no requirement to GPL user screenplays,
and no grant over privately imported voices or system TTS voices.

## What caused the concern

`@diffusionstudio/piper-wasm` 1.0.0 declares MIT in npm package metadata, but
`build/piper_phonemize.wasm` contains eSpeak NG and `.data` contains compiled
phoneme/dictionary data. ScriptForge copied these into `vendor/piper/`, with
an ES-module export added to `piper_phonemize.js`. Piper's MIT wrapper cannot
relicense eSpeak NG. eSpeak NG is GPLv3-or-later. `vendor/TTS-NOTICES.md` already
acknowledged that fact, but retained only moving source links and unpinned build
instructions. A license label or a GitHub auto-generated source zip alone did
not establish corresponding-source availability for those opaque assets.

## Options considered

- Keep proprietary app terms: obtain all necessary alternate permissions from
  applicable rightsholders, or investigate an actually independent speech process
  boundary/another permissively licensed phonemizer. An MIT wrapper, dynamic
  import, Web Worker or ordinary linking is not a reliable license boundary.
  This would require legal/technical review and could disturb features.
- Adopt GPLv3 for the app and preserve the speech implementation: simplest fit
  for the owner's revised decision, with full source/notices/build distribution.
- Remove Piper/Table Reads: unnecessary and not performed.

The chosen solution is GPLv3 plus a source-built version of the same Piper/eSpeak
functionality. No speech architecture, playback control, import/assignment or
editor feature was removed. Real imported Piper audio and mixed table reads
were tested against the new artifacts, not merely mocks.

## Compatibility findings

| Part | Finding / action |
| --- | --- |
| eSpeak NG | GPL-3.0-or-later is compatible with the GPLv3 combination. Full source/data inputs, original licenses and rebuild recipe retained. |
| Piper phonemizer, JSON, uni-algo | MIT/public-domain alternatives compatible; notices/full source headers retained. No unlicensed unused tashkeel neural model is bundled. |
| ONNX Runtime Web 1.22.0 | MIT core with retained third-party notices and source/build dependencies. Only WASM runtime is deployed. Its broad upstream notice mentions optional native proprietary runtimes (such as Intel MKL); those are not bundled and must not be introduced without review. |
| jsPDF 4.2.1 and embedded JS | MIT and retained component notices. Preferred src/build configuration accompanies the minified UMD code. |
| Tauri / Rust/npm graph | 529 locked package records audited, a conservative superset including build/test/other-target packages. Permissive MIT/Apache/BSD/ISC/Zlib/Unicode/CC0 and related compatible terms; dual-license selections recorded. No incompatible required term identified. |
| MPL-2.0 crates | cssparser, cssparser-macros, dtoa-short, option-ext, selectors: preserve MPL source/notice duties; apply section 3.3 for the GPL combination. No attached secondary-license exclusion found in inspected source. Text of Exhibit B inside the license itself is not an exclusion. |
| ONNX source dependencies | Preserve originals and their exact source versions, including Eigen MPL-2.0 and Boost mp11 BSL-1.0. ONNX explicitly defines EIGEN_MPL2_ONLY; retain it so optional non-MPL Eigen modules are not linked. Optional/native execution providers are not silently enabled by this review. Source checksums are verified rather than ignored on mismatch. |
| Fonts | Courier Prime 1.203 unmodified, OFL-1.1 with Reserved Font Name; aggregate under OFL, do not relicense fonts under GPL. Embedding does not GPL a screenplay PDF. Original font attribution retained. |
| Logo/icons | Owner-authorized GPLv3; original supplied PNG is retained and generated icon variants included. No separately licensed proprietary font file is bundled with the artwork. |
| Voices/models | None distributed. User imports are private data; not relicensed. Lessac-low optional test fixture is outside repo/installers, with separately linked dataset terms. Do not treat a model-card link or app GPL as permission to redistribute any weights. |
| GitHub / DMG / NSIS / updates | No incompatible distribution term identified in these configured channels. Offer GPL source/notices beside each binary and preserve installation/rebuild freedom. No App Store channel, restrictive EULA or locked hardware distribution is configured. |

## Obligations implemented

- Full unmodified GPLv3 LICENSE, original-work COPYRIGHT grant and consistent
  npm/Cargo/bundle license metadata. Third-party copyrights remain intact.
- THIRD_PARTY_NOTICES.md index; retained 529-package inventory and full deduplicated
  notice texts, OFL, GPL/Apache/BSD/Unicode/MIT notices and ONNX upstream notices.
- LICENSE/COPYRIGHT/notices/source instructions are packaged with the app;
  About has a readable local license/source panel. No notices need an Internet
  connection to read.
- Pinned source archives for the exact rebuilt Piper/eSpeak version and native
  data compilation; SDK patch/flags and JS export documented. Provenance hashes
  bind the actual deployed artifacts to their recorded source build.
- SOURCE_CODE.md and SOURCE-BUILD.md explain obtaining, modifying, building and
  manually installing without the owner's private signing credentials.
- Source release generator includes exact app snapshot, Cargo-vendored sources,
  readable npm sources, pinned upstream source archives and build/install scripts.
  No user data, private keys or imported voices are copied. Private source paths
  and source archive checksums are checked.
- Manual release workflow uploads matching source/checksum to the approved draft
  *before* installers and refuses publication if source assets are missing.
  Use GPLv3 section 6(d) for free public same-release source access. Keep source
  available while corresponding binaries are offered, including older versions.
- GPLv3 installation information duties apply where the section 6 User Product
  conditions are met. Ordinary desktop modification/install instructions are
  provided. Keep official authenticity keys private; forks may build/sign/install
  their own binaries. No downgrade/signature bypass was introduced.

## Scope and remaining checks

The compatibility result is based on inspected locked packages, upstream terms,
asset provenance, actual shipped-runtime selection and source build evidence.
An SPDX scanner alone is not a legal guarantee. New dependencies, voices,
execution providers, stores or hardware distribution require fresh review.

The local source archive, notice checks, packaged UI and speech tests must pass
before considering the local changes ready. Cross-platform source packaging and
release workflow still need an approved GitHub run. Publisher signing/notarization are intentionally omitted by the owner; updater
signatures remain required. Installed-version updating remains untested until
actual target-machine checks pass. Do not describe those steps as resolved by licensing.

## Primary references

- https://www.gnu.org/licenses/gpl-3.0.html (sections 1, 4–6 and 10)
- https://www.gnu.org/licenses/gpl-faq.html
- https://www.gnu.org/licenses/license-list.html
- https://www.mozilla.org/en-US/MPL/2.0/FAQ/ (questions 14, 25)
- https://openfontlicense.org/ofl-faq/ (aggregation and document embedding)
- https://github.com/rhasspy/espeak-ng/tree/0f65aa301e0d6bae5e172cc74197d32a6182200f
- https://github.com/wide-video/piper-phonemize/tree/cfff8e52ebaea37c7e953ae2d06b174acb827ac4
- https://github.com/microsoft/onnxruntime/tree/v1.22.0
