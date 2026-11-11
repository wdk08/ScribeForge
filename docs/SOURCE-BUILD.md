# Build and install from a ScriptForge source release

Extract the archive; `app/` is the project and `dependencies/` holds vendored
Cargo sources, readable npm sources, and ONNX Runtime/jsPDF upstream archives.
`SOURCE-MANIFEST.json` identifies the release snapshot, base commit, source
checksums and any local working changes. Published archives must be made from
the exact clean reviewed release commit, not a dirty development snapshot.

1. Install Node.js 20+, npm, Rust 1.90+, and the platform prerequisites linked
   in app/README.md. These general-purpose tools/system libraries are external.
2. From `app/`, run `npm ci` to restore the locked build/test tools. Exact npm
   URLs/integrity hashes are in package-lock.json; readable installed package
   sources are also supplied in dependencies/npm. No voice is downloaded.
3. Run `npm test`, `npm run check` and `npm run desktop:test`. Cargo uses the
   included .cargo/config.toml and dependencies/cargo; `cargo check --offline
   --locked --manifest-path src-tauri/Cargo.toml` uses these retained sources.
4. `npm run desktop:build` creates a local preview with existing app features,
   ad hoc Mac signing and no official signing secret requirement. On Windows,
   install build tools/Windows SDK/WebView2 as in README; generated NSIS installer
   can be installed manually. On macOS, replace only the app bundle; do not delete
   its data directory. No project private key is required to install a modified app.
5. Production/fork distributors configure their own updater key, endpoint and
   appropriate platform signing. Never request or distribute the official private
   signing key. Official updater authenticity does not prevent manual builds.

## Piper and dictionary/phoneme data

Already rebuilt JS/WASM/data and their checksums are supplied in vendor/piper/.
To modify them, install CMake, a native C/C++ compiler and Python, then obtain
Emscripten SDK commit 37b85e9eaee5be090569d018cca77a15cacc11b7 (tag 3.1.47), install
and activate version 3.1.47. CMake 4.4.4 was used locally; minimum policy mode is
recorded in the script. These are general-purpose build tools.

From app/: `npm run build:piper -- --sdk /path/to/emsdk --install`.
The script verifies/extracts the included source archives and uses no upstream
source download. It builds native eSpeak to generate *all* dictionary/phoneme
inputs, then the matching WASM static library and same Piper command API. It
retains the original UCD wchar declaration workaround in that SDK's cached
header, records all flags and appends only the ES-module export. No neural voice,
unused Arabic tashkeel model, MBROLA engine/voice or Sonic rate processing is
bundled. Source records and GPL/Apache/BSD/Unicode/MIT notices are retained.
Run actual Piper audio and table-read browser/native checks after rebuilding.
`npm run licenses:generate` updates the reviewed notice/provenance inventory.

## ONNX Runtime and PDF code

The actual bundled ONNX Runtime Web version is 1.22.0. Extract
`dependencies/onnxruntime-v1.22.0.tar.gz`; follow its js/web/ and build tools
instructions, cmake/deps.txt pinned dependency recipes and third-party notices.
Core/WASM dependency source archives are included too. Run `node scripts/prepare-onnx-source.mjs ../dependencies` from app/ to verify/extract the upstream archive and redirect reviewed dependency URLs to local source archives. Eigen uses the exact upstream Git commit archive because its generated zip failed the old upstream hash; both provenance and the replacement hash are recorded. ONNX sets EIGEN_MPL2_ONLY; preserve it. The npm package's readable TS/JS sources are under dependencies/npm. Build only
the WebAssembly execution provider corresponding to ort.wasm.min.mjs and
ort-wasm-simd-threaded.{mjs,wasm}; no native proprietary MKL/CUDA/TensorRT binary
is part of ScriptForge. Preserve upstream dependencies and notices when changing
this build. Optional SDK/toolchains and native-provider dependencies are described
by upstream; no claim of a fully offline ONNX rebuild is made.

Extract `dependencies/jspdf-v4.2.1.tar.gz` for jsPDF's preferred src/ and original
build configuration; retain embedded contributor licenses when regenerating the
UMD runtime. App code and embedded Courier Prime files are supplied directly;
Courier Prime remains unmodified OFL-1.1, not GPL font software.

Bit-for-bit reproducibility is not asserted across hosts/toolchains. Sources,
inputs and build scripts correspond to the distributed functionality. Test any
newly built artifacts before distributing them. `RELEASING.md` describes source
asset generation, official release safeguards and separate platform validation.
