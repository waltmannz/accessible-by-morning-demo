# Accessible by Morning

A fictional appointment site with planted accessibility bugs, a repair loop, and a review dashboard. The demo runs real Chromium checks before and after changing the source. Google Gemini Managed Agents can repair and review the site in separate hosted environments; a deterministic local mode makes the same demonstration reproducible without a key.

The site is fictional. No patient information, booking, or email is sent. A passing automated audit is evidence about the measured checks, not a claim of WCAG compliance or a substitute for a disabled auditor and real screen-reader users.

## Run locally

Requires Node.js 22 or later, npm, and Chromium system dependencies.

```sh
npm ci
npm run browser:install
npm start
```

Open http://localhost:3000. Try the seeded appointment site, then start a local or Gemini run. The dashboard provides before/after previews, measured evidence, source changes, and the independent verdict. Run artifacts persist under `runs/` across service restarts and are excluded from Git.

The command-line pipeline produces the same reports:

```sh
npm run demo
npm run demo -- --gemini
npm test
```

If port 3000 is occupied, set `PORT=4173` in `.env` and open http://localhost:4173. Managed runs may take several minutes. Cancellation retains remote interaction IDs for diagnosis; after a service restart, interrupted work is shown rather than silently starting another paid run.

For Gemini mode, copy `.env.example` to `.env` and configure `GEMINI_API_KEY` locally, or set it in your shell. Never commit a real key. The managed preview must be enabled for that key/project; a standard Gemini key does not guarantee preview access. The adapter uses `antigravity-preview-09-2026`, REST Interactions, inline fixture sources, bounded polling and continuation, and a fresh review environment. It does not silently switch a Gemini run to local repair.

## Evidence and deliberate defects

The buggy `fixture/` is preserved on the default branch. See [BUGS.md](BUGS.md) for the planted barriers and expected checks. `frontend/` is the operator dashboard; `backend/` runs the pipeline and serves the previews. Every run keeps its original and repaired source, axe and Lighthouse results, screenshots, keyboard task evidence, simulated accessible-name transcript, review, and proposed diff.

The browser verifier independently checks the returned source. Publication requires the verification gate to pass. The accessible-name transcript is a DOM-based simulation, not recorded NVDA, TalkBack, or a blind user's verdict. Human audit and filmed before/after task remain explicitly pending until performed.

Prepare a static public comparison only from a completed verified run:

```sh
node scripts/publication.js runs/<verified-run-id> docs
```

The command refuses failed runs, missing Lighthouse measurements, failed keyboard/function checks, rejected reviews, and managed reviews that reuse the fixer's environment. It copies only the fixture's three source files, report, and measured evidence; it never copies `.env` or credentials. A public repair PR should replace `fixture/index.html`, `fixture/styles.css`, and `fixture/app.js` with that run's verified `after/` files on a separate branch. Keep `main`'s fixture buggy to repeat the demonstration. GitHub Pages can serve the `docs/` static before/after comparison; the local dashboard remains the run controller.

## Operations

`GET /health` is the readiness endpoint. `PORT` defaults to 3000; the container sets 8080. Keep this demo on a trusted network: the operator can start browser and paid Gemini jobs, and this prototype has no identity or billing layer. Persist `/app/runs` when running the container.

```sh
docker build -t accessible-by-morning .
docker run --rm -p 8080:8080 --env-file .env -v accessible-evidence:/app/runs accessible-by-morning
```

An external hosting deployment is optional and requires the chosen provider's credentials. Local previews and downloadable reports work without hosting.

## Sources

Managed Agent integration follows Google's [Managed Agents documentation](https://ai.google.dev/gemini-api/docs/antigravity-agent) and [Interactions API documentation](https://ai.google.dev/gemini-api/docs/interactions). Automated audit interpretation follows [Lighthouse accessibility scoring](https://developer.chrome.com/docs/lighthouse/accessibility/scoring), [axe-core](https://github.com/dequelabs/axe-core), and [WCAG 2.2](https://www.w3.org/TR/WCAG22/). Preview API availability and model names can change; live failures are surfaced in the dashboard and report.
