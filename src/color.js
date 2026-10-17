/* Palette Studio · TekiDeki - colour engine
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Kristian Mario Miskovic (TekiDeki)
 *
 * Loaded twice on purpose: as a plain <script> in the browser (where it fills
 * window.TD) and with require() in Node, so the tests exercise exactly the
 * code the app ships.
 */
(function (root) {
  'use strict';

  var TD = root.TD || (root.TD = {});

  /* ---------------------------------------------------------------- input */

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function round(value, digits) {
    var factor = Math.pow(10, digits || 0);
    return Math.round(value * factor) / factor;
  }

  /* Accepts #rgb, #rgba, #rrggbb, #rrggbbaa and the bare forms. */
  function parseHex(input) {
    if (typeof input !== 'string') return null;
    var hex = input.trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split('').map(function (c) { return c + c; }).join('');
    }
    if (hex.length !== 6 && hex.length !== 8) return null;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? round(parseInt(hex.slice(6, 8), 16) / 255, 3) : 1
    };
  }

  function rgbToHex(rgb) {
    function part(value) {
      var out = clamp(Math.round(value), 0, 255).toString(16);
      return out.length === 1 ? '0' + out : out;
    }
    var hex = '#' + part(rgb.r) + part(rgb.g) + part(rgb.b);
    if (rgb.a !== undefined && rgb.a !== null && rgb.a < 1) {
      hex += part(rgb.a * 255);
    }
    return hex;
  }

  function normalizeRgb(rgb) {
    return {
      r: clamp(Math.round(rgb.r), 0, 255),
      g: clamp(Math.round(rgb.g), 0, 255),
      b: clamp(Math.round(rgb.b), 0, 255),
      a: rgb.a === undefined || rgb.a === null ? 1 : clamp(rgb.a, 0, 1)
    };
  }

  /* ------------------------------------------------------------ rrgb/hsl */

  function rgbToHsl(rgb) {
    var r = clamp(rgb.r, 0, 255) / 255;
    var g = clamp(rgb.g, 0, 255) / 255;
    var b = clamp(rgb.b, 0, 255) / 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var delta = max - min;
    var h = 0;
    if (delta !== 0) {
      if (max === r) h = ((g - b) / delta) % 6;
      else if (max === g) h = (b - r) / delta + 2;
      else h = (r - g) / delta + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    var l = (max + min) / 2;
    var s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
    return { h: round(h, 1), s: round(s * 100, 1), l: round(l * 100, 1) };
  }

  function hslToRgb(hsl) {
    var h = ((hsl.h % 360) + 360) % 360;
    var s = clamp(hsl.s, 0, 100) / 100;
    var l = clamp(hsl.l, 0, 100) / 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return normalizeRgb({
      r: (rgb[0] + m) * 255,
      g: (rgb[1] + m) * 255,
      b: (rgb[2] + m) * 255,
      a: hsl.a === undefined ? 1 : hsl.a
    });
  }

  /* ------------------------------------------------------------ rrgb/hsv */

  function rgbToHsv(rgb) {
    var r = clamp(rgb.r, 0, 255) / 255;
    var g = clamp(rgb.g, 0, 255) / 255;
    var b = clamp(rgb.b, 0, 255) / 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var delta = max - min;
    var h = 0;
    if (delta !== 0) {
      if (max === r) h = ((g - b) / delta) % 6;
      else if (max === g) h = (b - r) / delta + 2;
      else h = (r - g) / delta + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return {
      h: round(h, 1),
      s: round(max === 0 ? 0 : (delta / max) * 100, 1),
      v: round(max * 100, 1)
    };
  }

  function hsvToRgb(hsv) {
    var h = ((hsv.h % 360) + 360) % 360;
    var s = clamp(hsv.s, 0, 100) / 100;
    var v = clamp(hsv.v, 0, 100) / 100;
    var c = v * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = v - c;
    var rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return normalizeRgb({
      r: (rgb[0] + m) * 255,
      g: (rgb[1] + m) * 255,
      b: (rgb[2] + m) * 255,
      a: hsv.a === undefined ? 1 : hsv.a
    });
  }

  /* ------------------------------------------------------------ rrgb/cmyk */

  function rgbToCmyk(rgb) {
    var r = clamp(rgb.r, 0, 255) / 255;
    var g = clamp(rgb.g, 0, 255) / 255;
    var b = clamp(rgb.b, 0, 255) / 255;
    var k = 1 - Math.max(r, g, b);
    if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
    return {
      c: round(((1 - r - k) / (1 - k)) * 100, 1),
      m: round(((1 - g - k) / (1 - k)) * 100, 1),
      y: round(((1 - b - k) / (1 - k)) * 100, 1),
      k: round(k * 100, 1)
    };
  }

  function cmykToRgb(cmyk) {
    var c = clamp(cmyk.c, 0, 100) / 100;
    var m = clamp(cmyk.m, 0, 100) / 100;
    var y = clamp(cmyk.y, 0, 100) / 100;
    var k = clamp(cmyk.k, 0, 100) / 100;
    return normalizeRgb({
      r: 255 * (1 - c) * (1 - k),
      g: 255 * (1 - m) * (1 - k),
      b: 255 * (1 - y) * (1 - k),
      a: cmyk.a === undefined ? 1 : cmyk.a
    });
  }

  /* ------------------------------------------------------------- WCAG 2.x */

  function channelToLinear(value) {
    var c = clamp(value, 0, 255) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(rgb) {
    return 0.2126 * channelToLinear(rgb.r)
      + 0.7152 * channelToLinear(rgb.g)
      + 0.0722 * channelToLinear(rgb.b);
  }

  function contrastRatio(a, b) {
    var la = relativeLuminance(a);
    var lb = relativeLuminance(b);
    var lighter = Math.max(la, lb);
    var darker = Math.min(la, lb);
    return round((lighter + 0.05) / (darker + 0.05), 2);
  }

  function wcagLevel(ratio, large) {
    if (ratio >= 7 && !large) return 'AAA';
    if (ratio >= 4.5 && !large) return 'AA';
    if (ratio >= 4.5 && large) return 'AAA';
    if (ratio >= 3 && large) return 'AA';
    return 'fail';
  }

  /* ------------------------------------------------------ colour blindness */
  /* Machado, Oliveira and Fernandes (2009), "A Physiologically-based Model
   * for Simulation of Color Vision Deficiency", IEEE TVCG 15(6):1291-1298.
   * Table 1 of the authors' data page, all eleven published severity steps
   * for each type: 1.0 is the complete form (dichromacy), 0.5 is the common
   * anomalous trichromacy, 0.0 is the identity matrix.
   *
   * The matrices are applied in linear RGB, not on the gamma encoded values:
   * every row sums to 1, which is exactly what keeps white white and greys
   * grey. Applying them to sRGB values instead is a common bug that shifts
   * every hue and darkens the midtones. */

  var CVD_SEVERITIES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

  /* Flat tables: 11 severities x 9 coefficients, row major. */
  var CVD_TABLES = {
    protanomaly: [1.0,0.0,-0.0,0.0,1.0,0.0,-0.0,-0.0,1.0,0.856167,0.182038,-0.038205,0.029342,0.955115,0.015544,-0.00288,-0.001563,1.004443,0.734766,0.334872,-0.069637,0.05184,0.919198,0.028963,-0.004928,-0.004209,1.009137,0.630323,0.465641,-0.095964,0.069181,0.890046,0.040773,-0.006308,-0.007724,1.014032,0.539009,0.579343,-0.118352,0.082546,0.866121,0.051332,-0.007136,-0.011959,1.019095,0.458064,0.679578,-0.137642,0.092785,0.846313,0.060902,-0.007494,-0.016807,1.024301,0.38545,0.769005,-0.154455,0.100526,0.829802,0.069673,-0.007442,-0.02219,1.029632,0.319627,0.849633,-0.169261,0.106241,0.815969,0.07779,-0.007025,-0.028051,1.035076,0.259411,0.923008,-0.18242,0.110296,0.80434,0.085364,-0.006276,-0.034346,1.040622,0.203876,0.990338,-0.194214,0.112975,0.794542,0.092483,-0.005222,-0.041043,1.046265,0.152286,1.052583,-0.204868,0.114503,0.786281,0.099216,-0.003882,-0.048116,1.051998],
    deuteranomaly: [1.0,0.0,-0.0,0.0,1.0,0.0,-0.0,-0.0,1.0,0.866435,0.177704,-0.044139,0.049567,0.939063,0.01137,-0.003453,0.007233,0.99622,0.760729,0.319078,-0.079807,0.090568,0.889315,0.020117,-0.006027,0.013325,0.992702,0.675425,0.43385,-0.109275,0.125303,0.847755,0.026942,-0.00795,0.018572,0.989378,0.605511,0.52856,-0.134071,0.155318,0.812366,0.032316,-0.009376,0.023176,0.9862,0.547494,0.607765,-0.155259,0.181692,0.781742,0.036566,-0.01041,0.027275,0.983136,0.498864,0.674741,-0.173604,0.205199,0.754872,0.039929,-0.011131,0.030969,0.980162,0.457771,0.731899,-0.18967,0.226409,0.731012,0.042579,-0.011595,0.034333,0.977261,0.422823,0.781057,-0.203881,0.245752,0.709602,0.044646,-0.011843,0.037423,0.974421,0.392952,0.82361,-0.216562,0.263559,0.69021,0.046232,-0.01191,0.040281,0.97163,0.367322,0.860646,-0.227968,0.280085,0.672501,0.047413,-0.01182,0.04294,0.968881],
    tritanomaly: [1.0,0.0,-0.0,0.0,1.0,0.0,-0.0,-0.0,1.0,0.92667,0.092514,-0.019184,0.021191,0.964503,0.014306,0.008437,0.054813,0.93675,0.89572,0.13333,-0.02905,0.029997,0.9454,0.024603,0.013027,0.104707,0.882266,0.905871,0.127791,-0.033662,0.026856,0.941251,0.031893,0.01341,0.148296,0.838294,0.948035,0.08949,-0.037526,0.014364,0.946792,0.038844,0.010853,0.193991,0.795156,1.017277,0.027029,-0.044306,-0.006113,0.958479,0.047634,0.006379,0.248708,0.744913,1.104996,-0.046633,-0.058363,-0.032137,0.971635,0.060503,0.001336,0.317922,0.680742,1.193214,-0.109812,-0.083402,-0.058496,0.97941,0.079086,-0.002346,0.403492,0.598854,1.257728,-0.139648,-0.118081,-0.078003,0.975409,0.102594,-0.003316,0.501214,0.502102,1.278864,-0.125333,-0.153531,-0.084748,0.957674,0.127074,-0.000989,0.601151,0.399838,1.255528,-0.076749,-0.178779,-0.078411,0.930809,0.147602,0.004733,0.691367,0.3039]
  };

  /* Which published table serves each named condition, and at which severity. */
  var CVD_CONDITIONS = {
    protanopia: ['protanomaly', 1],
    protanomaly: ['protanomaly', 0.5],
    deuteranopia: ['deuteranomaly', 1],
    deuteranomaly: ['deuteranomaly', 0.5],
    tritanopia: ['tritanomaly', 1],
    tritanomaly: ['tritanomaly', 0.5]
  };

  function srgbToLinear(value) {
    return channelToLinear(value);
  }

  function multiply3(matrix, vector) {
    return [
      matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
      matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
      matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2]
    ];
  }

  function linearToSrgb(value) {
    var c = clamp(value, 0, 1);
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }

  /* Reads the published matrix for a severity, interpolating between the two
   * nearest published steps exactly as the authors' tutorial prescribes. */
  function cvdMatrix(type, severity) {
    var table = CVD_TABLES[type];
    if (!table) return null;
    var wanted = clamp(severity === undefined ? 1 : severity, 0, 1);
    var position = wanted * 10;
    var lower = Math.floor(position);
    var upper = Math.ceil(position);
    var weight = position - lower;
    var matrix = [];
    for (var i = 0; i < 9; i++) {
      var a = table[lower * 9 + i];
      var b = table[upper * 9 + i];
      matrix.push(a + (b - a) * weight);
    }
    return [
      [matrix[0], matrix[1], matrix[2]],
      [matrix[3], matrix[4], matrix[5]],
      [matrix[6], matrix[7], matrix[8]]
    ];
  }

  /* severity is optional: 1 is the complete form, 0 leaves the colour alone. */
  function simulateCvd(rgb, type, severity) {
    var condition = CVD_CONDITIONS[type];
    if (!condition) return normalizeRgb(rgb);
    var matrix = cvdMatrix(condition[0], severity === undefined ? condition[1] : severity);
    if (!matrix) return normalizeRgb(rgb);
    var linear = [
      srgbToLinear(rgb.r),
      srgbToLinear(rgb.g),
      srgbToLinear(rgb.b)
    ];
    var transformed = multiply3(matrix, linear);
    return normalizeRgb({
      r: linearToSrgb(transformed[0]) * 255,
      g: linearToSrgb(transformed[1]) * 255,
      b: linearToSrgb(transformed[2]) * 255,
      a: 1
    });
  }

  var CVD_TYPES = ['protanopia', 'deuteranopia', 'tritanopia', 'protanomaly', 'deuteranomaly', 'tritanomaly'];

  /* ----------------------------------------------------------------- CIE */
  /* D65 white point, CIE 1931 2 degree observer. */

  var D65 = { x: 95.047, y: 100.0, z: 108.883 };

  function rgbToXyz(rgb) {
    var r = channelToLinear(rgb.r);
    var g = channelToLinear(rgb.g);
    var b = channelToLinear(rgb.b);
    return {
      x: (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) * 100,
      y: (r * 0.2126729 + g * 0.7151522 + b * 0.0721750) * 100,
      z: (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) * 100
    };
  }

  function labF(t) {
    return t > 0.008856 ? Math.pow(t, 1 / 3) : (903.3 * t + 16) / 116;
  }

  function rgbToLab(rgb) {
    var xyz = rgbToXyz(rgb);
    var fx = labF(xyz.x / D65.x);
    var fy = labF(xyz.y / D65.y);
    var fz = labF(xyz.z / D65.z);
    return {
      l: round(116 * fy - 16, 2),
      a: round(500 * (fx - fy), 2),
      b: round(200 * (fy - fz), 2)
    };
  }

  function labDeltaE76(lab1, lab2) {
    return Math.sqrt(
      Math.pow(lab1.l - lab2.l, 2) +
      Math.pow(lab1.a - lab2.a, 2) +
      Math.pow(lab1.b - lab2.b, 2)
    );
  }

  /* ------------------------------------------------------------- harmonies */

  var HARMONY_DEGREES = {
    complementary: [0, 180],
    analogous: [-30, 0, 30],
    triadic: [0, 120, 240],
    tetradic: [0, 90, 180, 270],
    split: [0, 150, 210],
    square: [0, 90, 180, 270]
  };

  var HARMONY_ORDER = ['complementary', 'analogous', 'triadic', 'tetradic', 'split', 'square'];

  function harmony(name, rgb, options) {
    var degrees = HARMONY_DEGREES[name];
    if (!degrees) return [];
    var hsl = rgbToHsl(rgb);
    var opts = options || {};
    var saturationShift = typeof opts.saturationShift === 'number' ? opts.saturationShift : 0;
    var lightnessShift = typeof opts.lightnessShift === 'number' ? opts.lightnessShift : 0;
    return degrees.map(function (offset, index) {
      var spread = opts.spread && degrees.length > 1 ? (index - (degrees.length - 1) / 2) * opts.spread : 0;
      return hslToRgb({
        h: hsl.h + offset,
        s: clamp(hsl.s + saturationShift, 0, 100),
        l: clamp(hsl.l + lightnessShift + spread, 0, 100)
      });
    });
  }

  function monochromatic(rgb, count) {
    var steps = clamp(Math.round(count || 5), 2, 9);
    var hsl = rgbToHsl(rgb);
    var out = [];
    for (var i = 0; i < steps; i++) {
      var l = 92 - (i * (84 / (steps - 1)));
      out.push(hslToRgb({ h: hsl.h, s: clamp(hsl.s, 8, 100), l: l }));
    }
    return out;
  }

  function mix(rgb1, rgb2, amount) {
    var t = clamp(amount === undefined ? 0.5 : amount, 0, 1);
    return normalizeRgb({
      r: rgb1.r + (rgb2.r - rgb1.r) * t,
      g: rgb1.g + (rgb2.g - rgb1.g) * t,
      b: rgb1.b + (rgb2.b - rgb1.b) * t,
      a: rgb1.a + ((rgb2.a === undefined ? 1 : rgb2.a) - (rgb1.a === undefined ? 1 : rgb1.a)) * t
    });
  }

  /* --------------------------------------------------------------- strings */

  function formatRgb(rgb) {
    var base = 'rgb(' + Math.round(rgb.r) + ', ' + Math.round(rgb.g) + ', ' + Math.round(rgb.b) + ')';
    if (rgb.a !== undefined && rgb.a !== null && rgb.a < 1) {
      return 'rgba(' + Math.round(rgb.r) + ', ' + Math.round(rgb.g) + ', ' + Math.round(rgb.b) + ', ' + round(rgb.a, 2) + ')';
    }
    return base;
  }

  function formatHsl(hsl) {
    return 'hsl(' + Math.round(hsl.h) + ', ' + Math.round(hsl.s) + '%, ' + Math.round(hsl.l) + '%)';
  }

  /* Nearest accessible colour on the lightness axis, WCAG 2.x.
   * Both directions are scanned: a light grey on white has to get darker, a
   * dark grey on white has to get lighter, and the smaller lightness change
   * wins. If neither end of the axis reaches the required ratio (possible on
   * mid-grey backgrounds with AAA) the extreme with the better ratio is used
   * and the result is reported as unreachable. */
  function nearestAccessible(rgb, target, minimum) {
    var required = minimum || 4.5;
    var hsl = rgbToHsl(normalizeRgb(rgb));
    var background = normalizeRgb(target);
    var candidates = [];
    [1, -1].forEach(function (direction) {
      for (var step = 0; step <= 100; step++) {
        var lightness = clamp(hsl.l + direction * step, 0, 100);
        var candidate = hslToRgb({ h: hsl.h, s: hsl.s, l: lightness });
        var ratio = contrastRatio(candidate, background);
        if (ratio >= required) {
          candidates.push({
            rgb: candidate,
            hex: rgbToHex(candidate),
            lightness: lightness,
            shift: Math.abs(lightness - hsl.l),
            direction: direction > 0 ? 'lighter' : 'darker',
            ratio: ratio,
            reachable: true
          });
          break;
        }
      }
    });
    if (candidates.length === 0) {
      var extremes = [0, 100].map(function (lightness) {
        var candidate = hslToRgb({ h: hsl.h, s: hsl.s, l: lightness });
        return {
          rgb: candidate,
          hex: rgbToHex(candidate),
          lightness: lightness,
          shift: Math.abs(lightness - hsl.l),
          direction: lightness > hsl.l ? 'lighter' : 'darker',
          ratio: contrastRatio(candidate, background),
          reachable: false
        };
      });
      extremes.sort(function (a, b) {
        return b.ratio - a.ratio || a.shift - b.shift;
      });
      return extremes[0];
    }
    candidates.sort(function (a, b) {
      return a.shift - b.shift || b.ratio - a.ratio;
    });
    return candidates[0];
  }

  TD.clamp = clamp;
  TD.round = round;
  TD.parseHex = parseHex;
  TD.rgbToHex = rgbToHex;
  TD.normalizeRgb = normalizeRgb;
  TD.rgbToHsl = rgbToHsl;
  TD.hslToRgb = hslToRgb;
  TD.rgbToHsv = rgbToHsv;
  TD.hsvToRgb = hsvToRgb;
  TD.rgbToCmyk = rgbToCmyk;
  TD.cmykToRgb = cmykToRgb;
  TD.channelToLinear = channelToLinear;
  TD.relativeLuminance = relativeLuminance;
  TD.contrastRatio = contrastRatio;
  TD.wcagLevel = wcagLevel;
  TD.srgbToLinear = srgbToLinear;
  TD.linearToSrgb = linearToSrgb;
  TD.cvdMatrix = cvdMatrix;
  TD.CVD_SEVERITIES = CVD_SEVERITIES;
  TD.CVD_CONDITIONS = CVD_CONDITIONS;
  TD.simulateCvd = simulateCvd;
  TD.CVD_TYPES = CVD_TYPES;
  TD.rgbToXyz = rgbToXyz;
  TD.rgbToLab = rgbToLab;
  TD.labDeltaE76 = labDeltaE76;
  TD.HARMONY_ORDER = HARMONY_ORDER;
  TD.HARMONY_DEGREES = HARMONY_DEGREES;
  TD.harmony = harmony;
  TD.monochromatic = monochromatic;
  TD.mix = mix;
  TD.formatRgb = formatRgb;
  TD.formatHsl = formatHsl;
  TD.nearestAccessible = nearestAccessible;

  if (typeof module !== 'undefined' && module.exports) module.exports = TD;
})(typeof window !== 'undefined' ? window : global);
