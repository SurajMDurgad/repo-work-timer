# Publishing a release

This repository produces an installable VSIX. Creating a GitHub PR does not publish it to the Visual Studio Marketplace.

1. Use the existing Marketplace identity `SurajMDurgad.repo-work-timer`. Keep both `publisher` and `name` unchanged across releases; changing identity requires an explicit data migration and upgrade plan.
2. Review the extension in an Extension Development Host on the supported platforms, including actual agent turns and terminal shell integration.
3. Run `npm ci`, `npm run check`, `npm test`, and `npm run package` using Node 22 or later. Install the generated VSIX for a smoke test.
4. Follow Microsoft's [publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) to authenticate as the publisher, then upload the VSIX from the publisher management page or publish with `npx vsce publish --no-dependencies`.
5. Once published, add the actual Marketplace URL to the README. Do not describe an unpublished VSIX as a live Marketplace listing.

The CI workflow packages a VSIX artifact but never publishes it. Publisher credentials must not be committed. Source changes go through a pull request targeting `develop`.

Before installing this extension alongside a personal prototype, disable the prototype to avoid duplicate status-bar items. The macOS prototype's monthly logs are migrated automatically on startup, including recorded terminal time. Original files remain intact. Migration failures show **History recovery pending** and retry automatically; customers should not need to reconstruct existing records from transcripts.

## History compatibility release gate

Treat the extension identity, `globalStorageUri/logs` location, repository hash algorithm, and historical record format as a persistence contract. Any change needs a tested migration before shipping; changing the package version alone must not change the data location.

`npm test` covers existing version-1 records, fresh activation after shutdown and simulated host crashes, legacy migration and retries, overlapping windows, and retained prior months. The CI workflow runs this suite on macOS, Linux, and Windows.

Before publishing, smoke-test the actual VSIX upgrade in an isolated VS Code user-data directory: install the previous release, use a synthetic Git repository and history, install the candidate under the same extension identity, reload and fully restart VS Code, and verify totals, prior months, pause state and limits. Keep the storage directory intact throughout. Automated tests mock VS Code APIs and do not replace this installed-extension check.
