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
$env:PM_RUNS_DIR = "D:\\PuppetMasterRuns"
```

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

## Mission Types

- `qa`: UI regression checks, exploratory interaction, bug verification.
- `browser-ops`: scripted browser operations and stateful interaction tasks.
- `marketing`: landing page/funnel checks, messaging and CTA visibility audits.
- `research`: structured page exploration with evidence capture and traceable outputs.

Current built-ins:
- `npm run qa`
- `npm run qa:probe:sweepweave`

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
