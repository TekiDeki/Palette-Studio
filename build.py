#!/usr/bin/env python3
"""Palette Studio build script - deterministic single-file build.

Reads src/ and writes one self-contained index.html. Same inputs, same bytes:
no timestamps, no random values, no environment data.

    python3 build.py

Serbian Cyrillic is not translated: it is generated here by transliterating
the Serbian Latin table, which keeps the four locales structurally identical.

SPDX-License-Identifier: Apache-2.0
Copyright 2026 Kristian Mario Miskovic (TekiDeki)
"""
import hashlib
import io
import json
import os
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src"
MIN_KEYS = 100
FORBIDDEN = {"\u2014": "em dash (U+2014)", "\u2013": "en dash (U+2013)", "\ufeff": "byte order mark"}
PLACEHOLDER_RE = re.compile(r"\{([a-z0-9_]+)\}")
SOURCE_LOCALES = ("ro", "en", "sr-latn")
MARKERS = ("/*CSS*/", "/*COLOR*/", "/*PALETTE*/", "/*JS*/")

DIGRAPHS = (
    ("DŽ", "Џ"), ("Dž", "Џ"), ("dž", "џ"),
    ("LJ", "Љ"), ("Lj", "Љ"), ("lj", "љ"),
    ("NJ", "Њ"), ("Nj", "Њ"), ("nj", "њ"),
)

SINGLES = {
    "a": "а", "b": "б", "v": "в", "g": "г", "d": "д", "đ": "ђ", "e": "е",
    "ž": "ж", "z": "з", "i": "и", "j": "ј", "k": "к", "l": "л", "m": "м",
    "n": "н", "o": "о", "p": "п", "r": "р", "s": "с", "t": "т", "ć": "ћ",
    "u": "у", "f": "ф", "h": "х", "c": "ц", "č": "ч", "š": "ш",
    "ă": "а", "â": "а", "î": "и", "ș": "с", "ț": "т",
}


def to_cyrillic(text):
    """Deterministic Serbian Latin to Serbian Cyrillic transliteration."""
    out = []
    index = 0
    while index < len(text):
        matched = False
        for latin, cyrillic in DIGRAPHS:
            if text.startswith(latin, index):
                out.append(cyrillic)
                index += len(latin)
                matched = True
                break
        if matched:
            continue
        char = text[index]
        converted = SINGLES.get(char.lower())
        if converted is None:
            out.append(char)
        elif char.isupper():
            out.append(converted.upper())
        else:
            out.append(converted)
        index += 1
    return "".join(out)


def read(path):
    with io.open(str(path), encoding="utf-8", newline="") as handle:
        return handle.read()


def check_text(label, content):
    problems = []
    if content.startswith("\ufeff"):
        problems.append("byte order mark")
    for char, name in FORBIDDEN.items():
        if char in content:
            problems.append("%s x%d" % (name, content.count(char)))
    if problems:
        raise SystemExit("%s: %s" % (label, ", ".join(problems)))


def load_locales():
    raw = read(SRC / "i18n" / "locales.json")
    check_text("src/i18n/locales.json", raw)
    locales = json.loads(raw)
    if tuple(locales) != SOURCE_LOCALES:
        raise SystemExit(
            "locales.json must contain exactly %s, sr-cyrl is generated (found %s)"
            % (", ".join(SOURCE_LOCALES), ", ".join(locales))
        )
    reference = set(locales["ro"])
    if len(reference) < MIN_KEYS:
        raise SystemExit("locales: suspiciously few keys (%d)" % len(reference))
    for name in ("en", "sr-latn"):
        missing = sorted(reference - set(locales[name]))
        extra = sorted(set(locales[name]) - reference)
        if missing or extra:
            raise SystemExit("locales: %s differs (missing=%s extra=%s)" % (name, missing, extra))

    placeholders = {}
    for name, block in locales.items():
        for key, value in block.items():
            placeholders.setdefault(key, {})[name] = sorted(set(PLACEHOLDER_RE.findall(value)))
    for key, per_locale in placeholders.items():
        variants = {tuple(value) for value in per_locale.values()}
        if len(variants) != 1:
            raise SystemExit("locales: %s placeholders differ: %s" % (key, per_locale))

    # Positive check: authentic Serbian Latin uses all five special letters.
    # Writing "rezim" instead of "rezim" with a caron transliterates cleanly
    # into the wrong Cyrillic letter, so a missing letter is a spelling bug.
    for letter in ("\u0111", "\u0107", "\u010d", "\u0161", "\u017e"):
        if not any(letter in value.lower() for value in locales["sr-latn"].values()):
            raise SystemExit("locales: sr-latn never uses %r, check the Serbian spelling" % letter)

    locales["sr-cyrl"] = {key: to_cyrillic(value) for key, value in locales["sr-latn"].items()}
    for key, value in locales["sr-cyrl"].items():
        leftovers = [char for char in "đćčšž" if char in value.lower()]
        if leftovers:
            raise SystemExit("locales: sr-cyrl/%s still contains %s" % (key, leftovers))
    print("i18n    : %d locales x %d keys (sr-cyrl transliterated)" % (len(locales), len(reference)))
    return locales


def main():
    missing = [str(path) for path in (SRC / "template.html", SRC / "styles.css", SRC / "color.js", SRC / "palette.js", SRC / "app.js", SRC / "i18n" / "locales.json") if not path.is_file()]
    if missing:
        raise SystemExit("missing sources: %s" % ", ".join(missing))

    template = read(SRC / "template.html")
    styles = read(SRC / "styles.css")
    color = read(SRC / "color.js")
    palette = read(SRC / "palette.js")
    app = read(SRC / "app.js")
    check_text("src/template.html", template)
    check_text("src/styles.css", styles)
    check_text("src/color.js", color)
    check_text("src/palette.js", palette)
    check_text("src/app.js", app)

    for label, script in (("color.js", color), ("palette.js", palette), ("app.js", app)):
        if "</script" in script.lower():
            raise SystemExit("%s: unsafe </script sequence" % label)

    locales = load_locales()

    for marker in MARKERS:
        if template.count(marker) != 1:
            raise SystemExit("template: marker %s must appear exactly once, found %d" % (marker, template.count(marker)))

    payload = "window.TD_LOCALES=" + json.dumps(locales, ensure_ascii=False, separators=(",", ":")) + ";\n" + app
    html = (template
            .replace("/*CSS*/", styles.strip("\n"))
            .replace("/*COLOR*/", color.strip("\n"))
            .replace("/*PALETTE*/", palette.strip("\n"))
            .replace("/*JS*/", payload.strip("\n")))

    leftovers = re.findall(r"/\*[A-Z]+\*/", html)
    if leftovers:
        raise SystemExit("template: unreplaced markers %s" % leftovers)
    check_text("index.html", html)
    if not html.endswith("\n"):
        html += "\n"

    target = ROOT / "index.html"
    with io.open(str(target), "w", encoding="utf-8", newline="\n") as handle:
        handle.write(html)

    data = html.encode("utf-8")
    print("built   : %s" % target)
    print("styles  : %6d B" % len(styles.encode("utf-8")))
    print("color   : %6d B" % len(color.encode("utf-8")))
    print("palette : %6d B" % len(palette.encode("utf-8")))
    print("app     : %6d B" % len(app.encode("utf-8")))
    print("output  : %6d B" % len(data))
    print("sha256  : %s" % hashlib.sha256(data).hexdigest())
    return 0


if __name__ == "__main__":
    sys.exit(main())
