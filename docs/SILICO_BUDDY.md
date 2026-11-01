# SilicoBuddy: bounded Firefox Auto-research handoff

SilicoBuddy is a cost-aware research handoff inside PuppetMaster. It asks ChatGPT to prepare a compact experiment design, sends the result to an existing Silico research thread for **plan-only** review, and prepares a short independent ChatGPT critique. It never launches a Silico experiment, changes Auto-accept, or schedules compute.

## Offline first

```powershell
npm run research:silicobuddy -- --task "Test whether 27B quantization preserves task transfer" --max-ru 0.2 --max-gpu-hours 0
npm run test:silicobuddy
```

The default dry run creates `runs/silicobuddy-*/summary.json`, a ChatGPT packet, and a Silico handoff template, without opening a browser or spending tokens.

## Firefox run

This runner uses a **dedicated Playwright-controlled Firefox profile**. It cannot attach to an already-open personal Firefox session using Chrome's debugging protocol. You sign in once inside the dedicated profile. Do not copy browser cookies, session tokens, or profiles into Git.

Confirm the input and reply CSS selectors in your actual Silico Lab UI. Silico's DOM is not an API, and selectors can change. Navigate to an existing Silico research thread, disable Auto-accept, and verify its model, balance, and planning settings.

```powershell
npm install
npx playwright install firefox
npm run research:silicobuddy -- --task-file .\research-question.txt `
  --live --approve-send `
  --chatgpt-url "https://chatgpt.com/" `
  --silico-url "https://<your-lab-host>.silico.ai/<existing-thread>" `
  --silico-composer "<inspected-input-css>" `
  --silico-reply "<inspected-assistant-message-css>" `
  --max-ru 0.2 --max-gpu-hours 0
```

The script opens two Firefox tabs and waits for you to sign in and press Enter at the terminal. With `--approve-send` it makes two chat message submissions: ChatGPT planning, then Silico plan-only review. The compact reply is saved locally. Use `--debrief-send` to send a third message to ChatGPT for a critique, or copy the generated debrief prompt manually.

## Economics and guardrails

- Each prompt has a 5,000-character budget by default. Model outputs are clipped to 6,500 characters, preserving their head and tail. A typical run has at most two remote messages, optionally three.
- The receipt records prompt hashes, character counts, and `chars / 4` estimated tokens. Measured billing and GPU usage stay `null` until supplied from Silico's real cost receipts. This tool does not claim quantified savings.
- `--max-ru` and `--max-gpu-hours` constrain **the requested future plan**. Browser prompt instructions cannot enforce a provider's billing ceiling. Review resource estimates and approve launch separately inside Silico.
- HTTPS origin checks, unique visible composer selectors, and bounded response polling protect against misrouted sends. Interrupted runs have a `blocked` receipt. Inspect the tabs before retrying to prevent duplicate messages.
- Captured text stays in the local `runs/` directory. Do not store credentials, headers, full screenshots, or browser storage in run artifacts. Run one process per Firefox profile.

## Model routing

Codex/PuppetMaster handles deterministic source inspections, code and tests. ChatGPT designs the smallest discriminating experiment. Silico receives the short experimental packet and can produce a plan for human approval. ChatGPT's optional debrief checks scientific validity before the next step. Preserve source identifiers and reported measurements instead of copying whole transcripts between models.

Use a verified first-party integration instead of browser automation if Silico exposes a suitable supported interface in future.

## Cheapest path: Codex first

When Codex or a local script already produced an experiment design, use `--plan-file` to skip the initial ChatGPT request entirely. The runner sends **one** message to Silico, leaving the ChatGPT critique as a local prompt unless `--debrief-send` is enabled.

```powershell
npm run research:silicobuddy -- --task "Measure transfer on held-out evals" --plan-file .\codex-experiment-packet.txt --max-ru 0.2
```

For a live run, combine `--plan-file` with the inspected Firefox selectors and `--live --approve-send` flags. The shortcut saves one model request but does not determine Silico's actual billed RU.
