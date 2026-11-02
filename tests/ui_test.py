#!/usr/bin/env python3
"""Palette Studio - end to end UI test (Playwright + Chromium).

Runs the built index.html over a local HTTP server and drives it the way a
visitor would, on desktop, a touch tablet and a small phone:

    python3 tests/ui_test.py

Checks: load, colour input, WCAG numbers, palette extraction, gradient code,
export switching, persistence after reload, undo, language switching to
Serbian Cyrillic, installation help, mobile touch targets and zero browser errors.

SPDX-License-Identifier: Apache-2.0
Copyright 2026 Kristian Mario Miskovic (TekiDeki)
"""
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
errors = []
checks = [0]


def check(condition, message):
    checks[0] += 1
    if not condition:
        raise AssertionError(message)


class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *_args):
        pass

    def handle_one_request(self, *args, **kwargs):
        # The page asks for the PWA assets that only exist in the repository
        # checkout; a 404 on those is expected and must not abort the test.
        try:
            super().handle_one_request(*args, **kwargs)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def log_error(self, *_args):
        pass

    def handle_error(self, *_args):
        # Silence the traceback ThreadingHTTPServer prints when the browser
        # closes a connection early or asks for an asset outside this checkout.
        pass


def attach(page):
    page.on("pageerror", lambda error: errors.append("page: %s" % error))
    page.on("console", lambda message: errors.append("console: %s" % message.text) if message.type == "error" else None)


def run_desktop(browser, url):
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    attach(page)

    response = page.goto(url, wait_until="networkidle")
    check(response is not None and response.status == 200, "index.html must return 200")

    # Headless Chromium reports en-US, so the app must start in English.
    check(page.locator("html").get_attribute("lang") == "en", "locale detection falls back to en")
    check(page.locator("h1").inner_text() == "The right color, measured properly.", "hero title is translated")
    check(page.locator("#langSelect option[value='sr-cyrl']").inner_text() == "Srpski (ćirilica)",
          "the Cyrillic option keeps its latin label in the english UI")

    # ---------------------------------------------------------- colour input
    check(page.locator("#heroHex").inner_text() == "#2563eb", "the default base color is #2563eb")
    check(page.locator("#fmtRgb").inner_text() == "rgb(37, 99, 235)", "rgb format is correct")
    check(page.locator("#fmtHsl").inner_text() == "hsl(221, 83%, 53%)", "hsl format is correct")
    check(page.locator("#fmtHsv").inner_text() == "hsv(221, 84%, 92%)", "hsv format is correct")
    check(page.locator("#metaContrast").inner_text() == "5.17:1", "the contrast against white is 5.17:1")
    check(page.locator("#fmtName").inner_text() == "azure", "the nearest name for #2563eb is azure")

    page.locator("#hexInput").fill("#101725")
    page.locator("#hexInput").dispatch_event("change")
    check(page.locator("#heroHex").inner_text() == "#101725", "a typed hex becomes the base color")
    check(page.locator("#metaContrast").inner_text() == "17.93:1", "the contrast updates with the color")

    page.locator("#hexInput").fill("not-a-color")
    page.locator("#hexInput").dispatch_event("change")
    check(page.locator("#hexError").is_visible(), "an invalid hex shows an error")
    check("Invalid hex" in page.locator("#hexError").inner_text(), "the error text is translated")
    check(page.locator("#heroHex").inner_text() == "#101725", "an invalid hex does not change the color")

    page.locator("#hexInput").fill("#2563eb")
    page.locator("#hexInput").dispatch_event("change")
    page.locator("#hexError").wait_for(state="hidden")

    # -------------------------------------------------------------- harmonies
    tabs = page.locator("#harmonyTabs button")
    check(tabs.count() == 7, "seven harmony schemes are offered")
    check(page.locator("#harmonyTabs button[data-harmony='triadic']").get_attribute("aria-pressed") == "true",
          "triadic is the default scheme")
    check(page.locator("#harmonySwatches .swatch").count() == 3, "triadic shows three colors")
    page.locator("#harmonyTabs button[data-harmony='complementary']").click()
    check(page.locator("#harmonySwatches .swatch").count() == 2, "complementary shows two colors")
    check(page.locator("#harmonySwatches .swatch").nth(1).locator(".swatch-label").inner_text() == "#ebad25",
          "the complementary of #2563eb is #ebad25")
    check(page.locator("#harmonySwatches .swatch").first.get_attribute("class").find("is-active") >= 0,
          "the base color is marked inside the harmony")
    page.locator("#harmonyTabs button[data-harmony='monochromatic']").click()
    check(page.locator("#harmonySwatches .swatch").count() == 5, "monochromatic shows five colors")

    # ------------------------------------------------------ palette extraction
    page.locator("#demoImageBtn").click()
    page.wait_for_function("() => document.querySelectorAll('#extractedSwatches .swatch').length === 6", timeout=10000)
    check(page.locator("#extractedSwatches .swatch").count() == 6, "the demo image yields six colors")
    check(page.locator("#paletteStatus").inner_text().startswith("6 colors extracted"),
          "the extraction status reports the count")
    shares = [float(text.rstrip("%")) for text in
              page.locator("#extractedSwatches .swatch-meta").all_inner_texts()]
    check(abs(sum(shares) - 100.0) < 0.6, "the shares add up to 100 (got %.1f)" % sum(shares))
    check(shares == sorted(shares, reverse=True), "the palette is sorted by share")

    page.locator("#paletteK").fill("4")
    page.locator("#paletteK").dispatch_event("change")
    page.wait_for_function("() => document.querySelectorAll('#extractedSwatches .swatch').length === 4", timeout=10000)
    check(page.locator("#extractedSwatches .swatch").count() == 4, "the cluster count is applied")

    page.locator("#paletteUseBtn").click()
    check(page.locator("#savedSwatches .swatch").count() == 4, "the palette is saved")
    check(page.locator("#savedEmpty").is_hidden(), "the empty state disappears")

    # ---------------------------------------------------------------- gradient
    gradient_css = page.locator("#gradientCode").inner_text()
    check(gradient_css.startswith("background: linear-gradient(135deg, #"), "the gradient code is linear by default")
    page.locator("#gradientTypeTabs button[data-type='radial']").click()
    check("radial-gradient(circle at 50% 50%" in page.locator("#gradientCode").inner_text(),
          "the radial type is applied")
    page.locator("#gradientTypeTabs button[data-type='linear']").click()
    page.locator("#gradientAngle").fill("90")
    page.locator("#gradientAngle").dispatch_event("input")
    check("linear-gradient(90deg" in page.locator("#gradientCode").inner_text(), "the angle is applied")
    check(page.locator("#gradientAngleValue").inner_text() == "90deg", "the angle label updates")

    # ---------------------------------------------------------------- contrast
    page.locator("#fgInput").fill("#9ca3af")
    page.locator("#fgInput").dispatch_event("change")
    check(page.locator("#contrastValue").inner_text() == "2.54:1", "the ratio for #9ca3af on white is 2.54:1")
    check(page.locator("#badgeNormal").inner_text().startswith("Fail"), "normal text fails at 2.54:1")
    check(page.locator("#suggestionRow").is_visible(), "an accessible suggestion is offered")
    suggestion = page.locator("#suggestionSwatch").inner_text()
    check(re.fullmatch(r"#[0-9a-f]{6}", suggestion) is not None, "the suggestion is a hex color")
    # The suggestion row must really disappear when the color already passes:
    # a component rule with display:flex silently beats the hidden attribute.
    hidden_but_visible = page.evaluate("""() => {
      return Array.from(document.querySelectorAll('[hidden]')).filter(node => {
        const style = window.getComputedStyle(node);
        return style.display !== 'none' && node.offsetParent !== null;
      }).map(node => node.id || node.className);
    }""")
    check(not hidden_but_visible, "hidden elements are actually hidden (%s)" % hidden_but_visible)
    page.locator("#applySuggestionBtn").click()
    ratio = float(page.locator("#contrastValue").inner_text().rstrip(":1"))
    check(ratio >= 4.5, "applying the suggestion reaches AA (got %.2f)" % ratio)
    check(page.locator("#heroHex").inner_text() == page.locator("#fgInput").input_value(),
          "applying the suggestion also moves the base color")
    color_after_suggestion = page.locator("#heroHex").inner_text()
    check(color_after_suggestion != "#2563eb", "the suggestion differs from the original base color")
    page.locator("#swapBtn").click()
    check(page.locator("#fgInput").input_value() == "#ffffff", "swap puts the background in front")
    check(page.locator("#suggestionRow").is_hidden(), "no suggestion row is offered when the color passes")
    check(page.locator("#contrastDemo .small").inner_text() ==
          "Normal 14 px text on the chosen background, exactly as a reader sees it.",
          "the contrast demo text is translated, not hardcoded")

    # ------------------------------------------------------------ color blindness
    cards = page.locator("#cvdGrid .cvd-item")
    check(cards.count() == 8, "eight vision simulations are shown")
    check(page.locator("#cvdGrid .cvd-item").first.inner_text().startswith("Normal vision"),
          "the first card is normal vision")
    normal_hex = page.locator("#cvdGrid .cvd-item").first.locator("span").inner_text()
    check(normal_hex == page.locator("#heroHex").inner_text(), "normal vision shows the current base color")
    achroma = page.locator("#cvdGrid .cvd-item").nth(7)
    grey_hex = achroma.locator("span").inner_text()
    check(grey_hex[1:3] == grey_hex[3:5] == grey_hex[5:7], "achromatopsia returns a neutral grey")

    # ------------------------------------------------------------------ export
    tabs = page.locator("#exportTabs button")
    check(tabs.count() == 6, "six export formats are offered")
    page.locator("#exportTabs button[data-format='tailwind']").click()
    check("module.exports" in page.locator("#exportCode").inner_text(), "the tailwind export is generated")
    page.locator("#exportTabs button[data-format='json']").click()
    payload = page.locator("#exportCode").inner_text()
    check('"contrastOnWhite"' in payload, "the json export carries contrast data")
    page.locator("#exportTabs button[data-format='svg']").click()
    check(page.locator("#exportCode").inner_text().startswith("<svg"), "the svg export is generated")
    page.locator("#exportTabs button[data-format='css']").click()
    check(":root {" in page.locator("#exportCode").inner_text(), "the css export is generated")

    # -------------------------------------------------------------- persistence
    base_before = page.locator("#heroHex").inner_text()
    saved_count = page.locator("#savedSwatches .swatch").count()
    page.reload(wait_until="networkidle")
    check(page.locator("#heroHex").inner_text() == base_before, "the base color survives a reload")
    check(page.locator("#savedSwatches .swatch").count() == saved_count, "the saved palette survives a reload")
    check(page.locator("#exportTabs button[data-format='css']").get_attribute("aria-pressed") == "true",
          "the export format survives a reload")
    check(page.locator("#gradientAngle").input_value() == "90", "the gradient angle survives a reload")
    check(page.locator("html").get_attribute("lang") == "en", "the language survives a reload")

    # --------------------------------------------------------------------- undo
    check(page.locator("#undoBtn").is_disabled(), "the undo history is empty right after a reload")
    page.locator("#hexInput").fill("#e11d48")
    page.locator("#hexInput").dispatch_event("change")
    check(page.locator("#heroHex").inner_text() == "#e11d48", "the new color is applied")
    check(page.locator("#undoBtn").is_enabled(), "undo is enabled after a change")
    page.locator("#hexInput").fill("#0f766e")
    page.locator("#hexInput").dispatch_event("change")
    check(page.locator("#heroHex").inner_text() == "#0f766e", "a second edit is applied")
    page.locator("#undoBtn").click()
    check(page.locator("#heroHex").inner_text() == "#e11d48",
          "undo restores the color that was in place before the last edit")
    page.keyboard.press("Control+z")
    check(page.locator("#heroHex").inner_text() == color_after_suggestion,
          "Ctrl+Z steps further back through the history")

    # ------------------------------------------------------------------- theme
    check(not page.locator("html").evaluate("el => el.classList.contains('theme-dark')"), "the theme starts light")
    page.locator("#themeBtn").click()
    check(page.locator("html").evaluate("el => el.classList.contains('theme-dark')"), "the theme switches to dark")
    check(page.locator("#themeLabel").inner_text() == "Light mode", "the theme button label flips")
    page.reload(wait_until="networkidle")
    check(page.locator("html").evaluate("el => el.classList.contains('theme-dark')"), "the dark theme survives a reload")
    page.locator("#themeBtn").click()
    check(not page.locator("html").evaluate("el => el.classList.contains('theme-dark')"), "the theme returns to light")
    check(page.locator("#themeLabel").inner_text() == "Dark mode", "the label names the action, not the current theme")

    # ---------------------------------------------------------------- language
    hero_name_latin = page.locator("#heroName").inner_text()
    check(hero_name_latin.isascii(), "before switching, the color name is shown in latin")
    page.locator("#langSelect").select_option("sr-cyrl")
    check(page.locator("html").get_attribute("lang") == "sr-cyrl", "the document language becomes sr-cyrl")

    def codepoints(value):
        return ",".join("%04x" % ord(char) for char in value)

    # Comparing Cyrillic literals is fragile because several glyphs look alike
    # in a terminal, so the assertions compare code points and the app's own
    # transliteration output instead.
    check(codepoints(page.locator("h1").inner_text()) == "041f,0440,0430,0432,0430,0020,0431,043e,0458,0430,002c,0020,043f,0440,0430,0432,0438,043b,043d,043e,0020,0438,0437,043c,0435,0440,0435,043d,0430,002e",
          "the hero title is transliterated to the exact expected code points")
    check(page.locator("h1").inner_text() == page.evaluate("window.TD_APP.label('heroTitle')"),
          "the rendered hero title matches the transliteration engine")
    check(page.locator("#themeLabel").inner_text() == page.evaluate("window.TD_APP.label('themeDark')"),
          "the theme label is transliterated")
    option_base = page.evaluate("document.querySelector('#langSelect option[value=\"sr-cyrl\"]').getAttribute('data-base')")
    check(option_base == "Srpski (\u0107irilica)", "the Cyrillic option keeps its latin label in data-base")
    check(page.locator("#langSelect option[value='sr-cyrl']").inner_text() == page.evaluate("window.TD_APP.toCyrillic(%r)" % option_base),
          "the language option is transliterated from its own label")
    check(codepoints(page.locator("#langSelect option[value='sr-cyrl']").inner_text()).startswith("0421,0440,043f,0441,043a,0438"),
          "the transliterated option starts with the Cyrillic spelling of Srpski")
    hero_name_cyrillic = page.locator("#heroName").inner_text()
    matching_keys = page.evaluate("""(latin) => {
      const keys = Object.keys(window.TD_LOCALES.en).filter(key =>
        key.indexOf('colorName_') === 0 && window.TD_LOCALES.en[key] === latin);
      return keys.filter(key => window.TD_LOCALES['sr-cyrl'][key] !== undefined);
    }""", hero_name_latin)
    check(len(matching_keys) == 1, "the shown color name maps to exactly one locale key (got %s)" % matching_keys)
    expected_name = page.evaluate("key => window.TD_LOCALES['sr-cyrl'][key]", matching_keys[0])
    check(hero_name_cyrillic == expected_name, "the color name is the translated one for that key")
    check(not hero_name_cyrillic.isascii(), "the color name is no longer latin")
    check(page.locator("#harmonyTabs button").first.inner_text() == page.evaluate("window.TD_APP.label('harmonyComplementary')"),
          "the harmony tabs are transliterated")
    check(not page.locator("#heroName").inner_text().isascii(), "the color name is no longer latin")
    # Every translated node must match the generated sr-cyrl table exactly.
    # Hex codes, CSS and SVG text legitimately contain latin letters, so a
    # blanket "no latin" rule over the whole page would be the wrong check.
    mismatches = page.evaluate("""() => {
      const bad = [];
      document.querySelectorAll('[data-i18n]').forEach(node => {
        const key = node.getAttribute('data-i18n');
        const expected = window.TD_LOCALES['sr-cyrl'][key];
        if (expected === undefined) { bad.push(key + ': missing key'); return; }
        if (node.textContent !== expected) bad.push(key + ': ' + JSON.stringify(node.textContent) + ' != ' + JSON.stringify(expected));
      });
      return bad;
    }""")
    check(not mismatches, "every translated node matches the sr-cyrl table (%s)" % mismatches[:5])
    check(not re.search(r"[A-Za-z]{4,}", page.locator("#harmonyTabs").inner_text()),
          "the harmony tabs contain no latin words")
    check(not re.search(r"[A-Za-z]{4,}", page.locator("#cvdGrid").inner_text().replace("Prevalence", "")),
          "the color blindness cards contain no latin words")
    page.locator("#langSelect").select_option("ro")
    check(page.locator("h1").inner_text() == "Culoarea potrivita, masurata corect.", "romanian works too")
    page.locator("#langSelect").select_option("en")
    check(page.locator("h1").inner_text() == "The right color, measured properly.", "english still works after switching back")

    # ------------------------------------------------------ installation help
    install = page.locator("#td-install-button")
    check(install.is_visible(), "the install help button is available")
    install.click()
    check(page.locator("#td-install-dialog").is_visible() and
          "Install a web app" in page.locator("#td-install-intro").inner_text(),
          "the install button opens honest browser-specific help")
    page.locator("#td-install-close").click()
    check(not page.locator("#td-install-dialog").is_visible(), "the install dialog closes")

    page.close()


def run_tablet(browser, url):
    context = browser.new_context(
        viewport={"width": 820, "height": 1180},
        has_touch=True,
        is_mobile=True,
        locale="sr-RS",
    )
    page = context.new_page()
    attach(page)
    response = page.goto(url, wait_until="networkidle")
    check(response is not None and response.status == 200, "index.html loads on the tablet viewport")

    # A Serbian browser must start in Serbian Latin, not Cyrillic.
    check(page.locator("html").get_attribute("lang") == "sr-latn", "a sr-RS browser starts in Serbian Latin")
    check(page.locator("h1").inner_text() == "Prava boja, pravilno izmerena.", "the Serbian Latin hero is shown")

    page.locator("#demoImageBtn").tap()
    page.wait_for_function("() => document.querySelectorAll('#extractedSwatches .swatch').length === 6", timeout=10000)
    check(page.locator("#extractedSwatches .swatch").count() == 6, "extraction works with touch")
    page.locator("#extractedSwatches .swatch").first.tap()
    check(page.locator("#heroHex").inner_text() != "#2563eb", "tapping a swatch changes the base color")

    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check(overflow <= 1, "no horizontal overflow at 820px (got %dpx)" % overflow)
    check(page.locator("#randomBtn").bounding_box()["height"] >= 44,
          "coarse-pointer controls meet the 44px touch-target rule")

    page.locator("#hexInput").tap()
    page.locator("#hexInput").fill("#0f766e")
    page.locator("#hexInput").dispatch_event("change")
    check(page.locator("#heroHex").inner_text() == "#0f766e", "the hex input works with touch")

    context.close()


def run_small_phone(browser, url):
    context = browser.new_context(
        viewport={"width": 320, "height": 700},
        has_touch=True,
        is_mobile=True,
        locale="en-US",
    )
    page = context.new_page()
    attach(page)
    response = page.goto(url, wait_until="networkidle")
    check(response is not None and response.status == 200, "index.html loads at 320px")
    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check(overflow <= 1, "no horizontal overflow at 320px (got %dpx)" % overflow)
    check(page.locator("#td-install-button").bounding_box()["height"] >= 44,
          "the install control keeps its touch target on a small phone")
    page.locator("#td-install-button").tap()
    dialog = page.locator("#td-install-dialog")
    box = dialog.bounding_box()
    check(dialog.is_visible() and box["x"] >= 0 and box["x"] + box["width"] <= 321,
          "the install dialog opens within the small-phone viewport")
    page.locator("#td-install-close").tap()
    check(not dialog.is_visible(), "the install dialog closes with touch")
    context.close()


def main():
    if not (ROOT / "index.html").is_file():
        raise SystemExit("index.html is missing, run python3 build.py first")

    server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    Thread(target=server.serve_forever, daemon=True).start()
    url = "http://127.0.0.1:%d/" % server.server_port

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        run_desktop(browser, url)
        run_tablet(browser, url)
        run_small_phone(browser, url)
        browser.close()

    if errors:
        print("UI test failed with %d page or console errors:" % len(errors))
        for entry in errors[:20]:
            print("  " + entry)
        sys.exit(1)
    print("ui tests: %d checks passed, 0 page or console errors" % checks[0])


if __name__ == "__main__":
    main()
