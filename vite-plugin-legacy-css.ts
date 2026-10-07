import { Plugin } from 'vite';

// OKLCH / OKLAB to sRGB Conversion
function oklchToHexOrRgb(val: string): string {
  const m = val.match(/oklch\(\s*([\d.]+)%\s+([-\d.]+)\s+([-\d.]+?)(?:\/([\d.]+))?\s*\)/) ||
            val.match(/oklch\(\s*([\d.]+)\s+([-\d.]+)\s+([-\d.]+?)(?:\/([\d.]+))?\s*\)/);
  if (!m) return val;

  let l = parseFloat(m[1]);
  if (val.includes('%')) l /= 100.0;
  const c = parseFloat(m[2]);
  const h = parseFloat(m[3]);
  const alpha = m[4] !== undefined ? parseFloat(m[4]) : 1.0;

  const rad = (h * Math.PI) / 180.0;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  const r_lin = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const g_lin = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const b_lin = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  const toSrgb = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

  const r = Math.min(255, Math.max(0, Math.round(toSrgb(r_lin) * 255)));
  const g = Math.min(255, Math.max(0, Math.round(toSrgb(g_lin) * 255)));
  const bVal = Math.min(255, Math.max(0, Math.round(toSrgb(b_lin) * 255)));

  if (alpha < 1.0) {
    const aHex = Math.round(alpha * 255).toString(16).padStart(2, '0');
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bVal.toString(16).padStart(2, '0')}${aHex}`;
  }
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bVal.toString(16).padStart(2, '0')}`;
}

function oklabToHexOrRgb(val: string): string {
  const m = val.match(/oklab\(\s*([\d.]+)%\s+([-\d.]+)\s+([-\d.]+?)(?:\/([\d.]+))?\s*\)/) ||
            val.match(/oklab\(\s*([\d.]+)\s+([-\d.]+)\s+([-\d.]+?)(?:\/([\d.]+))?\s*\)/);
  if (!m) return val;

  let l = parseFloat(m[1]);
  if (val.includes('%')) l /= 100.0;
  const a = parseFloat(m[2]);
  const b = parseFloat(m[3]);
  const alpha = m[4] !== undefined ? parseFloat(m[4]) : 1.0;

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  const r_lin = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const g_lin = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const b_lin = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  const toSrgb = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

  const r = Math.min(255, Math.max(0, Math.round(toSrgb(r_lin) * 255)));
  const g = Math.min(255, Math.max(0, Math.round(toSrgb(g_lin) * 255)));
  const bVal = Math.min(255, Math.max(0, Math.round(toSrgb(b_lin) * 255)));

  if (alpha < 1.0) {
    const aHex = Math.round(alpha * 255).toString(16).padStart(2, '0');
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bVal.toString(16).padStart(2, '0')}${aHex}`;
  }
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bVal.toString(16).padStart(2, '0')}`;
}

const knownColorVars: Record<string, [number, number, number]> = {
  'var(--color-white)': [255, 255, 255],
  'var(--color-black)': [0, 0, 0],
  'var(--color-red-300)': [252, 165, 165],
  'var(--color-red-500)': [239, 68, 68],
  'var(--color-red-600)': [220, 38, 38],
  'var(--color-red-900)': [127, 29, 29],
  'var(--color-red-950)': [69, 10, 10],
  'var(--color-amber-500)': [245, 158, 11],
  'var(--color-amber-950)': [69, 26, 3],
  'var(--color-emerald-400)': [52, 211, 153],
  'var(--color-emerald-500)': [16, 185, 129],
  'var(--color-emerald-950)': [2, 44, 34],
  'var(--color-cyan-500)': [6, 182, 212],
  'var(--color-rose-500)': [244, 63, 94],
  'var(--color-zinc-800)': [39, 39, 42],
};

function evalSingleColorMix(cmExpr: string): string {
  const m = cmExpr.match(/^color-mix\(\s*in\s+\w+,\s*([^,]+?)\s+([\d.]+%|var\(--tw-shadow-alpha\)),\s*transparent\s*\)$/);
  if (m) {
    const colorStr = m[1].trim();
    const pctStr = m[2].trim();
    let pct = 1.0;
    if (pctStr.endsWith('%')) {
      pct = parseFloat(pctStr.slice(0, -1)) / 100.0;
    }

    let r = 255, g = 255, b = 255;
    if (knownColorVars[colorStr]) {
      [r, g, b] = knownColorVars[colorStr];
    } else if (colorStr === 'currentcolor') {
      [r, g, b] = [255, 255, 255];
    } else if (colorStr.startsWith('rgb(') || colorStr.startsWith('rgba(')) {
      const nums = (colorStr.match(/[\d.]+/g) || []).map(Number);
      if (nums.length >= 3) {
        r = nums[0]; g = nums[1]; b = nums[2];
        const origA = nums.length >= 4 ? nums[3] : 1.0;
        pct = pct * origA;
      }
    } else if (colorStr.startsWith('#')) {
      const hexC = colorStr.replace('#', '');
      if (hexC.length === 6) {
        r = parseInt(hexC.slice(0, 2), 16);
        g = parseInt(hexC.slice(2, 4), 16);
        b = parseInt(hexC.slice(4, 6), 16);
      } else if (hexC.length === 8) {
        r = parseInt(hexC.slice(0, 2), 16);
        g = parseInt(hexC.slice(2, 4), 16);
        b = parseInt(hexC.slice(4, 6), 16);
        pct = pct * (parseInt(hexC.slice(6, 8), 16) / 255.0);
      }
    }

    const aHex = Math.round(pct * 255).toString(16).padStart(2, '0');
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}${aHex}`;
  }

  if (cmExpr.includes('red,red')) {
    return 'red';
  }

  return '#ffffff1a';
}

function convertAllColorMixes(text: string): string {
  while (true) {
    const lastCmIdx = text.lastIndexOf('color-mix(');
    if (lastCmIdx === -1) break;

    let depth = 0;
    let endIdx = -1;
    for (let j = lastCmIdx; j < text.length; j++) {
      if (text[j] === '(') depth++;
      else if (text[j] === ')') {
        depth--;
        if (depth === 0) {
          endIdx = j + 1;
          break;
        }
      }
    }
    if (endIdx === -1) break;

    const cmExpr = text.slice(lastCmIdx, endIdx);
    const replacement = evalSingleColorMix(cmExpr);
    text = text.slice(0, lastCmIdx) + replacement + text.slice(endIdx);
  }
  return text;
}

function unwrapLayers(text: string): string {
  while (true) {
    const m = text.match(/@layer\s+[\w,-]+\s*\{/);
    if (!m) {
      text = text.replace(/@layer\s+[\w,-]+;\s*/g, '');
      break;
    }
    const startIdx = m.index!;
    const openBrace = startIdx + m[0].length - 1;
    let depth = 0;
    let endIdx = -1;
    for (let j = openBrace; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') {
        depth--;
        if (depth === 0) {
          endIdx = j;
          break;
        }
      }
    }
    if (endIdx === -1) break;

    const inner = text.slice(openBrace + 1, endIdx);
    text = text.slice(0, startIdx) + inner + text.slice(endIdx + 1);
  }
  return text;
}

export function transformCssForLegacy(css: string): string {
  // 1. Unwrap @layer
  css = unwrapLayers(css);

  // 2. Remove @property blocks
  css = css.replace(/@property\s+[\w-]+\s*\{[^}]*\}/g, '');

  // 3. Convert oklch and oklab to hex/rgb
  css = css.replace(/oklch\([^)]+\)/g, oklchToHexOrRgb);
  css = css.replace(/oklab\([^)]+\)/g, oklabToHexOrRgb);

  // 4. Convert color-mix
  css = convertAllColorMixes(css);

  // 5. Convert logical properties to physical properties
  css = css.replace(/padding-inline-start\s*:\s*([^;}]+)/g, '-webkit-padding-start:$1;padding-left:$1');
  css = css.replace(/padding-inline-end\s*:\s*([^;}]+)/g, '-webkit-padding-end:$1;padding-right:$1');
  css = css.replace(/margin-inline-start\s*:\s*([^;}]+)/g, '-webkit-margin-start:$1;margin-left:$1');
  css = css.replace(/margin-inline-end\s*:\s*([^;}]+)/g, '-webkit-margin-end:$1;margin-right:$1');
  css = css.replace(/padding-inline\s*:\s*([^;}]+)/g, 'padding-left:$1;padding-right:$1');
  css = css.replace(/padding-block\s*:\s*([^;}]+)/g, 'padding-top:$1;padding-bottom:$1');
  css = css.replace(/margin-inline\s*:\s*([^;}]+)/g, 'margin-left:$1;margin-right:$1');
  css = css.replace(/margin-block\s*:\s*([^;}]+)/g, 'margin-top:$1;margin-bottom:$1');
  css = css.replace(/margin-block-start\s*:\s*([^;}]+)/g, 'margin-top:$1');
  css = css.replace(/margin-block-end\s*:\s*([^;}]+)/g, 'margin-bottom:$1');

  return css;
}

export function legacyCssPlugin(): Plugin {
  return {
    name: 'legacy-css-plugin',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const fileName in bundle) {
        if (fileName.endsWith('.css')) {
          const chunk = bundle[fileName];
          if (chunk.type === 'asset' && typeof chunk.source === 'string') {
            chunk.source = transformCssForLegacy(chunk.source);
          }
        }
      }
    },
    transformIndexHtml(html: string) {
      // Remove crossorigin from <link rel="stylesheet"> for Safari 10 compatibility
      return html.replace(/<link\s+rel="stylesheet"\s+crossorigin\s+href="([^"]+)">/g, '<link rel="stylesheet" href="$1">');
    },
  };
}
