# PuppetMaster

PuppetMaster is a Playwright + OpenAI QA harness for web apps. It runs browser interactions, captures screenshots, sends them to a vision-capable model through the Responses API, and writes artifacts for fast fix/verify loops.

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

## Vision In Codex

Codex can reason over screenshots directly in prompts. Use `-i` to attach run artifacts:

```powershell
codex -i runs\<run-id>\iter_1.png "Review this screen and propose a minimal patch for accessibility and layout issues."
```

You can attach multiple images to compare before/after states:

```powershell
codex -i runs\<run-id>\iter_1.png -i runs\<run-id>\iter_2.png "Did the second screenshot fix the original issue? List remaining defects."
```

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
