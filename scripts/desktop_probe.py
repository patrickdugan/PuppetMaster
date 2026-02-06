import argparse
import json
import os
import sys
import time


def main():
    parser = argparse.ArgumentParser(description="Desktop UI probe via pywinauto")
    parser.add_argument("--app", required=True, help="Path to executable")
    parser.add_argument("--app-args", default="", help="Arguments to pass to executable")
    parser.add_argument("--backend", default="uia", choices=["uia", "win32"])
    parser.add_argument("--window-title", default="", help="Regex for window title")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--max-controls", type=int, default=120)
    parser.add_argument("--timeout-ms", type=int, default=20000)
    parser.add_argument("--settle-ms", type=int, default=600)
    parser.add_argument("--close", action="store_true", help="Close app after capture")
    args = parser.parse_args()

    try:
        from pywinauto import Application
    except Exception as exc:
        print(f"ERROR: pywinauto not available: {exc}", file=sys.stderr)
        sys.exit(2)

    os.makedirs(args.out_dir, exist_ok=True)
    cmd = f"\"{args.app}\""
    if args.app_args:
        cmd = f"{cmd} {args.app_args}"

    app = Application(backend=args.backend)
    app = app.start(cmd)

    deadline = time.time() + (args.timeout_ms / 1000.0)
    window = None
    while time.time() < deadline:
        try:
            if args.window_title:
                window = app.window(title_re=args.window_title)
            else:
                window = app.top_window()
            if window.exists() and window.is_visible():
                break
        except Exception:
            window = None
        time.sleep(0.25)

    if window is None or not window.exists():
        print("ERROR: window not found", file=sys.stderr)
        sys.exit(3)

    try:
        window.set_focus()
    except Exception:
        pass

    if args.settle_ms > 0:
        time.sleep(args.settle_ms / 1000.0)

    screenshot_path = os.path.join(args.out_dir, "desktop_1.png")
    try:
        image = window.capture_as_image()
        image.save(screenshot_path)
    except Exception as exc:
        print(f"ERROR: screenshot failed: {exc}", file=sys.stderr)
        sys.exit(4)

    controls = []
    try:
        descendants = window.descendants()
    except Exception:
        descendants = []

    for control in descendants[: args.max_controls]:
        info = control.element_info
        rect = info.rectangle
        controls.append({
            "name": info.name,
            "control_type": getattr(info, "control_type", None),
            "class_name": info.class_name,
            "automation_id": info.automation_id,
            "enabled": control.is_enabled(),
            "visible": control.is_visible(),
            "rect": {
                "left": rect.left,
                "top": rect.top,
                "right": rect.right,
                "bottom": rect.bottom,
            },
        })

    payload = {
        "app": args.app,
        "backend": args.backend,
        "window_title": window.window_text(),
        "control_count": len(descendants),
        "controls": controls,
        "screenshot": screenshot_path,
    }

    json_path = os.path.join(args.out_dir, "desktop_probe.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    if args.close:
        try:
            app.kill()
        except Exception:
            pass

    print(json_path)


if __name__ == "__main__":
    main()
