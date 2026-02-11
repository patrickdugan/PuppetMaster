# PuppetMaster

PuppetMaster is a mission-driven browser automation platform built on Playwright + OpenAI Responses vision. It can run QA loops, UI/browser operations, growth and marketing audits, and structured web research workflows with reproducible run artifacts.

## Requirements

- Node.js 18+
- npm
- An OpenAI API key with access to vision-capable models

## Setup

```powershell
npm install
npm run install:browsers
```

Set your API key (current shell):

```powershell
$env:OPENAI_API_KEY = "sk-..."
```

Set your API key persistently for future shells:

```powershell
setx OPENAI_API_KEY "sk-..."
```

Optional settings:

```powershell
$env:OPENAI_MODEL = "gpt-5-mini"
$env:OPENAI_API_URL = "https://api.openai.com/v1/responses"
$env:PM_VISION_PROVIDER = "openai" # openai|lens
$env:PM_LENS_CONTRACT_MODE = "judge" # judge|raw
$env:PM_RUNS_DIR = "D:\\PuppetMasterRuns"
```

`PM_VISION_PROVIDER` notes:
- `openai` (default): uses Responses API image judging and requires `OPENAI_API_KEY`.
- `lens`: uploads the screenshot to Google Lens using Playwright and scrapes Lens text.

`PM_LENS_CONTRACT_MODE` notes (only for `PM_VISION_PROVIDER=lens`):
- `judge` (default): converts Lens output into a `PASS`/`FAIL` compatibility contract for QA loops.
- `raw`: returns raw Lens summary text plus prompt/metadata excerpt.

## Vision OCR Rotator (TypeScript)

Use this when you need OCR over a screenshot folder with quota-aware key rotation and persistent monthly usage tracking.

Create a key pool file (example at `scripts/vision-key-pool.example.json`) and point each `path` to a Google service-account JSON key.

```powershell
npm run vision:rotator -- --input-dir "runs\my-run\shots" --key-pool-file "scripts\vision-key-pool.example.json"
```

Optional flags:

```powershell
npm run vision:rotator -- --input-dir "runs\my-run\shots" --key-pool-file "keys\pool.json" --crop "300,0,900,720" --include-text --output-json "runs\vision-ocr-report.json" --usage-file "runs\vision-usage.json"
```

Outputs:
- Report JSON under `runs/` (or your `--output-json` path)
- Persistent usage tracker JSON (default `runs/vision-usage.json`)

## X Lead Research (Google Discovery to CSV)

This script discovers `x.com` profiles from Google search results, applies paced navigation with smooth scrolling, and exports lead rows for scoring.

```powershell
npm run research:x-leads -- --query "site:x.com \"defi trader\"||site:x.com \"perps vc\"" --pages 2 --sessions 2 --max-profiles 80 --out-csv "runs\x-leads.csv"
```

Optional social-tag merge (following/follower/mutual from an existing CSV export):

```powershell
npm run research:x-leads -- --query "site:x.com \"defi\"" --tags-csv "C:\path\social_export.csv" --only-mutual --keywords "vc,trader,perps,market maker,defi"
```

CSV columns:
- `session_id`
- `query`
- `handle`
- `profile_url`
- `bio_snippet` (Google snippet)
- `matched_keywords`
- `social_type`
- `is_mutual`

## TradeLayer Prospect Distill (X Handles to Shortlist)

Use this when you already have a large handle list (for example following/follower exports) and want only likely funds/traders who might use TradeLayer.

Fast path (bio-only, no profile visits):

```powershell
npm run research:x-tradelayer -- --handles-file "C:\path\following.csv" --mode bio-only --gait-ms 15000 --out-csv "runs\tradelayer-shortlist.csv"
```

Profile mode (captures profile screenshots and uses OpenAI vision with 15s pacing):

```powershell
npm run research:x-tradelayer -- --handles-file "C:\path\following.csv" --mode profile --gait-ms 15000 --api-key-file "%USERPROFILE%\Desktop\GPTAPI.txt" --max-profiles 1500 --out-csv "runs\tradelayer-shortlist.csv" --out-json "runs\tradelayer-shortlist.json"
```

Accepted input columns for CSV:
- `handle` or `username` or `screen_name`
- optional `bio` or `bio_snippet` or `description` for `bio-only` mode

Output includes only shortlisted rows with:
- `handle`, `profile_url`
- `headline`, `bio`
- `score`
- `fund_signal`, `trader_signal`, `tradelayer_fit_signal`
- `likely_use_tradelayer`
- `matched_terms`

## VIP List Capture (X List Members to HNWI CSV)

This script visits a private/curated X list members page, captures screenshots for each profile, uses OpenAI vision to extract public profile text, and emits CSVs. It also cross-references the existing TradeLayer shortlist and appends novel qualified leads flagged as HNWI.

Recommended mode is CDP attach (uses your already-logged-in Chrome session):

1. Start Chrome with a debugging port (use a fresh user-data-dir so Chrome allows DevTools remote debugging):

```powershell
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\pm-cdp-chrome" "https://x.com/i/lists/<id>/members"
```

2. Log in to X in that Chrome window (if needed) and leave it open on the members list.

3. Run capture:

```powershell
npm run research:x-vip-list -- --cdp-url "http://127.0.0.1:9222" --list-url "https://x.com/i/lists/<id>/members" --gait-min-ms 3000 --gait-max-ms 7000 --api-key-file "%USERPROFILE%\Desktop\GPTAPI.txt"
```

Outputs are written under `runs/vip-list-<ts>/`:
- `vip-members-all.csv` (all discovered members)
- `vip-members-tradelayer-shortlist.csv` (only qualified TradeLayer-style leads)
- `tradelayer-shortlist-with-vip-hnwi.csv` (existing merged shortlist + novel VIP leads with `hnwi_flag=true`)

## Run QA

Static site target:

```powershell
npm run qa -- --target "C:\path\to\index.html" --mode static --url http://localhost:4173
```

Vite app target:

```powershell
npm run qa -- --target "C:\path\to\app\package.json" --mode vite --url http://localhost:5173 --cmd "npm run dev"
```

Webpack app target:

```powershell
npm run qa -- --target "C:\path\to\app\package.json" --mode webpack --url http://localhost:8080 --cmd "npm run start"
```

## Desktop Probe (Native Apps)

Use the desktop probe to capture a native Windows app window, dump the UIA control tree, and (optionally) run the vision judge on a screenshot.

Requirements:
- Python 3.9+
- `pywinauto` and dependencies:

```powershell
pip install pywinauto pillow pywin32
```

Run the probe:

```powershell
npm run desktop:probe -- --app "C:\path\to\App.exe" --window-title "My App"
```

Optional judge (requires `OPENAI_API_KEY`):

```powershell
npm run desktop:probe -- --app "C:\path\to\App.exe" --window-title "My App" --judge
```

Optional Python override:

```powershell
$env:PM_PYTHON = "C:\path\to\python.exe"
```

## Desktop Mission

Creates a `summary.json` alongside screenshots and probe output.

```powershell
npm run desktop:mission -- --app "C:\path\to\App.exe" --window-title "My App" --max-steps 3 --max-minutes 5
```

See `DESKTOP_SETUP.md` for setup details.

## Desktop Loop (Prompted)

Run a multi-iteration desktop loop with a top-level goal prompt recorded in `run.json`.

```powershell
npm run desktop:loop -- --app "C:\path\to\App.exe" --prompt "Find broken control and note likely source files" --project "C:\path\to\repo" --framework godot --reuse
```

## Android Agent (Bootstrap)

Use this to bootstrap Android automation runs with reproducible artifacts (`run.json`, `summary.json`, screenshots, UI dumps). It works with:
- a connected Android device (USB debugging on), or
- an emulator already running, or
- optional emulator launch via AVD name.

Requirements:
- Android platform tools in PATH (`adb`), and optionally emulator binary (`emulator`).

Dry run:

```powershell
npm run agent:android -- --dry-run true
```

Capture 3 iterations from first connected device/emulator:

```powershell
npm run agent:android -- --iterations 3 --interval-sec 5
```

Target a specific serial and launch an app first:

```powershell
npm run agent:android -- --serial emulator-5554 --app-id org.telegram.messenger --activity org.telegram.ui.LaunchActivity
```

Start emulator AVD if no device is connected:

```powershell
npm run agent:android -- --start-emulator Pixel_7_API_34 --wait-sec 120
```

## Android Appium Scaffold

Generate a minimal Appium workspace (config + smoke test) next to PuppetMaster:

```powershell
npm run agent:android:scaffold -- --out-dir "C:\projects\PuppetMaster\PuppetMaster\mobile-appium" --app-id org.telegram.messenger --activity org.telegram.ui.LaunchActivity
```

Then in the scaffold directory:
- `npm install`
- `npm run appium:server`
- `npm run test:smoke`

## Mission Types

- `qa`: UI regression checks, exploratory interaction, bug verification.
- `browser-ops`: scripted browser operations and stateful interaction tasks.
- `marketing`: landing page/funnel checks, messaging and CTA visibility audits.
- `research`: structured page exploration with evidence capture and traceable outputs.

Current built-ins:
- `npm run qa`
- `npm run qa:probe:sweepweave`
- `npm run mission -- --module <module-id>`

Available mission modules:
- `social.linkedin`
- `social.x`
- `social.youtube`
- `social.tiktok`
- `email.gmail`
- `email.outlook`
- `email.marketing.mailchimp`
- `email.marketing.klaviyo`

Run a module:

```powershell
npm run mission -- --module social.linkedin
```

Override URL:

```powershell
npm run mission -- --module email.gmail --url "https://mail.google.com/mail/u/0/#inbox"
```

## Mission Templates

Use this simple mission spec in prompts or run notes so outputs stay comparable:

```json
{
  "mission": "qa|browser-ops|marketing|research",
  "target_url": "http://localhost:5173",
  "objective": "one-sentence goal",
  "success_criteria": [
    "criterion 1",
    "criterion 2"
  ],
  "constraints": {
    "max_steps": 40,
    "max_minutes": 15,
    "allowed_domains": ["localhost"]
  },
  "artifacts_required": [
    "screenshots",
    "summary.json"
  ]
}
```

## Vision In Codex

Codex can reason over screenshots directly in prompts. Use `-i` to attach run artifacts:

```powershell
codex -i runs\<run-id>\iter_1.png "Review this screen and propose a minimal patch for accessibility and layout issues."
```

You can attach multiple images to compare before/after states:

```powershell
codex -i runs\<run-id>\iter_1.png -i runs\<run-id>\iter_2.png "Did the second screenshot fix the original issue? List remaining defects."
```

You can use the same pattern for non-QA missions (for example, messaging consistency or funnel clarity reviews) by attaching mission-specific artifacts.

## QA Iteration Loop

1. Run the target QA pass with `npm run qa -- ...`.
2. Inspect `runs\<run-id>\` artifacts:
- `iter_*.png` screenshots
- `iter_*_judge.txt` model verdicts
3. Ask Codex to patch based on artifacts and your app code.
4. Re-run QA and compare new artifacts to confirm improvements.
5. Repeat until the judge returns a stable pass and manual spot checks agree.

SweepWeave pValue probe:

```powershell
npm run qa:probe:sweepweave
```

This launches `sweepweave-ts`, loads the current diplomacy pValue storyworld set, runs a Rehearsal-tab probe, and writes a JSON report under `runs/` with reachability and console-error findings.

## Artifacts

By default, run output is written under `runs/`. For large or long test sessions, point `PM_RUNS_DIR` to a larger disk location.

Mission runs write:
- `01-<module>.png`
- `summary.json` (machine-parseable checks/metrics/errors)

Recommended run report schema:

```json
{
  "run_id": "string",
  "mission": "qa|browser-ops|marketing|research",
  "target": "string",
  "started_at": "iso8601",
  "ended_at": "iso8601",
  "checks": [
    {"name": "check_name", "status": "pass|fail|warn", "evidence": ["path-or-note"]}
  ],
  "metrics": {
    "errors": 0,
    "warnings": 0
  },
  "next_actions": ["short list"]
}
```

## Quality Gates

- `gate:determinism`: same mission config should yield structurally similar outputs across reruns.
- `gate:evidence`: every `fail` and `warn` must have screenshot/log evidence.
- `gate:bounded`: missions must have explicit step/time limits.
- `gate:cleanup`: browser and dev-server processes must be terminated after completion.
- `gate:reviewability`: summary output must be machine-parseable JSON.

## Failure Recovery

If a run hangs or is interrupted:
1. Keep existing artifacts; do not overwrite.
2. Record interruption reason in a small note file in the run folder.
3. Restart with tighter bounds (`max_steps`, `max_minutes`) and narrower scope.
4. Compare only like-for-like runs (same mission spec).

## Guardrails

- Respect target terms of use, robots rules, and legal boundaries.
- Use conservative request rates and avoid abusive or deceptive automation.
- Keep logs/screenshots scoped to task needs and avoid collecting sensitive data unnecessarily.
