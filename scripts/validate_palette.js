const NORMAL_FLOOR = 15;
const CVD_FLOOR = 6;
const CVD_TARGET = 8;

const CVD_MATRICES = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function hexToRgb(hex) {
  if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) {
    throw new Error("invalid_hex_color");
  }
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function srgbToLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function linearRgb(hex) {
  const rgb = hexToRgb(hex);
  return [
    srgbToLinear(rgb.r),
    srgbToLinear(rgb.g),
    srgbToLinear(rgb.b),
  ];
}

function simulateLinear(linear, mode) {
  const matrix = CVD_MATRICES[mode];
  if (!matrix) throw new Error("invalid_cvd_mode");
  return matrix.map((row) => Math.max(0, Math.min(1,
    row.reduce((sum, coefficient, index) => sum + coefficient * linear[index], 0),
  )));
}

function simulateCvd(rgb, mode) {
  const linear = [
    srgbToLinear(rgb.r),
    srgbToLinear(rgb.g),
    srgbToLinear(rgb.b),
  ];
  const simulated = simulateLinear(linear, mode);
  return { r: simulated[0], g: simulated[1], b: simulated[2] };
}

function oklabFromLinear([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function deltaEOklab(first, second, mode) {
  const firstLinear = linearRgb(first);
  const secondLinear = linearRgb(second);
  const firstLab = oklabFromLinear(
    mode ? simulateLinear(firstLinear, mode) : firstLinear,
  );
  const secondLab = oklabFromLinear(
    mode ? simulateLinear(secondLinear, mode) : secondLinear,
  );
  return 100 * Math.hypot(
    firstLab[0] - secondLab[0],
    firstLab[1] - secondLab[1],
    firstLab[2] - secondLab[2],
  );
}

function pairDistances(colors, mode) {
  const pairs = [];
  for (let first = 0; first < colors.length; first += 1) {
    for (let second = first + 1; second < colors.length; second += 1) {
      pairs.push({
        pair: [first + 1, second + 1],
        distance: Number(deltaEOklab(colors[first], colors[second], mode).toFixed(2)),
      });
    }
  }
  return pairs;
}

function validatePalette(theme, colors) {
  const failures = [];
  const warnings = [];
  for (const { pair, distance } of pairDistances(colors)) {
    if (distance < NORMAL_FLOOR) {
      failures.push({
        theme,
        mode: "normal",
        pair,
        distance,
        floor: NORMAL_FLOOR,
      });
    }
  }
  for (const mode of ["protanopia", "deuteranopia"]) {
    for (const { pair, distance } of pairDistances(colors, mode)) {
      if (distance < CVD_FLOOR) {
        failures.push({ theme, mode, pair, distance, floor: CVD_FLOOR });
      } else if (distance < CVD_TARGET) {
        warnings.push({ theme, mode, pair, distance, floor: CVD_TARGET });
      }
    }
  }
  for (const { pair, distance } of pairDistances(colors, "tritanopia")) {
    if (distance < CVD_TARGET) {
      warnings.push({
        theme,
        mode: "tritanopia",
        pair,
        distance,
        floor: CVD_TARGET,
      });
    }
  }
  return { valid: failures.length === 0, failures, warnings };
}

function palettesFromCss(source) {
  const blocks = [...source.matchAll(/:root(?:\[data-theme="(light|dark)"\])?\s*\{([^}]+)\}/g)];
  const palettes = {};
  for (const [, explicitTheme, body] of blocks) {
    const theme = explicitTheme || "light";
    const colors = [];
    for (let index = 1; index <= 7; index += 1) {
      const match = body.match(new RegExp(`--viz-${index}:\\s*(#[0-9a-f]{6})`, "i"));
      if (!match) break;
      colors.push(match[1].toLowerCase());
    }
    if (colors.length === 7) palettes[theme] = colors;
  }
  return palettes;
}

async function runCli(path) {
  const { readFileSync } = await import("node:fs");
  const palettes = palettesFromCss(readFileSync(path, "utf8"));
  if (Object.keys(palettes).length !== 2) {
    console.error("palette_validation_error: expected light and dark palettes");
    return 1;
  }
  const results = Object.entries(palettes).map(([theme, colors]) =>
    validatePalette(theme, colors),
  );
  const failures = results.flatMap((result) => result.failures);
  const warnings = results.flatMap((result) => result.warnings);
  for (const warning of warnings) {
    console.warn(
      `${warning.theme} ${warning.mode} viz-${warning.pair[0]}/viz-${warning.pair[1]} distance=${warning.distance} target=${warning.floor}`,
    );
  }
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(
        `${failure.theme} ${failure.mode} viz-${failure.pair[0]}/viz-${failure.pair[1]} distance=${failure.distance} floor=${failure.floor}`,
      );
    }
    return 1;
  }
  console.log("palette validation passed for light and dark themes");
  return 0;
}

module.exports = {
  deltaEOklab,
  hexToRgb,
  palettesFromCss,
  simulateCvd,
  validatePalette,
};

if (require.main === module) {
  runCli(process.argv[2] || "app/globals.css").then((exitCode) => {
    process.exitCode = exitCode;
  });
}
