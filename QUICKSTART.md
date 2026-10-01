# Show the demo

Live public comparison: https://waltmannz.github.io/accessible-by-morning-demo/

The public page and recorded dashboard show an actual Gemini 3.8 Flash repair, fresh browser measurements, and a separate model review. The deliberately buggy source remains on `main`; repair PRs remain open for inspection.

## On a new checkout

Install Node.js 22 or later, then run:

```sh
npm ci
npm run browser:install
npm run demo:show
```

Open the URL printed by the server (default http://127.0.0.1:3000). The completed recorded AI run loads automatically without a key or another paid request. The import verifies the published manifest, keeps the original measurement dates, and labels the result as recorded evidence. It never replaces a working run. Stop with Ctrl+C.

If a port is occupied, set `PORT=4173` in local `.env` or your shell, then restart. Run directories persist across restarts.

## Present a concrete task

1. Ask a visitor to choose a time and book using Tab and Enter on **Before**. Time slots and booking action cannot be reached.
2. Switch to **After** and repeat. Choose a future date, a time, a name and an email. This fictional clinic sends nothing.
3. Open the readable report, actual source PR, screenshots and Lighthouse reports. The original scorecard is 81→100, axe 4→0, and keyboard booking blocked→passed.
4. Show the supplemental five-state browser check separately: initial page, keyboard focus, confirmation, validation error and reflow. The repaired source is unchanged. Human accessibility review and real screen-reader testing are still pending.

## Recheck without any model calls

```sh
npm test
npm run verify:demo
```

The second command runs fresh Chromium on the checksum-verified before/after source. It writes its own dated proof under `runs/browser-recheck-…`. It does not refresh the original model review or imply human testing.

## Start an actual new AI repair

Set `GEMINI_API_KEY` in ignored local `.env`. Select **Gemini API** in the dashboard or run `npm run demo -- --gemini-api`. Low thinking reserves the output budget for complete source; a separate request reviews the candidate after the browser checks. Usage includes known failed responses, and missing usage is explicitly reported rather than estimated.

Managed Agent mode is an explicit experimental alternative. Its filesystem smoke worked, but the earlier full jobs timed out and later became terminal `incomplete`. Do not present those jobs as successful managed repairs. No paid job runs automatically when starting or replaying the demo.

## Prepare and release evidence

```sh
npm run publish:prepare -- runs/<approved-run-id> docs --recheck runs/<browser-recheck-id>
```

Review the generated page locally and run tests before committing `docs/`, `manifest.json` and the code changes. The publisher allows only final source, measured browser proof, final reviewer summary and call usage; raw model responses and thoughts are excluded. It checks both source versions, enforces a 6 MiB proof budget and records exact byte hashes. Checksums establish integrity against the bundled manifest; the linked GitHub revision supplies provenance, not a cryptographic signer.

Push `main` to update GitHub Pages, then verify the build and live manifest hashes. Keep `fixture/` buggy and publish repairs on separate PR branches; do not merge the demo repair PRs into `main`.

The local controller is intended for a trusted network. For a deliberately configured HTTPS reverse proxy or mapped port, set `DEMO_PUBLIC_ORIGINS` to its exact origin, for example `https://demo.example.com`. The server does not trust forwarded headers to allow paid mutations. Public GitHub Pages serves only static evidence and never holds the API key.
