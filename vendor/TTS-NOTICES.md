# Local speech runtime notices

The application serves these assets locally. No voice weights or neural TTS
models are included; imported voice models have their own licenses.

- `onnx/`: ONNX Runtime Web **1.22.0**, from the pinned npm package. MIT notice
  in `onnx/LICENSE`; full upstream `onnx/ThirdPartyNotices.txt` is retained.
  Corresponding source and core/WASM dependency sources accompany releases.
- `piper/piper_phonemize.{js,wasm,data}`: now rebuilt locally from pinned
  wide-video Piper phonemizer and eSpeak NG source, not the opaque precompiled
  `@diffusionstudio/piper-wasm` binary. Same command API, local phonemization,
  inference path, voice import and table-read features. `provenance.json` records
  source/archive/artifact checksums. See `BUILD-UPSTREAM.md`.
- Piper phonemizer source: MIT (Michael Hansen); eSpeak NG code and dictionary/
  phoneme data: **GPL-3.0-or-later**. ScriptForge's GPLv3 combination preserves
  these rights. Full GPL, Apache, BSD and Unicode notices are retained here.
  Uni-algo, JSON and Emscripten support notices are also retained.
- Complete build inputs are under `third-party/piper-source/` in the repository
  and source release. `scripts/build-piper.mjs` records flags, native dictionary
  compilation, WASM linking and the SDK wchar declaration workaround.

`npm run vendor:tts` refreshes ONNX only and verifies Piper provenance. It must
never overwrite Piper with untraceable precompiled assets. Use `build:piper` to
rebuild it and `licenses:generate` to refresh reviewed notices. No command here
implicitly downloads voices. Retain all notices when redistributing.
