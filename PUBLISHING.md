# Publishing a release

This repository produces an installable VSIX. Creating a GitHub PR does not publish it to the Visual Studio Marketplace.

1. Create or verify a Marketplace publisher that you control. `package.json` currently uses the intended publisher ID `SurajMDurgad`; change it if the registered ID differs.
2. Review the extension in an Extension Development Host on the supported platforms, including actual agent turns and terminal shell integration.
3. Run `npm ci`, `npm run check`, `npm test`, and `npm run package` using Node 22 or later. Install the generated VSIX for a smoke test.
4. Follow Microsoft's [publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) to authenticate as the publisher, then upload the VSIX from the publisher management page or publish with `npx vsce publish --no-dependencies`.
5. Once published, add the actual Marketplace URL to the README. Do not describe an unpublished VSIX as a live Marketplace listing.

The CI workflow packages a VSIX artifact but never publishes it. Publisher credentials must not be committed. Source changes go through a pull request targeting `develop`.

Before installing this extension alongside a personal prototype, disable the prototype to avoid duplicate status-bar items. To retain historical totals, use **Import Agent History** in the new extension; this reads the same source transcripts and does not move or delete prototype logs.
