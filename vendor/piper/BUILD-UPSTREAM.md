# Traceable Piper speech runtime build

ScriptForge's runtime is built from the exact source inputs recorded in
`third-party/piper-source/manifest.json` using Emscripten 3.1.47. Source archives
are supplied, including eSpeak dictionary/phoneme data inputs and notices.

Run `npm run build:piper -- --sdk /path/to/emsdk --install` from the project.
The complete executable build recipe is `scripts/build-piper.mjs`. It verifies
source hashes, builds native dictionary data, compiles the same eSpeak version
for WASM, links the Piper command interface and appends the ES module export.
Generated artifact hashes are recorded in `provenance.json`. See
`docs/SOURCE-BUILD.md` for toolchain installation and modifications.

This replaces the previous opaque @diffusionstudio/piper-wasm 1.0.0 artifacts,
whose July 2024 package only declared MIT despite embedding GPL eSpeak NG and
whose build instructions used unpinned dictionary sources. No voice/model
architecture or application feature is replaced. Source-built artifacts were
verified with real Piper inference, imported voice persistence and table reads.

Origins: https://github.com/wide-video/piper-phonemize and
https://github.com/rhasspy/espeak-ng . Upstream Piper copyright is Michael
Hansen (MIT); eSpeak NG and data are GPLv3-or-later with their original notices.
The original Emscripten UCD header declaration workaround is retained and
recorded, not hidden in a developer's compiler installation.
