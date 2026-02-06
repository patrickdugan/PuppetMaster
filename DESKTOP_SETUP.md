# Desktop Automation Setup

This repo supports native Windows desktop probes via a Python sidecar.

## Requirements
- Python 3.9+
- Windows UI Automation dependencies:

```powershell
pip install pywinauto pillow pywin32
```

Optional: point PuppetMaster at a specific Python:

```powershell
$env:PM_PYTHON = "C:\path\to\python.exe"
```

## Quick Probe

```powershell
npm run desktop:probe -- --app "C:\path\to\App.exe" --window-title "My App"
```

Optional judge:

```powershell
npm run desktop:probe -- --app "C:\path\to\App.exe" --window-title "My App" --judge
```

## Desktop Mission (summary.json)

```powershell
npm run desktop:mission -- --app "C:\path\to\App.exe" --window-title "My App" --max-steps 3 --max-minutes 5
```

## Desktop Loop (prompted)

```powershell
npm run desktop:loop -- --app "C:\path\to\App.exe" --prompt "Describe the goal" --project "C:\path\to\repo" --framework godot --reuse
```
