# ScribeForge releases

The desktop workflow packages Apple Silicon and Intel macOS disk images and a Windows x64 NSIS installer. Push the validated version tag to trigger the release. The publish job requires all three installer targets and uses `releases/<tag>.md` for the release description.

The Pages workflow deploys the Vite build from `main` when dispatched. Set the repository's Pages source to GitHub Actions and dispatch `pages.yml` on `main`. The site is published at [ScribeForge on GitHub Pages](https://wdk08.github.io/ScribeForge/).

For Apple Developer ID signing, configure the ScribeForge repository secrets `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, and `APPLE_SIGNING_IDENTITY`. For notarization, also configure `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`. The Windows workflow can import a ScribeForge signing certificate from `WINDOWS_CERTIFICATE` and `WINDOWS_CERTIFICATE_PASSWORD`. Without platform credentials, macOS bundles use ad-hoc signing and Windows installers are unsigned.

To enable the desktop updater, set the repository variable `SCRIBEFORGE_UPDATER_PUBLIC_KEY` and the matching `TAURI_SIGNING_PRIVATE_KEY` secret. Set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key is password-protected. Keep the ScribeForge private key outside the repository and retain it for future updates. The workflow embeds the public key in production installers, verifies all three version-bound signatures, and attaches `latest.json`. Builds without either key use manual installers. Development and browser builds skip update checks.

Use the [manual release command](RELEASE.md) to validate and push a new version tag.

The renamed 1.0.0 build uses the tag `v1.0.0-scribeforge`. The original v1.0.0 tag continues to identify the earlier build.
