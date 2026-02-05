# PuppetMaster

PuppetMaster is a QA harness for UI projects. It launches a sandboxed browser, explores DOM interactions, captures screenshots, and uses GPT-5-mini vision to judge whether the UI is "good" per `master_prompt.md`.

## Quick Start

1) Install dependencies and browser binaries:

```
npm install
npm run install:browsers
```

2) Set your OpenAI key:

```
set OPENAI_API_KEY=YOUR_KEY
```

3) Build target projects before QA

- This tool expects a build artifact to exist for the target.
- It is not a Next.js-specific workflow.
- For many Angular/Webpack apps, use Node 16 and run:

```
nvm use 16
npm run build
```

4) Run QA against a static HTML folder:

```
npm run qa -- --target C:\path\to\site --mode static --url http://localhost:4173
```

5) Run QA against a Vite app:

```
npm run qa -- --target C:\path\to\vite\app --mode vite --url http://localhost:5173 --cmd "npm run dev"
```

6) Run QA against a webpack app (example):

```
npm run qa -- --target C:\projects\TL-Web\TL-Web\packages\web-ui --mode webpack --url http://localhost:8080 --cmd "npm run start"
```

## How It Works
- Launches a private Playwright Chromium context.
- Crawls a bounded set of interactive elements and runs action sequences.
- Captures screenshots + a DOM snapshot.
- Sends images to GPT-5-mini with `master_prompt.md` and records PASS/FAIL.
- Repeats until PASS or iteration cap.

## Prompting And Model Use
- This repo uses GPT-5-mini for vision-only requests.
- Respect the 1M daily token limit: keep prompts concise, avoid verbose logs, and minimize iterations.
- If you are unsure about token usage, ping the user before running large batches.

## Prompt Versioning
- `master_prompt.md` is the latest active prompt used by the harness.
- Versioned snapshots live alongside it (for example, `master_prompt.v3.md`).
- When updating prompts, update `master_prompt.md` and add a new versioned file.

## Key Files
- `src/qa.js` - main harness
- `src/openai.js` - GPT-5-mini vision call + parsing
- `src/staticServer.js` - static HTML server
- `master_prompt.md` - success criteria (latest)

## Notes
- `--mode webpack` uses the same `--cmd` + `--url` strategy as Vite.
- Adjust `--iterations` and `--depth` to expand coverage.
- Artifacts are saved in `runs/<id>/`.