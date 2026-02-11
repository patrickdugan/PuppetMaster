---
name: puppetmaster-ops
description: Operate PuppetMaster for QA, growth research, Telegram distribution, and Android bootstrap automation. Use for running reproducible web/desktop/mobile capture loops and turning runs into actionable outreach/reporting artifacts.
---

# PuppetMaster Ops

## Core Commands

- QA loop:
  - `npm run qa -- --target "<path>" --mode static|vite|webpack --url <url>`
- X research:
  - `npm run research:x-leads -- ...`
  - `npm run research:x-tradelayer -- ...`
  - `npm run research:x-vip-list -- ...`
- Desktop:
  - `npm run desktop:probe -- ...`
  - `npm run desktop:mission -- ...`
  - `npm run desktop:loop -- ...`

## New: Telegram Agent

- Send run summary:
  - `npm run agent:telegram -- --mode report --run-dir "<runs\\vip-list-...>"`
- Send contact-first queue:
  - `npm run agent:telegram -- --mode queue --run-dir "<runs\\vip-list-...>"`
- Founder daily checklist:
  - `npm run agent:telegram -- --mode founder-daily --founder-exo "C:\\projects\\CryptoCOO\\founderExo.md"`
- Watch mode:
  - `npm run agent:telegram -- --mode watch --runs-root "<runs-path>" --interval-sec 300`

Required env for send:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Dry-run:
- Add `--dry-run true` to print message instead of sending.

## New: Scheduled Telegram Task (Windows)

- Create daily task:
  - `npm run agent:telegram:schedule -- -Mode founder-daily -TaskName "PuppetMasterTelegramFounderDaily" -Time "09:00"`
- Dry-run setup:
  - `npm run agent:telegram:schedule -- -Mode founder-daily -DryRun`

## New: Android Agent Bootstrap

- Dry run:
  - `npm run agent:android -- --dry-run true`
- Capture from connected device/emulator:
  - `npm run agent:android -- --iterations 3 --interval-sec 5`
- Target serial and app:
  - `npm run agent:android -- --serial emulator-5554 --app-id org.telegram.messenger --activity org.telegram.ui.LaunchActivity`
- Start emulator AVD:
  - `npm run agent:android -- --start-emulator Pixel_7_API_34 --wait-sec 120`

Artifacts:
- `runs/android-agent-<ts>/run.json`
- `runs/android-agent-<ts>/summary.json`
- `runs/android-agent-<ts>/shots/*.png`
- `runs/android-agent-<ts>/ui/*.xml`

## Run Hygiene

- Keep each run folder immutable after generation.
- Prefer queue/report messages generated from artifacts, not ad hoc manual summaries.
- Use dry-run for first execution of new commands.

