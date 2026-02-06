# AGENTS.md

## Purpose
PuppetMaster is a mission-driven browser automation platform using Playwright + OpenAI Responses vision.
Agents should run deterministic, reproducible browser missions, produce actionable artifacts, and avoid brittle one-off manual flows.

## Mission Taxonomy
- `qa`: UI regressions, acceptance checks, exploratory defect detection.
- `browser-ops`: repeatable interaction sequences and browser task execution.
- `marketing`: page messaging, CTA visibility, and funnel/friction audits.
- `research`: structured capture of observations and evidence across pages.

## Default Workflow
1. Install dependencies and browsers.
2. Select a mission and run the relevant script (`npm run qa -- ...` or `npm run qa:probe:sweepweave` today).
3. Inspect artifacts in `runs/<run-id>/`.
4. Propose or apply minimal fixes.
5. Re-run and compare before/after artifacts.

## Canonical Commands
- Setup:
```powershell
npm install
npm run install:browsers
```
- Static target:
```powershell
npm run qa -- --target "C:\path\to\index.html" --mode static --url http://localhost:4173
```
- Vite target:
```powershell
npm run qa -- --target "C:\path\to\app\package.json" --mode vite --url http://localhost:5173 --cmd "npm run dev"
```
- Webpack target:
```powershell
npm run qa -- --target "C:\path\to\app\package.json" --mode webpack --url http://localhost:8080 --cmd "npm run start"
```
- SweepWeave pValue probe:
```powershell
npm run qa:probe:sweepweave
```

## Required Environment
- `OPENAI_API_KEY` must be set.
- Optional:
- `OPENAI_MODEL` (default in code: `gpt-5-mini`)
- `OPENAI_API_URL` (default: Responses API)
- `PM_RUNS_DIR` (override artifact directory for large runs)

## Artifact Contract
- Preserve all run artifacts; do not delete prior runs unless asked.
- For regular QA runs, expect:
- `iter_*.png`
- `iter_*_judge.txt`
- For SweepWeave probe, expect:
- `sweepweave-pvalue-probe-*.json` with `metrics`, `rehearsal`, and console/page errors.

## Agent Rules
- Keep prompts short and operational.
- Prefer deterministic checks over subjective visual guesses.
- Make mission goals explicit in run notes (what is being measured and why).
- Avoid hardcoding local ports in automation unless discovery/fallback logic exists.
- If multiple matching UI controls exist, use scoped selectors (for example toolbar-scoped buttons).
- On Windows, ensure child processes are fully terminated after runs.

## Crash And OOM Resilience
- Favor short bounded runs over very large batch runs.
- Reuse existing scripts instead of ad-hoc interactive workflows.
- Keep session metadata local per repo when possible (`codex-chat-sessions` pattern).
- If a run is interrupted, resume from artifact inspection before re-running full suites.

## Editing Guidance
- Keep changes minimal and focused.
- Update `README.md` when introducing new user-facing commands or env vars.
- Add scripts under `scripts/` and expose stable entrypoints in `package.json`.
- Do not commit generated run artifacts unless explicitly requested.
- Treat new mission scripts as first-class tooling, not ad-hoc one-offs.

## Key Files
- `src/qa.js`: main QA loop
- `src/openai.js`: Responses vision call
- `scripts/probe-sweepweave-pvalues.mjs`: pValue storyworld probe
- `master_prompt.md`: primary judge prompt
- `runs/`: runtime outputs
