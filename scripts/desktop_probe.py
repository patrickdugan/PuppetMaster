import argparse
import json
import os
import sys
import time


def main():
    parser = argparse.ArgumentParser(description="Desktop UI probe via pywinauto")
    parser.add_argument("--app", default="", help="Path to executable")
    parser.add_argument("--app-args", default="", help="Arguments to pass to executable")
    parser.add_argument("--backend", default="uia", choices=["uia", "win32"])
    parser.add_argument("--window-title", default="", help="Regex for window title")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--max-controls", type=int, default=120)
    parser.add_argument("--timeout-ms", type=int, default=20000)
    parser.add_argument("--settle-ms", type=int, default=600)
    parser.add_argument("--close", action="store_true", help="Close app after capture")
    parser.add_argument("--actions-json", default="", help="Path to JSON actions")
    parser.add_argument("--reuse", action="store_true", help="Reuse existing app/window if found")
    parser.add_argument("--attach-only", action="store_true", help="Attach to an existing window only; never launch app")
    args = parser.parse_args()

    try:
        from pywinauto import Application
    except Exception as exc:
        print(f"ERROR: pywinauto not available: {exc}", file=sys.stderr)
        sys.exit(2)

    os.makedirs(args.out_dir, exist_ok=True)
    cmd = ""
    if args.app:
        cmd = f"\"{args.app}\""
        if args.app_args:
            cmd = f"{cmd} {args.app_args}"

    app = Application(backend=args.backend)
    window = None

    if args.reuse and args.app:
        try:
            app = app.connect(path=args.app)
        except Exception:
            app = Application(backend=args.backend)

    if window is None:
        if args.reuse:
            try:
                if args.window_title:
                    window = app.window(title_re=args.window_title)
                else:
                    window = app.top_window()
                if not (window.exists() and window.is_visible()):
                    window = None
            except Exception:
                window = None

    if window is None and args.attach_only:
        try:
            from pywinauto import Desktop
            desktop = Desktop(backend=args.backend)
            if args.window_title:
                window = desktop.window(title_re=args.window_title)
            else:
                window = desktop.top_window()
            if window.exists() and window.is_visible():
                app = Application(backend=args.backend).connect(handle=window.handle)
            else:
                window = None
        except Exception:
            window = None

    if window is None and not args.attach_only:
        app = Application(backend=args.backend)
        app = app.start(cmd)

    deadline = time.time() + (args.timeout_ms / 1000.0)
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

    actions = []
    if args.actions_json and os.path.exists(args.actions_json):
        try:
            with open(args.actions_json, "r", encoding="utf-8") as f:
                payload = json.load(f)
                actions = payload.get("actions", []) if isinstance(payload, dict) else []
        except Exception:
            actions = []

    rect = window.rectangle()
    descendants = []
    try:
        descendants = window.descendants()
    except Exception:
        descendants = []

    def find_control(action):
        target_id = action.get("automation_id") or ""
        target_name = action.get("name") or ""
        target_type = action.get("control_type") or ""
        index = action.get("index", 0)
        matches = []
        for control in descendants:
            info = control.element_info
            if target_id and info.automation_id != target_id:
                continue
            if target_name and info.name != target_name:
                continue
            if target_type and getattr(info, "control_type", None) != target_type:
                continue
            matches.append(control)
        if not matches:
            return None
        try:
            idx = int(index)
        except Exception:
            idx = 0
        if idx < 0 or idx >= len(matches):
            idx = 0
        return matches[idx]

    for action in actions:
        if not isinstance(action, dict):
            continue
        action_type = action.get("type")
        if action_type == "click":
            try:
                x = int(action.get("x", 0))
                y = int(action.get("y", 0))
            except Exception:
                x = 0
                y = 0
            try:
                window.click_input(coords=(x, y))
            except Exception:
                try:
                    abs_x = rect.left + x
                    abs_y = rect.top + y
                    window.click_input(coords=(abs_x, abs_y))
                except Exception:
                    pass
        elif action_type == "click_control":
            control = find_control(action)
            if control is not None:
                try:
                    control.click_input()
                except Exception:
                    try:
                        control.set_focus()
                        control.click_input()
                    except Exception:
                        pass
        elif action_type == "type_text":
            text = action.get("text", "")
            if text:
                try:
                    from pywinauto.keyboard import send_keys
                    send_keys(str(text), with_spaces=True)
                except Exception:
                    pass
        elif action_type == "keypress":
            keys = action.get("keys", "")
            if keys:
                try:
                    from pywinauto.keyboard import send_keys
                    send_keys(str(keys))
                except Exception:
                    pass

        delay_ms = action.get("delay_ms", 0)
        if isinstance(delay_ms, (int, float)) and delay_ms > 0:
            time.sleep(delay_ms / 1000.0)

    screenshot_path = os.path.join(args.out_dir, "desktop_1.png")
    try:
        image = window.capture_as_image()
        image.save(screenshot_path)
    except Exception as exc:
        print(f"ERROR: screenshot failed: {exc}", file=sys.stderr)
        sys.exit(4)

    controls = []

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
        "attach_only": args.attach_only,
        "backend": args.backend,
        "window_title": window.window_text(),
        "window_rect": {
            "left": rect.left,
            "top": rect.top,
            "right": rect.right,
            "bottom": rect.bottom,
        },
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
