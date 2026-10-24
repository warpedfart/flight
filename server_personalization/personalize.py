#!/usr/bin/env python3
"""Server personalization: gives this server its own name and logo.

    python3 server_personalization/personalize.py            # the window
    python3 server_personalization/personalize.py --cli --name "My Server" [--slug my-server]
                                                  [--logo path/to/logo.png] [--dry-run]

It replaces the whole word "Flight" (or whatever name is currently in use) in the
server's player-facing text, and the logo images in public/. The name currently in
use is remembered in current.json beside this script, so running it again renames
from the last name to the next. Only the files in FILES are touched: game data,
decompiled code, the deploy scripts (service and variable names) and the database
are left alone. Restart the server afterwards for changes in lib/ to take effect;
public/ pages are read from disk on every request.
"""

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_REPO = HERE.parent
STATE = HERE / "current.json"
BACKUP = HERE / "backup"

# files that carry the server's name as text
FILES = [
    "config.js", "CONTRIBUTING.md",
    "lib/defpacks.js", "lib/discordbot.js", "lib/discord.js", "lib/ecards.js", "lib/manage.js",
    "lib/modpanel.js", "lib/totp.js", "lib/world.js",
    "public/account.html", "public/admin.html", "public/captcha.html", "public/dashboard.html",
    "public/download.html", "public/home.html", "public/mod.html", "public/privacy.html",
    "public/register.html", "public/terms.html",
    "test/features.js", "test/smoke.js",
]

# the name in its lowercase "slug" form: file names, the Discord slash command.
# {slug} stands for the slug now in use.
SLUG_RULES = {
    "lib/discordbot.js": [
        (r"(?<=/){slug}(?= )", "slash command text"),
        (r'setName\("{slug}"\)', "slash command name"),
        (r'commandName === "{slug}"', "slash command handler"),
    ],
    "lib/manage.js": [(r"{slug}(?=-data-)", "data export file name")],
    "public/account.html": [(r"{slug}(?=-data-)", "data export file name")],
}

LOGOS = {"logo.png": (600, 488), "logo-square.png": (512, 512)}  # largest size each is drawn at

# characters that would need escaping in HTML or inside a JavaScript string
NAME_OK = re.compile(r"^[^\W_](?:[\w .\-]{0,30}[^\W_])?$", re.UNICODE)
SLUG_OK = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")


def slugify(name):
    return re.sub(r"[^a-z0-9_-]", "", re.sub(r"\s+", "-", name.strip().lower()))


def load_state():
    try:
        data = json.loads(STATE.read_text("utf-8"))
        return data["name"], data["slug"]
    except (OSError, ValueError, KeyError):
        return "Flight", "flight"


def save_state(name, slug):
    STATE.write_text(json.dumps({"name": name, "slug": slug}, indent=2) + "\n", "utf-8")


def check_names(old, new, old_slug, new_slug):
    if not old or not NAME_OK.match(new) or "_" in new[:1]:
        raise ValueError("The new name must be 1-32 characters: letters, digits, spaces, dots and hyphens only, "
                         "starting and ending with a letter or digit.")
    if not SLUG_OK.match(new_slug):
        raise ValueError("The short name (for the Discord command and file names) must be lowercase letters, digits, "
                         "hyphens or underscores, up to 32 characters.")
    if old == new and old_slug == new_slug:
        raise ValueError("The new name is the same as the current one.")


def plan(repo, old, new, old_slug, new_slug):
    """Returns ([(relative path, new text, [(what, count)])], [missing paths])."""
    word = re.compile(r"(?<![\w])" + re.escape(old) + r"(?![\w])")
    changes, missing = [], []
    for rel in FILES:
        path = repo / rel
        if not path.is_file():
            missing.append(rel)
            continue
        text = path.read_bytes().decode("utf-8")
        counts = []
        text, n = word.subn(lambda _m: new, text)
        if n:
            counts.append(("name", n))
        if old_slug != new_slug:
            for pattern, what in SLUG_RULES.get(rel, []):
                text, n = re.subn(pattern.replace("{slug}", re.escape(old_slug)),
                                  lambda m: m.group(0).replace(old_slug, new_slug), text)
                if n:
                    counts.append((what, n))
        if counts:
            changes.append((rel, text, counts))
    return changes, missing


def make_logos(repo, source, dry_run=False):
    """Writes public/logo.png and public/logo-square.png from one picture; returns what it did."""
    try:
        from PIL import Image
    except ImportError:
        raise RuntimeError("Replacing the logo needs Pillow:  pip install pillow")
    image = Image.open(source).convert("RGBA")
    report = []
    for name, (width, height) in LOGOS.items():
        target = repo / "public" / name
        if name == "logo.png":
            out = image.copy()
            out.thumbnail((width, height), Image.LANCZOS)
        else:
            fitted = image.copy()
            fitted.thumbnail((width, height), Image.LANCZOS)
            out = Image.new("RGBA", (width, height), (0, 0, 0, 0))
            out.paste(fitted, ((width - fitted.width) // 2, (height - fitted.height) // 2), fitted)
        report.append(f"public/{name}: {out.width}x{out.height}")
        if not dry_run:
            BACKUP.mkdir(exist_ok=True)
            if target.exists() and not (BACKUP / name).exists():
                shutil.copy2(target, BACKUP / name)  # the first original is kept, never overwritten
            out.save(target, "PNG", optimize=True)
    return report


def restore_logos(repo):
    done = []
    for name in LOGOS:
        if (BACKUP / name).exists():
            shutil.copy2(BACKUP / name, repo / "public" / name)
            done.append(f"public/{name}")
    return done


def run(repo, new, new_slug, logo=None, dry_run=False, say=print):
    repo = Path(repo).resolve()
    if not (repo / "server.js").is_file():
        raise ValueError(f"{repo} does not look like the server's folder (no server.js).")
    old, old_slug = load_state()
    new = new.strip()
    new_slug = new_slug.strip() or slugify(new)
    if new:
        try:
            check_names(old, new, old_slug, new_slug)
        except ValueError:
            if not logo:
                raise
            new, new_slug = old, old_slug  # logo only
    elif not logo:
        raise ValueError("Give a new name, a logo, or both.")
    changes, missing = plan(repo, old, new, old_slug, new_slug) if (new, new_slug) != (old, old_slug) else ([], [])
    total = 0
    for rel, text, counts in changes:
        say(f"{'would change' if dry_run else 'changed'} {rel}: " + ", ".join(f"{n} x {what}" for what, n in counts))
        total += sum(n for _, n in counts)
        if not dry_run:
            (repo / rel).write_bytes(text.encode("utf-8"))
    for rel in missing:
        say(f"skipped {rel}: not found")
    if logo:
        for line in make_logos(repo, logo, dry_run):
            say(f"{'would write' if dry_run else 'wrote'} {line}")
    if (new, new_slug) != (old, old_slug) and not dry_run:
        save_state(new, new_slug)
    say(f"{'Preview' if dry_run else 'Done'}: {total} replacement(s) in {len(changes)} file(s)"
        + (f", name {old!r} -> {new!r}" if (new, new_slug) != (old, old_slug) else "") + ".")
    if not dry_run:
        say("Restart the server for changes in lib/ to take effect (sudo systemctl restart <service>).")


def gui():
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    root = tk.Tk()
    root.title("Server personalization")
    root.minsize(640, 560)
    frame = ttk.Frame(root, padding=14)
    frame.pack(fill="both", expand=True)
    frame.columnconfigure(1, weight=1)

    old, old_slug = load_state()
    repo = tk.StringVar(value=str(DEFAULT_REPO))
    name = tk.StringVar()
    slug = tk.StringVar()
    logo = tk.StringVar()
    slug_touched = {"v": False}

    def row(r, label, var, button=None, hint=None):
        ttk.Label(frame, text=label).grid(row=r, column=0, sticky="w", pady=4, padx=(0, 10))
        entry = ttk.Entry(frame, textvariable=var)
        entry.grid(row=r, column=1, sticky="ew", pady=4)
        if button:
            button.grid(row=r, column=2, padx=(8, 0))
        if hint:
            ttk.Label(frame, text=hint, foreground="#666").grid(row=r + 1, column=1, sticky="w")
        return entry

    ttk.Label(frame, text=f"Current name: {old}    (short name: {old_slug})", font=("", 11, "bold")).grid(
        row=0, column=0, columnspan=3, sticky="w", pady=(0, 8))
    row(1, "Server folder", repo, ttk.Button(frame, text="Browse...",
        command=lambda: repo.set(filedialog.askdirectory(initialdir=repo.get()) or repo.get())))
    row(2, "New server name", name, hint="Letters, digits, spaces, dots and hyphens. Replaces every \"" + old + "\".")
    slug_entry = row(4, "Short name", slug, hint="Lowercase; used for the Discord command and download file names.")

    def on_name(*_):
        if not slug_touched["v"]:
            slug.set(slugify(name.get()))
    name.trace_add("write", on_name)
    slug_entry.bind("<Key>", lambda _e: slug_touched.update(v=True))

    row(6, "Logo picture (optional)", logo, ttk.Button(frame, text="Choose...",
        command=lambda: (logo.set(filedialog.askopenfilename(title="Logo",
            filetypes=[("Pictures", "*.png *.jpg *.jpeg *.webp *.gif"), ("All files", "*.*")]) or logo.get()), show_preview())),
        hint="One picture; both public/logo.png and public/logo-square.png are made from it (kept transparent).")

    preview = ttk.Label(frame)
    preview.grid(row=8, column=1, sticky="w", pady=4)
    refs = []

    def show_preview():
        refs.clear()
        preview.configure(image="", text="")
        if not logo.get():
            return
        try:
            from PIL import Image, ImageTk
            image = Image.open(logo.get()).convert("RGBA")
            image.thumbnail((120, 120))
            photo = ImageTk.PhotoImage(image)
            refs.append(photo)
            preview.configure(image=photo)
        except Exception as error:
            preview.configure(text=f"Cannot show this picture: {error}")

    output = tk.Text(frame, height=14, wrap="word", state="disabled")
    output.grid(row=10, column=0, columnspan=3, sticky="nsew", pady=(10, 0))
    frame.rowconfigure(10, weight=1)

    def say(text):
        output.configure(state="normal")
        output.insert("end", text + "\n")
        output.see("end")
        output.configure(state="disabled")
        root.update_idletasks()

    def go(dry):
        output.configure(state="normal")
        output.delete("1.0", "end")
        output.configure(state="disabled")
        try:
            if not dry and not messagebox.askyesno("Apply", "Change the files now?\n(They are tracked by git, so "
                                                   "`git checkout .` undoes it before you commit.)"):
                return
            run(repo.get(), name.get(), slug.get(), logo.get() or None, dry, say)
        except Exception as error:
            say(f"Error: {error}")
            messagebox.showerror("Could not continue", str(error))

    buttons = ttk.Frame(frame)
    buttons.grid(row=9, column=0, columnspan=3, sticky="e", pady=(10, 0))
    ttk.Button(buttons, text="Restore original logo", command=lambda: say(
        "Restored: " + (", ".join(restore_logos(Path(repo.get()))) or "nothing (no backup yet)"))).pack(side="left", padx=4)
    ttk.Button(buttons, text="Preview changes", command=lambda: go(True)).pack(side="left", padx=4)
    ttk.Button(buttons, text="Apply", command=lambda: go(False)).pack(side="left", padx=4)
    root.mainloop()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cli", action="store_true", help="no window: use the options below")
    parser.add_argument("--repo", default=str(DEFAULT_REPO))
    parser.add_argument("--name", default="")
    parser.add_argument("--slug", default="")
    parser.add_argument("--logo")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not args.cli:
        gui()
        return
    try:
        run(args.repo, args.name, args.slug, args.logo, args.dry_run)
    except (ValueError, RuntimeError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
