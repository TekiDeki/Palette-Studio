/* Palette Studio · TekiDeki - palette engine
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Kristian Mario Miskovic (TekiDeki)
 *
 * Extraction, naming, export and gradient generation. Deterministic by design:
 * the same pixels and the same settings always produce the same palette, which
 * is what makes the Node tests meaningful.
 */
(function (root) {
  'use strict';

  var TD = root.TD || (root.TD = {});

  /* -------------------------------------------------------------- sampling */

  var MAX_SAMPLES = 40000;

  /* Deterministic 32-bit LCG, same output on every machine. */
  function makeRandom(seed) {
    var state = (seed >>> 0) || 1;
    return function () {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  /* Skips fully transparent pixels and samples on a grid so the pixel count
   * stays bounded for large photos. Returns plain {r,g,b} objects. */
  function samplePixels(data, width, height, options) {
    var opts = options || {};
    var maxSamples = opts.maxSamples || MAX_SAMPLES;
    var step = Math.max(1, Math.ceil(Math.sqrt((width * height) / maxSamples)));
    var samples = [];
    for (var y = 0; y < height; y += step) {
      for (var x = 0; x < width; x += step) {
        var index = (y * width + x) * 4;
        if (data[index + 3] < 8) continue;
        samples.push({ r: data[index], g: data[index + 1], b: data[index + 2] });
      }
    }
    return samples;
  }

  /* Quantising to a coarse grid keeps k-means fast and stable: pixels that
   * differ by 1/32 of a channel cannot belong to different clusters anyway. */
  function quantize(samples, bits) {
    var shift = 8 - (bits || 5);
    var mask = ((1 << (bits || 5)) - 1) << shift;
    var buckets = new Map();
    for (var i = 0; i < samples.length; i++) {
      var sample = samples[i];
      var key = ((sample.r & mask) << 10) | ((sample.g & mask) << 5) | (sample.b & mask);
      var bucket = buckets.get(key);
      if (bucket) {
        bucket.r += sample.r;
        bucket.g += sample.g;
        bucket.b += sample.b;
        bucket.count += 1;
      } else {
        buckets.set(key, { r: sample.r, g: sample.g, b: sample.b, count: 1 });
      }
    }
    var out = [];
    buckets.forEach(function (bucket) {
      out.push({
        r: bucket.r / bucket.count,
        g: bucket.g / bucket.count,
        b: bucket.b / bucket.count,
        count: bucket.count
      });
    });
    return out;
  }

  function distanceSquared(a, b) {
    var dr = a.r - b.r;
    var dg = a.g - b.g;
    var db = a.b - b.b;
    return dr * dr + dg * dg + db * db;
  }

  /* k-means++ seeding with the seeded LCG, then Lloyd iterations. */
  function kmeans(points, k, seed, iterations) {
    var total = points.length;
    if (total === 0) return [];
    var wanted = Math.min(Math.max(1, k), total);
    var random = makeRandom(seed);
    var centroids = [];
    var first = Math.floor(random() * total);
    centroids.push({ r: points[first].r, g: points[first].g, b: points[first].b, count: 0 });

    var closest = new Array(total);
    for (var i = 0; i < total; i++) closest[i] = distanceSquared(points[i], centroids[0]);

    while (centroids.length < wanted) {
      var sum = 0;
      for (var j = 0; j < total; j++) sum += closest[j];
      var pick = random() * sum;
      var index = 0;
      if (sum > 0) {
        for (index = 0; index < total; index++) {
          pick -= closest[index];
          if (pick <= 0) break;
        }
        if (index >= total) index = total - 1;
      } else {
        index = centroids.length % total;
      }
      centroids.push({ r: points[index].r, g: points[index].g, b: points[index].b, count: 0 });
      for (var m = 0; m < total; m++) {
        var d = distanceSquared(points[m], centroids[centroids.length - 1]);
        if (d < closest[m]) closest[m] = d;
      }
    }

    var maxIterations = iterations || 20;
    for (var iteration = 0; iteration < maxIterations; iteration++) {
      var sums = centroids.map(function () { return { r: 0, g: 0, b: 0, count: 0 }; });
      for (var p = 0; p < total; p++) {
        var point = points[p];
        var best = 0;
        var bestDistance = Infinity;
        for (var c = 0; c < centroids.length; c++) {
          var distance = distanceSquared(point, centroids[c]);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = c;
          }
        }
        sums[best].r += point.r * point.count;
        sums[best].g += point.g * point.count;
        sums[best].b += point.b * point.count;
        sums[best].count += point.count;
      }
      var moved = 0;
      for (var q = 0; q < centroids.length; q++) {
        if (sums[q].count === 0) continue;
        var nextR = sums[q].r / sums[q].count;
        var nextG = sums[q].g / sums[q].count;
        var nextB = sums[q].b / sums[q].count;
        moved += Math.abs(nextR - centroids[q].r) + Math.abs(nextG - centroids[q].g) + Math.abs(nextB - centroids[q].b);
        centroids[q].r = nextR;
        centroids[q].g = nextG;
        centroids[q].b = nextB;
        centroids[q].count = sums[q].count;
      }
      if (moved < 0.5) break;
    }

    var used = centroids.filter(function (centroid) { return centroid.count > 0; });
    /* Stable order: biggest cluster first, then lighter, then warmer hue.
     * Sorting by a computed key alone would make ties depend on the input
     * order, which is fine because the input order is already deterministic. */
    used.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      var ha = TD.rgbToHsl(TD.normalizeRgb(a)).h;
      var hb = TD.rgbToHsl(TD.normalizeRgb(b)).h;
      return ha - hb;
    });
    return used;
  }

  /* Returns [{ rgb, hex, share }] sorted by share, share in percent.
   * Shares are rounded with the largest remainder method so the column always
   * adds up to exactly 100.0 instead of 99.9 or 100.2. */
  function extractPalette(samples, options) {
    var opts = options || {};
    var k = TD.clamp(Math.round(opts.k || 6), 1, 12);
    var seed = opts.seed === undefined ? 20260101 : opts.seed;
    var quantized = quantize(samples, opts.bits || 5);
    if (quantized.length === 0) return [];
    var clusters = kmeans(quantized, k, seed, opts.iterations);
    var totalPixels = 0;
    for (var i = 0; i < quantized.length; i++) totalPixels += quantized[i].count;

    var entries = clusters.map(function (cluster) {
      var rgb = TD.normalizeRgb(cluster);
      return {
        rgb: rgb,
        hex: TD.rgbToHex(rgb),
        exact: totalPixels > 0 ? (cluster.count / totalPixels) * 1000 : 0
      };
    });

    if (totalPixels > 0) {
      var floors = entries.map(function (entry) { return Math.floor(entry.exact); });
      var assigned = floors.reduce(function (sum, value) { return sum + value; }, 0);
      var leftovers = 1000 - assigned;
      var order = entries
        .map(function (entry, index) { return { index: index, fraction: entry.exact - floors[index] }; })
        .sort(function (a, b) { return b.fraction - a.fraction || a.index - b.index; });
      var cursor = 0;
      for (var j = 0; j < leftovers; j++) {
        floors[order[cursor].index] += 1;
        cursor = (cursor + 1) % order.length;
      }
      entries.forEach(function (entry, index) {
        entry.share = TD.round(floors[index] / 10, 1);
      });
    } else {
      entries.forEach(function (entry) { entry.share = 0; });
    }

    return entries.map(function (entry) {
      return { rgb: entry.rgb, hex: entry.hex, share: entry.share };
    });
  }

  /* ---------------------------------------------------------------- naming */
  /* Key + approximate centre. The label itself comes from the locale files
   * (colorName_<key>), so the table below never carries translatable text. */

  var NAMED_COLORS = [
    ['black', 0, 0, 0], ['white', 255, 255, 255], ['gray', 128, 128, 128],
    ['silver', 192, 192, 192], ['charcoal', 54, 69, 79], ['navy', 0, 0, 128],
    ['blue', 0, 87, 184], ['azure', 0, 127, 255], ['teal', 0, 128, 128],
    ['turquoise', 64, 224, 208], ['green', 34, 139, 34], ['olive', 128, 128, 0],
    ['lime', 50, 205, 50], ['emerald', 80, 200, 120], ['mint', 152, 255, 152],
    ['yellow', 255, 214, 0], ['gold', 255, 196, 0], ['amber', 255, 176, 0],
    ['orange', 255, 140, 0], ['tangerine', 242, 133, 27], ['coral', 255, 127, 80],
    ['red', 214, 40, 40], ['crimson', 220, 20, 60], ['burgundy', 128, 0, 32],
    ['maroon', 128, 0, 0], ['pink', 255, 105, 180], ['magenta', 255, 0, 255],
    ['violet', 138, 43, 226], ['purple', 128, 0, 128], ['indigo', 75, 0, 130],
    ['lavender', 200, 190, 240], ['beige', 245, 245, 220], ['sand', 226, 205, 166],
    ['brown', 139, 69, 19], ['chocolate', 210, 105, 30], ['coffee', 111, 78, 55],
    ['cyan', 0, 183, 235], ['sky', 135, 206, 235], ['ice', 224, 247, 250],
    ['rose', 255, 0, 127], ['salmon', 250, 128, 114], ['peach', 255, 203, 164]
  ];

  var NAMED_LABS = null;

  function namedLabs() {
    if (!NAMED_LABS) {
      NAMED_LABS = NAMED_COLORS.map(function (entry) {
        return { key: entry[0], lab: TD.rgbToLab({ r: entry[1], g: entry[2], b: entry[3] }) };
      });
    }
    return NAMED_LABS;
  }

  /* Returns { key, distance } with distance in CIE Lab units (deltaE76). */
  function nearestColorName(rgb) {
    var lab = TD.rgbToLab(TD.normalizeRgb(rgb));
    var best = null;
    var list = namedLabs();
    for (var i = 0; i < list.length; i++) {
      var distance = TD.labDeltaE76(lab, list[i].lab);
      if (!best || distance < best.distance) best = { key: list[i].key, distance: distance };
    }
    return { key: best.key, distance: TD.round(best.distance, 1) };
  }

  /* -------------------------------------------------------------- gradients */

  function gradientCss(stops, options) {
    var opts = options || {};
    var type = opts.type === 'radial' ? 'radial' : opts.type === 'conic' ? 'conic' : 'linear';
    var angle = typeof opts.angle === 'number' ? Math.round(((opts.angle % 360) + 360) % 360) : 135;
    var parts = stops.map(function (stop) {
      var position = Math.round(TD.clamp(stop.position, 0, 100));
      return TD.rgbToHex(stop.rgb) + ' ' + position + '%';
    });
    if (type === 'radial') return 'radial-gradient(circle at 50% 50%, ' + parts.join(', ') + ')';
    if (type === 'conic') return 'conic-gradient(from ' + angle + 'deg at 50% 50%, ' + parts.join(', ') + ')';
    return 'linear-gradient(' + angle + 'deg, ' + parts.join(', ') + ')';
  }

  function gradientSvg(stops, options) {
    var opts = options || {};
    var width = opts.width || 1200;
    var height = opts.height || 675;
    var angle = typeof opts.angle === 'number' ? Math.round(((opts.angle % 360) + 360) % 360) : 135;
    var radians = (angle * Math.PI) / 180;
    var x2 = TD.round(50 + Math.cos(radians) * 50, 2);
    var y2 = TD.round(50 + Math.sin(radians) * 50, 2);
    var x1 = TD.round(100 - x2, 2);
    var y1 = TD.round(100 - y2, 2);
    var type = opts.type === 'radial' ? 'radial' : 'linear';
    var gradientTag = type === 'radial'
      ? '<radialGradient id="g" cx="50%" cy="50%" r="70%">'
      : '<linearGradient id="g" x1="' + x1 + '%" y1="' + y1 + '%" x2="' + x2 + '%" y2="' + y2 + '%">';
    var stopsMarkup = stops.map(function (stop) {
      return '<stop offset="' + Math.round(TD.clamp(stop.position, 0, 100)) + '%" stop-color="' + TD.rgbToHex(stop.rgb) + '"/>';
    }).join('');
    var paint = type === 'radial' ? 'url(#g)' : 'url(#g)';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Gradient">'
      + '<defs>' + gradientTag + stopsMarkup + '</' + type + 'Gradient></defs>'
      + '<rect width="' + width + '" height="' + height + '" fill="' + paint + '"/>'
      + '</svg>\n';
  }

  /* ------------------------------------------------------------ shade scale */

  function shadeScale(rgb) {
    var names = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
    var white = { r: 255, g: 255, b: 255, a: 1 };
    var black = { r: 0, g: 0, b: 0, a: 1 };
    var source = TD.normalizeRgb(rgb);
    var hsl = TD.rgbToHsl(source);
    return names.map(function (step) {
      /* Saturation follows one smooth curve on 0..1: it peaks near the base
       * colour (so 500 stays close to what the user picked) and falls off
       * towards both ends, so the scale never jumps between steps. */
      var t = step / 950;
      var bell = TD.clamp(1 - Math.pow((t - 0.52) / 0.55, 2), 0, 1);
      var saturation = TD.clamp(hsl.s * (0.30 + 0.70 * bell), 0, 100);
      var lightness = 97 - t * 92;
      var mixed = TD.hslToRgb({ h: hsl.h, s: saturation, l: lightness });
      return {
        step: step,
        rgb: mixed,
        hex: TD.rgbToHex(mixed),
        contrastOnWhite: TD.contrastRatio(mixed, white),
        contrastOnBlack: TD.contrastRatio(mixed, black),
        reference: TD.round(lightness, 1)
      };
    });
  }

  /* ---------------------------------------------------------------- export */

  function paletteToCssVars(colors, prefix) {
    var name = prefix || 'brand';
    var lines = [':root {'];
    colors.forEach(function (color, index) {
      var hex = typeof color === 'string' ? color : color.hex;
      var rgb = typeof color === 'string' ? TD.parseHex(color) : color.rgb;
      lines.push('  --' + name + '-' + (index + 1) + ': ' + hex + ';');
      lines.push('  --' + name + '-' + (index + 1) + '-rgb: ' + Math.round(rgb.r) + ' ' + Math.round(rgb.g) + ' ' + Math.round(rgb.b) + ';');
    });
    lines.push('}');
    return lines.join('\n') + '\n';
  }

  function paletteToScss(colors, prefix) {
    var name = prefix || 'brand';
    var lines = [];
    colors.forEach(function (color, index) {
      var hex = typeof color === 'string' ? color : color.hex;
      lines.push('$' + name + '-' + (index + 1) + ': ' + hex + ';');
    });
    return lines.join('\n') + '\n';
  }

  function paletteToTailwind(colors, prefix) {
    var name = prefix || 'brand';
    var lines = ['/** tailwind.config.js */', 'module.exports = {', '  theme: {', '    extend: {', '      colors: {', '        ' + name + ': {'];
    colors.forEach(function (color, index) {
      var hex = typeof color === 'string' ? color : color.hex;
      lines.push("          '" + (index + 1) + "00': '" + hex + "',");
    });
    lines.push('        }');
    lines.push('      }');
    lines.push('    }');
    lines.push('  }');
    lines.push('};');
    return lines.join('\n') + '\n';
  }

  function paletteToJson(colors, meta) {
    var list = colors.map(function (color) {
      var rgb = typeof color === 'string' ? TD.parseHex(color) : color.rgb;
      var hex = typeof color === 'string' ? color : color.hex;
      var hsl = TD.rgbToHsl(rgb);
      var entry = {
        hex: hex,
        rgb: [Math.round(rgb.r), Math.round(rgb.g), Math.round(rgb.b)],
        hsl: [Math.round(hsl.h), Math.round(hsl.s), Math.round(hsl.l)],
        luminance: TD.round(TD.relativeLuminance(rgb), 4),
        contrastOnWhite: TD.contrastRatio(rgb, { r: 255, g: 255, b: 255, a: 1 }),
        contrastOnBlack: TD.contrastRatio(rgb, { r: 0, g: 0, b: 0, a: 1 })
      };
      if (color.share !== undefined) entry.share = color.share;
      if (color.nameKey) entry.name = color.nameKey;
      return entry;
    });
    return JSON.stringify({ app: 'Palette Studio', generator: meta || 'TekiDeki', colors: list }, null, 2) + '\n';
  }

  function paletteToSvg(colors, options) {
    var opts = options || {};
    var swatch = opts.swatch || 120;
    var count = Math.max(1, colors.length);
    var width = swatch * count;
    var height = swatch + 44;
    var rects = colors.map(function (color, index) {
      var hex = typeof color === 'string' ? color : color.hex;
      var rgb = typeof color === 'string' ? TD.parseHex(color) : color.rgb;
      /* Label colour follows the swatch, so the exported SVG stays readable. */
      var readable = TD.contrastRatio(rgb, { r: 255, g: 255, b: 255, a: 1 }) >= 3 ? '#ffffff' : '#10151c';
      return '<rect x="' + (index * swatch) + '" y="0" width="' + swatch + '" height="' + swatch + '" fill="' + hex + '"/>'
        + '<text x="' + (index * swatch + 10) + '" y="' + (swatch - 12) + '" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="15" fill="' + readable + '">'
        + hex + '</text>';
    }).join('');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Palette">'
      + '<rect width="' + width + '" height="' + height + '" fill="#f5f6f8"/>'
      + rects + '</svg>\n';
  }

  TD.makeRandom = makeRandom;
  TD.samplePixels = samplePixels;
  TD.quantize = quantize;
  TD.kmeans = kmeans;
  TD.extractPalette = extractPalette;
  TD.NAMED_COLORS = NAMED_COLORS;
  TD.nearestColorName = nearestColorName;
  TD.gradientCss = gradientCss;
  TD.gradientSvg = gradientSvg;
  TD.shadeScale = shadeScale;
  TD.paletteToCssVars = paletteToCssVars;
  TD.paletteToScss = paletteToScss;
  TD.paletteToTailwind = paletteToTailwind;
  TD.paletteToJson = paletteToJson;
  TD.paletteToSvg = paletteToSvg;

  if (typeof module !== 'undefined' && module.exports) module.exports = TD;
})(typeof window !== 'undefined' ? window : global);
