import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import * as fontkit from 'fontkit';
import { writeFileSync } from 'node:fs';

const F = {
  mlym: '/usr/share/fonts/truetype/noto/NotoSansMalayalam-Regular.ttf',
  arab: '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
  latn: '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
};
// Explicit registration by path — the shipped pattern, no fontconfig lookup.
GlobalFonts.registerFromPath(F.mlym, 'SpikeMlym');
GlobalFonts.registerFromPath(F.arab, 'SpikeArab');
GlobalFonts.registerFromPath(F.latn, 'SpikeLatn');

const CASES = [
  { id: '1-mlym-reorder', family: 'SpikeMlym', text: 'കേരള മീൻ കറി',
    note: 'pre-base vowel sign േ must render BEFORE ക; ൻ chillu' },
  { id: '2-mlym-conjunct', family: 'SpikeMlym', text: 'ചിക്കൻ ബിരിയാണി',
    note: 'ക്ക conjunct ligature; ി signs; ൻ chillu' },
  { id: '3-arab-join', family: 'SpikeArab', text: 'برياني الدجاج',
    note: 'contextual joining, RTL' },
  { id: '4-bidi-mixed', family: 'SpikeArab', text: 'عرض خاص 49 درهم',
    note: 'Latin digits inside Arabic — bidi order' },
  { id: '5-tofu-control', family: 'SpikeLatn', text: 'കേരള മീൻ',
    note: 'CONTROL: Malayalam in a Latin font — must look broken' },
];

// Coverage is a cmap question, not a renderer question.
const cmaps = Object.fromEntries(Object.entries(F).map(([k, p]) => {
  const f = fontkit.openSync(p);
  return [k, (cp) => f.hasGlyphForCodePoint(cp)];
}));
function uncovered(text, script) {
  return [...text].map(c => c.codePointAt(0))
    .filter(cp => cp !== 0x20 && !cmaps[script](cp))
    .map(cp => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'));
}

const W = 1000, H = 150;
for (const c of CASES) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#111'; ctx.font = `64px ${c.family}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(c.text, 40, H / 2);
  writeFileSync(`${c.id}.png`, canvas.toBuffer('image/png'));
  const w = ctx.measureText(c.text).width;
  console.log(`${c.id.padEnd(18)} width=${w.toFixed(0).padStart(4)}  ${c.note}`);
}
console.log('\n--- coverage check (fontkit cmap) ---');
console.log('Malayalam text in Malayalam font :', uncovered('കേരള മീൻ കറി', 'mlym').join(',') || 'fully covered');
console.log('Malayalam text in Latin font     :', uncovered('കേരള മീൻ', 'latn').join(',') || 'fully covered');
console.log('Arabic text in Arabic font       :', uncovered('برياني الدجاج', 'arab').join(',') || 'fully covered');
