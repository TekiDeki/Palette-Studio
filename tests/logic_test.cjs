#!/usr/bin/env node
/* Palette Studio - logic tests (Node, no dependencies).
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Kristian Mario Miskovic (TekiDeki)
 *
 * These tests load src/color.js and src/palette.js directly, so they exercise
 * the same code that ships inside index.html.
 *
 *   node tests/logic_test.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const TD = require('../src/color.js');
require('../src/palette.js');

const ROOT = path.join(__dirname, '..');
let passed = 0;
const failures = [];

function ok(condition, message) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(message);
  }
}

function near(actual, expected, message, tolerance) {
  const delta = Math.abs(actual - expected);
  const limit = tolerance === undefined ? 0.01 : tolerance;
  ok(delta <= limit, message + ' (got ' + actual + ', expected ' + expected + ' +/- ' + limit + ')');
}

function equal(actual, expected, message) {
  ok(actual === expected, message + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')');
}

const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const hex = (value) => TD.parseHex(value);

/* ------------------------------------------------------------ WCAG 2.x */

near(TD.relativeLuminance(WHITE), 1, 'luminance of white is 1');
near(TD.relativeLuminance(BLACK), 0, 'luminance of black is 0');
near(TD.contrastRatio(WHITE, BLACK), 21, 'contrast white on black is 21:1');
near(TD.contrastRatio(BLACK, WHITE), 21, 'contrast is symmetric');
near(TD.contrastRatio(hex('#767676'), WHITE), 4.54, 'classic 4.54:1 reference (#767676 on white)');
near(TD.contrastRatio(hex('#777777'), WHITE), 4.48, '#777777 on white is 4.48:1');
near(TD.contrastRatio(hex('#2563eb'), WHITE), 5.17, '#2563eb on white is 5.17:1');
near(TD.contrastRatio(hex('#ff0000'), WHITE), 4, 'pure red on white is 4:1');
equal(TD.wcagLevel(21, false), 'AAA', 'ratio 21 on normal text is AAA');
equal(TD.wcagLevel(7, false), 'AAA', 'ratio 7 on normal text is AAA');
equal(TD.wcagLevel(6.99, false), 'AA', 'ratio 6.99 on normal text is AA');
equal(TD.wcagLevel(4.5, false), 'AA', 'ratio 4.5 on normal text is AA');
equal(TD.wcagLevel(4.49, false), 'fail', 'ratio 4.49 on normal text fails');
equal(TD.wcagLevel(4.5, true), 'AAA', 'ratio 4.5 on large text is AAA');
equal(TD.wcagLevel(3, true), 'AA', 'ratio 3 on large text is AA');
equal(TD.wcagLevel(2.99, true), 'fail', 'ratio 2.99 on large text fails');

/* --------------------------------------------------------------- parsing */

equal(JSON.stringify(hex('#2563eb')), JSON.stringify({ r: 37, g: 99, b: 235, a: 1 }), 'parseHex full form');
equal(JSON.stringify(hex('2563eb')), JSON.stringify({ r: 37, g: 99, b: 235, a: 1 }), 'parseHex without hash');
equal(TD.rgbToHex(hex('#f00')), '#ff0000', 'shorthand expands');
equal(TD.parseHex('#26'), null, 'two digits are rejected');
equal(TD.parseHex('zzzzzz'), null, 'non hex characters are rejected');
equal(TD.parseHex(''), null, 'empty string is rejected');
equal(TD.parseHex(null), null, 'null is rejected');
equal(TD.rgbToHex({ r: 300, g: -20, b: 99.6, a: 1 }), '#ff0064', 'rgbToHex clamps and rounds');

/* ------------------------------------------------------ colour round trips */

['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#2563eb', '#7c3aed', '#0f766e', '#f59e0b', '#8b5cf6', '#334155', '#fda4af']
  .forEach(function (value) {
    const rgb = hex(value);
    const hsl = TD.rgbToHsl(rgb);
    const hsv = TD.rgbToHsv(rgb);
    equal(TD.rgbToHex(TD.hslToRgb(hsl)), value, 'HSL round trip for ' + value);
    equal(TD.rgbToHex(TD.hsvToRgb(hsv)), value, 'HSV round trip for ' + value);
  });

equal(JSON.stringify(TD.rgbToHsl(BLACK)), JSON.stringify({ h: 0, s: 0, l: 0 }), 'black has no hue or saturation');
equal(JSON.stringify(TD.rgbToHsl(WHITE)), JSON.stringify({ h: 0, s: 0, l: 100 }), 'white is lightness 100');
equal(JSON.stringify(TD.rgbToHsl(hex('#ff0000'))), JSON.stringify({ h: 0, s: 100, l: 50 }), 'pure red is hsl(0,100%,50%)');
equal(JSON.stringify(TD.rgbToCmyk(WHITE)), JSON.stringify({ c: 0, m: 0, y: 0, k: 0 }), 'white has no ink');
equal(JSON.stringify(TD.rgbToCmyk(BLACK)), JSON.stringify({ c: 0, m: 0, y: 0, k: 100 }), 'black is key 100');
equal(TD.rgbToHex(TD.cmykToRgb(TD.rgbToCmyk(hex('#2563eb')))), '#2563eb', 'CMYK round trip');

/* -------------------------------------------------------------- CIE Lab */

const labWhite = TD.rgbToLab(WHITE);
const labBlack = TD.rgbToLab(BLACK);
near(labWhite.l, 100, 'Lab L of white is 100');
near(labWhite.a, 0, 'Lab a of white is 0');
near(labWhite.b, 0, 'Lab b of white is 0');
near(labBlack.l, 0, 'Lab L of black is 0');
near(TD.labDeltaE76(labWhite, labBlack), 100, 'deltaE76 white to black is 100');
near(TD.labDeltaE76(labWhite, labWhite), 0, 'deltaE76 of a color with itself is 0');
equal(TD.nearestColorName(WHITE).key, 'white', 'white is named white');
equal(TD.nearestColorName(BLACK).key, 'black', 'black is named black');
equal(TD.nearestColorName(hex('#ff0000')).key, 'red', 'pure red is named red');
equal(TD.nearestColorName(hex('#0000ff')).key, 'violet', 'pure blue is closest to violet in this reference table');
equal(TD.nearestColorName(hex('#0080ff')).key, 'azure', '#0080ff is named azure');
equal(TD.NAMED_COLORS.length, 42, 'the named colour table has 42 entries');

/* ---------------------------------------------------- colour vision models */

/* sRGB transfer function must round trip, because the whole simulation runs
 * in linear light and comes back through it. */
['#000000', '#808080', '#ffffff', '#2563eb', '#f59e0b', '#0f766e'].forEach(function (value) {
  const rgb = hex(value);
  const back = TD.normalizeRgb({
    r: TD.linearToSrgb(TD.srgbToLinear(rgb.r)) * 255,
    g: TD.linearToSrgb(TD.srgbToLinear(rgb.g)) * 255,
    b: TD.linearToSrgb(TD.srgbToLinear(rgb.b)) * 255,
    a: 1
  });
  equal(TD.rgbToHex(back), value, 'sRGB to linear and back is lossless for ' + value);
});
near(TD.srgbToLinear(255), 1, 'srgbToLinear(255) is 1');
near(TD.srgbToLinear(0), 0, 'srgbToLinear(0) is 0');
near(TD.linearToSrgb(1) * 255, 255, 'linearToSrgb(1) is 255');
near(TD.srgbToLinear(128), 0.2158, 'srgbToLinear(128) is 0.2158', 0.001);

/* Every published matrix has rows that sum to 1, which is what guarantees
 * that achromatic colors are left alone. Check the property, not one sample. */
Object.keys(TD.CVD_CONDITIONS).forEach(function (type) {
  TD.CVD_SEVERITIES.forEach(function (severity) {
    const table = type.replace('opia', 'omaly');
    const matrix = TD.cvdMatrix(table, severity);
    matrix.forEach(function (row, index) {
      near(row[0] + row[1] + row[2], 1, table + ' severity ' + severity + ' row ' + index + ' sums to 1', 0.0002);
    });
  });
});

/* Achromatic colors must survive every simulation untouched. */
['#ffffff', '#808080', '#000000', '#c0c0c0', '#404040'].forEach(function (value) {
  const rgb = hex(value);
  TD.CVD_TYPES.forEach(function (type) {
    equal(TD.rgbToHex(TD.simulateCvd(rgb, type)), value, type + ' leaves ' + value + ' unchanged');
  });
});

/* Severity 0 is the identity, severity 1 is the published dichromacy matrix. */
['#ff0000', '#00ff00', '#2563eb'].forEach(function (value) {
  const rgb = hex(value);
  equal(TD.rgbToHex(TD.simulateCvd(rgb, 'protanopia', 0)), TD.rgbToHex(rgb), 'severity 0 is the identity for ' + value);
});

/* Classic confusion pairs must collapse under the matching deficiency. */
function delta(value1, value2, type) {
  return TD.labDeltaE76(TD.rgbToLab(TD.simulateCvd(hex(value1), type)), TD.rgbToLab(TD.simulateCvd(hex(value2), type)));
}
const redGreenBefore = TD.labDeltaE76(TD.rgbToLab(hex('#c00000')), TD.rgbToLab(hex('#006400')));
const redGreenDeutan = delta('#c00000', '#006400', 'deuteranopia');
ok(redGreenDeutan < redGreenBefore, 'red against dark green collapses under deuteranopia (' + redGreenDeutan.toFixed(1) + ' vs ' + redGreenBefore.toFixed(1) + ')');
ok(redGreenDeutan < 20, 'red against dark green is nearly indistinguishable under deuteranopia (got ' + redGreenDeutan.toFixed(1) + ')');
const blueYellowBefore = TD.labDeltaE76(TD.rgbToLab(hex('#0000ff')), TD.rgbToLab(hex('#ffd700')));
const blueYellowTritan = delta('#0000ff', '#ffd700', 'tritanopia');
ok(blueYellowTritan < blueYellowBefore, 'blue against yellow collapses under tritanopia (' + blueYellowTritan.toFixed(1) + ' vs ' + blueYellowBefore.toFixed(1) + ')');
ok(redGreenDeutan < delta('#c00000', '#006400', 'tritanopia'), 'the red green pair collapses more under deutan than under tritan');

/* The partial forms sit between normal vision and the complete form. */
const fullProtan = TD.simulateCvd(hex('#ff0000'), 'protanopia');
const halfProtan = TD.simulateCvd(hex('#ff0000'), 'protanomaly');
const plainRed = hex('#ff0000');
const distanceFull = TD.labDeltaE76(TD.rgbToLab(plainRed), TD.rgbToLab(fullProtan));
const distanceHalf = TD.labDeltaE76(TD.rgbToLab(plainRed), TD.rgbToLab(halfProtan));
ok(distanceHalf > 0 && distanceHalf < distanceFull, 'protanomaly is a partial shift (' + distanceHalf.toFixed(1) + ' vs ' + distanceFull.toFixed(1) + ')');

equal(JSON.stringify(TD.simulateCvd(hex('#123456'), 'unknown-type')), JSON.stringify(TD.normalizeRgb(hex('#123456'))), 'unknown CVD type returns the input');
['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#7c3aed'].forEach(function (value) {
  const rgb = hex(value);
  TD.CVD_TYPES.concat(['achromatopsia']).forEach(function (type) {
    const simulated = TD.simulateCvd(rgb, type);
    ok(simulated.r >= 0 && simulated.r <= 255 && simulated.g >= 0 && simulated.g <= 255 && simulated.b >= 0 && simulated.b <= 255,
      'CVD ' + type + ' output stays in range for ' + value);
  });
});

/* ------------------------------------------------------------- harmonies */

const base = hex('#2563eb');
equal(TD.harmony('complementary', base).map(TD.rgbToHex).join(' '), '#2563eb #ebad25', 'complementary of #2563eb is a 180 degree hue rotation');
equal(TD.harmony('triadic', base).map(TD.rgbToHex).join(' '), '#2563eb #eb2563 #63eb25', 'triadic of #2563eb');
equal(TD.harmony('analogous', base).length, 3, 'analogous has 3 colors');
equal(TD.harmony('tetradic', base).length, 4, 'tetradic has 4 colors');
equal(TD.harmony('square', base).length, 4, 'square has 4 colors');
equal(TD.harmony('split', base).length, 3, 'split complementary has 3 colors');
equal(TD.harmony('triadic', base)[0].r, base.r, 'the first harmony color is the base color');
equal(TD.monochromatic(base, 5).length, 5, 'monochromatic returns the requested count');
equal(TD.monochromatic(base, 1).length, 2, 'monochromatic is clamped to at least 2');
equal(TD.harmony('nonsense', base).length, 0, 'unknown harmony returns nothing');
equal(TD.HARMONY_ORDER.length, 6, 'HARMONY_ORDER lists 6 schemes');

/* -------------------------------------------------------- nearest accessible */

const grey = hex('#9ca3af');
const suggestion = TD.nearestAccessible(grey, WHITE, 4.5);
ok(suggestion.reachable === true, 'a reachable suggestion is found for #9ca3af on white');
ok(suggestion.ratio >= 4.5, 'the suggestion reaches 4.5:1 (got ' + suggestion.ratio + ')');
equal(suggestion.direction, 'darker', '#9ca3af on white must get darker');
ok(suggestion.shift < 60, 'the suggestion is a small lightness change (got ' + suggestion.shift + ')');
const impossible = TD.nearestAccessible(hex('#808080'), hex('#8a8a8a'), 7);
ok(impossible.reachable === false, 'mid grey on mid grey cannot reach AAA');
const already = TD.nearestAccessible(hex('#101725'), WHITE, 4.5);
equal(already.hex, '#101725', 'a color that already passes is returned unchanged');
ok(already.shift === 0, 'no shift when the color already passes');

/* --------------------------------------------------------------- palette */

function deterministicSamples() {
  const samples = [];
  for (let i = 0; i < 3000; i += 1) {
    samples.push({ r: (i * 37) % 256, g: (i * 91) % 256, b: (i * 53) % 256 });
  }
  return samples;
}

const samples = deterministicSamples();
const firstRun = TD.extractPalette(samples, { k: 6 });
const secondRun = TD.extractPalette(samples, { k: 6 });
equal(JSON.stringify(firstRun), JSON.stringify(secondRun), 'palette extraction is deterministic');
equal(firstRun.length, 6, 'extraction returns the requested cluster count');
ok(firstRun.every(function (entry) { return /^#[0-9a-f]{6}$/.test(entry.hex); }), 'every palette entry is a 6 digit hex');
near(firstRun.reduce(function (sum, entry) { return sum + entry.share; }, 0), 100, 'palette shares add up to 100', 0.05);
const descending = firstRun.every(function (entry, index) {
  return index === 0 || firstRun[index - 1].share >= entry.share;
});
ok(descending, 'palette is sorted by share, largest first');
equal(TD.extractPalette([], { k: 5 }).length, 0, 'no pixels means no palette');
equal(TD.extractPalette(samples, { k: 40 }).length, 12, 'the requested cluster count is clamped to 12');
equal(TD.extractPalette(samples, { k: 1 }).length, 1, 'a single cluster is allowed');

const singleColor = [];
for (let i = 0; i < 500; i += 1) singleColor.push({ r: 10, g: 20, b: 30 });
const single = TD.extractPalette(singleColor, { k: 4 });
equal(single.length, 1, 'a flat image yields a single color');
near(single[0].share, 100, 'the single color covers the whole image');

/* quantisation keeps counts exact */
const quantized = TD.quantize([{ r: 0, g: 0, b: 0 }, { r: 1, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }], 5);
equal(quantized.length, 2, 'two near black pixels merge, white stays separate');
equal(quantized.reduce(function (sum, bucket) { return sum + bucket.count; }, 0), 3, 'quantisation preserves the pixel count');

/* sampling skips transparent pixels and respects the grid */
const imageData = new Uint8ClampedArray(4 * 4 * 4);
for (let pixel = 0; pixel < 16; pixel += 1) {
  imageData[pixel * 4] = 128;
  imageData[pixel * 4 + 1] = 64;
  imageData[pixel * 4 + 2] = 32;
  imageData[pixel * 4 + 3] = pixel % 2 === 0 ? 255 : 0;
}
equal(TD.samplePixels(imageData, 4, 4).length, 8, 'transparent pixels are skipped');

/* -------------------------------------------------------------- gradients */

const stops = [{ rgb: hex('#2563eb'), position: 0 }, { rgb: hex('#7c3aed'), position: 100 }];
equal(TD.gradientCss(stops, { angle: 135 }), 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)', 'linear gradient CSS');
equal(TD.gradientCss(stops, { type: 'radial' }), 'radial-gradient(circle at 50% 50%, #2563eb 0%, #7c3aed 100%)', 'radial gradient CSS');
ok(TD.gradientCss(stops, { type: 'conic', angle: 90 }).indexOf('conic-gradient(from 90deg') === 0, 'conic gradient CSS');
equal(TD.gradientCss(stops, { angle: 400 }), 'linear-gradient(40deg, #2563eb 0%, #7c3aed 100%)', 'angles wrap at 360');
const svg = TD.gradientSvg(stops, { angle: 135, width: 800, height: 400 });
ok(svg.indexOf('<svg xmlns="http://www.w3.org/2000/svg"') === 0, 'gradient SVG starts with the svg element');
ok(svg.indexOf('<linearGradient id="g"') > 0, 'gradient SVG contains a linear gradient');
ok(svg.indexOf('width="800" height="400"') > 0, 'gradient SVG uses the requested size');
const radialSvg = TD.gradientSvg(stops, { type: 'radial' });
ok(radialSvg.indexOf('<radialGradient id="g"') > 0 && radialSvg.indexOf('</radialGradient>') > 0, 'radial gradient SVG is well formed');

/* ----------------------------------------------------------------- export */

const palette = [
  { hex: '#2563eb', rgb: hex('#2563eb') },
  { hex: '#7c3aed', rgb: hex('#7c3aed') },
  { hex: '#f59e0b', rgb: hex('#f59e0b') }
];
const css = TD.paletteToCssVars(palette, 'brand');
ok(css.indexOf(':root {') === 0, 'CSS variables start with :root');
ok(css.indexOf('--brand-1: #2563eb;') > 0, 'CSS variables use the prefix');
ok(css.indexOf('--brand-3-rgb: 245 158 11;') > 0, 'CSS variables expose rgb triplets');
ok(css.trim().endsWith('}'), 'CSS variables block is closed');
const scss = TD.paletteToScss(palette, 'brand');
equal(scss.split('\n').filter(Boolean).length, 3, 'SCSS has one variable per color');
ok(scss.indexOf('$brand-2: #7c3aed;') > 0, 'SCSS uses dollar variables');
const tailwind = TD.paletteToTailwind(palette, 'brand');
ok(tailwind.indexOf('module.exports = {') > 0, 'Tailwind output is a module');
ok(tailwind.indexOf("'100': '#2563eb',") > 0, 'Tailwind uses 100 based shade names');
const json = JSON.parse(TD.paletteToJson(palette, 'test'));
equal(json.colors.length, 3, 'JSON export lists every color');
equal(json.colors[0].hex, '#2563eb', 'JSON export keeps the hex');
equal(JSON.stringify(json.colors[0].rgb), '[37,99,235]', 'JSON export includes rgb triplets');
equal(JSON.stringify(json.colors[0].hsl), '[221,83,53]', 'JSON export includes hsl triplets');
near(json.colors[0].contrastOnWhite, 5.17, 'JSON export includes the contrast on white');
const exportSvg = TD.paletteToSvg(palette);
equal((exportSvg.match(/<rect /g) || []).length, 4, 'palette SVG has one rect per color plus the background');
equal((exportSvg.match(/<text /g) || []).length, 3, 'palette SVG labels every swatch');
const scale = TD.shadeScale(hex('#2563eb'));
equal(scale.length, 11, 'the shade scale has 11 steps');
equal(scale[0].step, 50, 'the scale starts at 50');
equal(scale[10].step, 950, 'the scale ends at 950');
ok(scale[0].contrastOnWhite < scale[10].contrastOnWhite, 'contrast on white grows towards the dark end');
ok(scale[0].contrastOnBlack > scale[10].contrastOnBlack, 'contrast on black falls towards the dark end');
const lightness = scale.map(function (entry) { return TD.rgbToHsl(entry.rgb).l; });
ok(lightness.every(function (value, index) { return index === 0 || lightness[index - 1] >= value; }), 'the scale lightness decreases monotonically');

/* --------------------------------------------------------- locales + build */

const locales = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'i18n', 'locales.json'), 'utf8'));
equal(Object.keys(locales).join(','), 'ro,en,sr-latn', 'locales.json holds exactly ro, en and sr-latn');
const keySets = Object.values(locales).map(function (block) { return Object.keys(block).sort().join('|'); });
equal(keySets[0], keySets[1], 'ro and en have identical keys');
equal(keySets[1], keySets[2], 'en and sr-latn have identical keys');
ok(keySets[0].split('|').length >= 100, 'there are at least 100 keys');

['\u0111', '\u0107', '\u010d', '\u0161', '\u017e'].forEach(function (letter) {
  ok(Object.values(locales['sr-latn']).some(function (value) { return value.toLowerCase().includes(letter); }),
    'Serbian Latin uses the letter ' + letter + ' somewhere');
});
[['themeDark', 'Tamni re\u017eim'], ['themeLight', 'Svetli re\u017eim'], ['undo', 'Poni\u0161ti'],
 ['contrastHint', null], ['secExport', 'Izvoz']].forEach(function (pair) {
  const actual = locales['sr-latn'][pair[0]];
  if (pair[1]) equal(actual, pair[1], 'the Serbian Latin spelling of ' + pair[0]);
});
equal(locales['sr-latn']['language'], 'Jezik interfejsa', 'Serbian Latin spelling of language');
equal(locales['sr-latn']['s'], 'Zasi\u0107enost', 'Serbian Latin spelling of saturation');

const cyrillic = toCyrillicLocal('Srpski (latinica)');
equal(cyrillic, 'Српски (латиница)', 'transliteration handles digraphs');
equal(toCyrillicLocal('Română'), 'Романа', 'Romanian diacritics transliterate');
equal(toCyrillicLocal('đ ć č š ž'), 'ђ ћ ч ш ж', 'Serbian latin special letters transliterate');
equal(toCyrillicLocal('DžĆ'), 'ЏЋ', 'uppercase digraphs transliterate');
equal(toCyrillicLocal('Tamni režim'), 'Тамни режим', 'režim keeps the зhe letter');
equal(Array.from(toCyrillicLocal('Tamni režim')).map(function (c) { return c.codePointAt(0); }).join(','),
  '1058,1072,1084,1085,1080,32,1088,1077,1078,1080,1084', 'the code points of the transliteration are exact');

function toCyrillicLocal(value) {
  /* Mirrors the app implementation so the test stays dependency free. */
  const digraphs = [['DŽ', 'Џ'], ['Dž', 'Џ'], ['dž', 'џ'], ['LJ', 'Љ'], ['Lj', 'Љ'], ['lj', 'љ'], ['NJ', 'Њ'], ['Nj', 'Њ'], ['nj', 'њ']];
  const singles = { a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', 'đ': 'ђ', e: 'е', 'ž': 'ж', z: 'з', i: 'и', j: 'ј', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', t: 'т', 'ć': 'ћ', u: 'у', f: 'ф', h: 'х', c: 'ц', 'č': 'ч', 'š': 'ш', 'ă': 'а', 'â': 'а', 'î': 'и', 'ș': 'с', 'ț': 'т' };
  let out = '';
  let index = 0;
  while (index < value.length) {
    let matched = false;
    for (const pair of digraphs) {
      if (value.startsWith(pair[0], index)) {
        out += pair[1];
        index += pair[0].length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const char = value[index];
    const converted = singles[char.toLowerCase()];
    out += converted ? (char === char.toUpperCase() && char !== char.toLowerCase() ? converted.toUpperCase() : converted) : char;
    index += 1;
  }
  return out;
}

/* ------------------------------------------------------ built index.html */

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
ok(!html.includes('\u2014'), 'index.html has no em dash');
ok(!html.includes('\u2013'), 'index.html has no en dash');
ok(html.charCodeAt(0) !== 0xfeff, 'index.html has no BOM');
ok(html.indexOf('window.TD_LOCALES=') > 0, 'index.html embeds the locale table');
ok(html.indexOf('sr-cyrl') > 0, 'index.html contains the generated sr-cyrl locale');
ok(!/\*\/\*(CSS|COLOR|PALETTE|JS)\*\//.test(html), 'index.html has no leftover markers');
['DE', 'FR', 'IT', 'ES', 'PT', 'NL'].forEach(function (code) {
  ok(!new RegExp('hreflang="' + code + '"', 'i').test(html), 'no hreflang for the removed language ' + code);
});

ok(html.includes('id="ecran-mic"'), 'built file retains small-screen rules');
ok(html.includes('id="tinte-44"'), 'built file retains touch-target rules');
ok(html.includes('regula casei: tinte de atingere pe mobil'), 'built file retains mobile house rules');
ok(html.includes('id="td-install-section"'), 'built file retains install section');
ok(html.includes('id="td-install-dialog"'), 'built file retains install dialog');

console.log('logic tests: %d passed, %d failed', passed, failures.length);
if (failures.length) {
  failures.forEach(function (message) { console.log('  FAIL ' + message); });
  process.exit(1);
}
