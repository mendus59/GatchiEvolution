// Procedural Gatchi renderer. Everything visible comes from the genome: body
// genes set proportions (so evolution visibly changes the pet), look genes set
// colors, silhouette, pattern and ornaments.
import { decodeBody, decodeLooks, squash } from '../genome.js';
import { Rng, hashString } from '../rng.js';

export function appearance(genome) {
  const b = decodeBody(genome);
  const l = decodeLooks(genome);
  const s = (k) => squash(l[k]);
  // Hues wrap around the color wheel so every color is equally likely and
  // small mutations drift the color gradually.
  const wrap = (x) => ((x * 137.5) % 360 + 360) % 360;
  const hue = wrap(l.hue);
  return {
    b,
    hue,
    hue2: (hue + 60 + s('hue2') * 240) % 360,
    hue3: wrap(l.hue3),
    sat: 40 + 45 * s('sat'),
    light: 52 + 18 * s('light'),
    harmonics: [2, 3, 4, 5].map((k) => ({ k, a: (s('sh' + k) - 0.5) * 0.28 / (k - 1), p: s('ph' + k) * Math.PI * 2 })),
    pattern: Math.floor(s('pattern') * 4),
    patDensity: s('patDensity'),
    patScale: s('patScale'),
    eyes: 1 + Math.min(2, Math.floor(s('eyeCount') * 3)),
    eyeSpread: s('eyeSpread'),
    antenna: s('antenna'),
    ears: Math.floor(s('ears') * 3),
    tail: s('tail'),
    cheeks: s('cheeks'),
    mouth: s('mouth'),
    feet: s('feet'),
    seed: hashString(genome.genes.slice(0, 40).join(',')),
  };
}

function bodyPath(ctx, cx, cy, R, harmonics, wobble) {
  ctx.beginPath();
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * Math.PI * 2;
    let r = 1;
    for (const h of harmonics) r += h.a * Math.cos(h.k * th + h.p);
    r *= 1 + wobble * Math.sin(th * 2);
    const x = cx + Math.cos(th) * R * r;
    const y = cy + Math.sin(th) * R * r * 0.92;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// Draws a Gatchi centred in a size x size box at (x, y) top-left.
export function drawPet(ctx, genome, opts = {}) {
  const { x = 0, y = 0, size = 128, time = 0, mood = 0.7, sleeping = false, stage = 'adult', facing = 0 } = opts;
  const A = opts.look || appearance(genome);
  const b = A.b;
  const rng = new Rng(A.seed);
  const grown = stage === 'egg' ? 0 : stage === 'sprout' ? 0.75 : stage === 'juvenile' ? 0.88 : 1;
  const cx = x + size / 2;
  const R = size * 0.26 * (0.8 + 0.4 * b.size) * (grown || 1);
  const legLen = R * (0.25 + 0.7 * b.limb) * (grown || 1);
  const bob = sleeping ? Math.sin(time * 1.5) * R * 0.03 : Math.abs(Math.sin(time * 3)) * R * 0.06;
  const cy = y + size * 0.88 - legLen - R * 0.92 - bob;
  const main = `hsl(${A.hue} ${A.sat}% ${A.light}%)`;
  const dark = `hsl(${A.hue} ${A.sat}% ${A.light - 22}%)`;
  const belly = `hsl(${A.hue} ${A.sat * 0.6}% ${Math.min(92, A.light + 22)}%)`;
  const accent = `hsl(${A.hue2} ${A.sat}% ${A.light - 8}%)`;
  const wingCol = `hsla(${A.hue3} 70% 80% / 0.85)`;

  if (stage === 'egg') {
    const ey = y + size * 0.55;
    ctx.fillStyle = belly;
    ctx.strokeStyle = dark;
    ctx.lineWidth = size * 0.02;
    ctx.beginPath();
    ctx.ellipse(cx, ey + Math.sin(time * 4) * size * 0.01, size * 0.22, size * 0.29, Math.sin(time * 2) * 0.05, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = accent;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(cx + rng.range(-0.14, 0.14) * size, ey + rng.range(-0.18, 0.2) * size, size * rng.range(0.02, 0.05), 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.ellipse(cx, y + size * 0.9, R * 0.9, R * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tail
  if (A.tail > 0.4) {
    ctx.strokeStyle = dark;
    ctx.lineWidth = R * (0.1 + 0.1 * b.muscle);
    ctx.beginPath();
    const tx = cx - R * 0.85;
    ctx.moveTo(tx + R * 0.2, cy + R * 0.3);
    ctx.quadraticCurveTo(tx - R * 0.5 * A.tail, cy + R * 0.4, tx - R * 0.4, cy - R * (0.2 + 0.4 * A.tail) + Math.sin(time * 4) * R * 0.08);
    ctx.stroke();
  }

  // Legs
  const legW = R * (0.14 + 0.22 * b.muscle);
  ctx.strokeStyle = dark;
  ctx.lineWidth = legW;
  for (const side of [-1, 1]) {
    const lx = cx + side * R * 0.42;
    const step = sleeping ? 0 : Math.sin(time * 6 + (side > 0 ? 0 : Math.PI)) * legLen * 0.12;
    ctx.beginPath();
    ctx.moveTo(lx, cy + R * 0.6);
    ctx.lineTo(lx + step, cy + R * 0.85 + legLen);
    ctx.stroke();
    ctx.fillStyle = dark;
    ctx.beginPath();
    if (A.feet > 0.5) ctx.ellipse(lx + step + side * legW * 0.4, cy + R * 0.88 + legLen, legW * 1.1, legW * 0.55, 0, 0, Math.PI * 2);
    else ctx.arc(lx + step, cy + R * 0.86 + legLen, legW * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  // Wings
  if (b.wing > 0.3) {
    const ws = R * (0.4 + 1.1 * (b.wing - 0.3));
    const flap = sleeping ? 0.1 : Math.sin(time * 9) * 0.35;
    ctx.fillStyle = wingCol;
    ctx.strokeStyle = `hsl(${A.hue3} 50% 55%)`;
    ctx.lineWidth = R * 0.04;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(cx + side * R * 0.75, cy - R * 0.2);
      ctx.rotate(side * (-0.5 + flap));
      ctx.beginPath();
      ctx.ellipse(side * ws * 0.6, -ws * 0.2, ws * 0.7, ws * 0.38, side * -0.4, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  // Ears
  if (A.ears > 0) {
    ctx.fillStyle = main;
    ctx.strokeStyle = dark;
    ctx.lineWidth = R * 0.05;
    for (const side of [-1, 1]) {
      const ex = cx + side * R * 0.5, ey = cy - R * 0.72;
      ctx.beginPath();
      if (A.ears === 1) {
        ctx.moveTo(ex - R * 0.2, ey + R * 0.1);
        ctx.lineTo(ex + side * R * 0.15, ey - R * 0.5);
        ctx.lineTo(ex + R * 0.22, ey + R * 0.12);
      } else {
        ctx.arc(ex, ey - R * 0.05, R * 0.22, 0, Math.PI * 2);
      }
      ctx.fill(); ctx.stroke();
    }
  }

  // Antennae
  if (A.antenna > 0.45) {
    const count = A.antenna > 0.8 ? 1 : 2;
    ctx.strokeStyle = dark;
    ctx.lineWidth = R * 0.05;
    for (let i = 0; i < count; i++) {
      const side = count === 1 ? 0 : i ? 1 : -1;
      const bx = cx + side * R * 0.3, by = cy - R * 0.85;
      const len = R * (0.4 + 0.6 * A.antenna);
      const sway = Math.sin(time * 2.5 + i) * R * 0.1;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + side * len * 0.5, by - len * 0.6, bx + side * len * 0.4 + sway, by - len);
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(bx + side * len * 0.4 + sway, by - len, R * 0.1, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Body
  const wobble = sleeping ? 0.02 * Math.sin(time * 1.5) : 0.015 * Math.sin(time * 6);
  bodyPath(ctx, cx, cy, R, A.harmonics, wobble);
  ctx.fillStyle = main;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Belly
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(cx, cy + R * 0.45, R * 0.62, R * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  // Pattern
  ctx.fillStyle = accent;
  ctx.strokeStyle = accent;
  const count = 3 + Math.floor(A.patDensity * 10);
  if (A.pattern === 1) {
    for (let i = 0; i < count; i++) {
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(cx + rng.range(-1, 1) * R, cy + rng.range(-1, 0.3) * R, R * (0.06 + 0.16 * A.patScale) * rng.range(0.6, 1.2), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (A.pattern === 2) {
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = R * (0.06 + 0.1 * A.patScale);
    for (let i = 0; i < Math.ceil(count / 2); i++) {
      const sx = cx - R + (i + 0.5) * (2 * R / Math.ceil(count / 2));
      ctx.beginPath();
      ctx.moveTo(sx, cy - R);
      ctx.quadraticCurveTo(sx + R * 0.2, cy - R * 0.3, sx, cy + R * 0.1);
      ctx.stroke();
    }
  } else if (A.pattern === 3) {
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < count * 3; i++) {
      ctx.beginPath();
      ctx.arc(cx + rng.range(-1, 1) * R, cy + rng.range(-1, 1) * R, R * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  bodyPath(ctx, cx, cy, R, A.harmonics, wobble);
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(1, R * 0.06);
  ctx.stroke();

  // Face
  const faceX = cx + facing * R * 0.25;
  const eyeY = cy - R * 0.18;
  const eyeR = R * (0.1 + 0.16 * b.eye);
  const spread = R * (0.22 + 0.25 * A.eyeSpread);
  const blink = !sleeping && (Math.floor(time * 10) % 37 === 0);
  const eyeXs = A.eyes === 1 ? [0] : A.eyes === 2 ? [-spread, spread] : [-spread, 0, spread];
  for (let i = 0; i < eyeXs.length; i++) {
    const ex = faceX + eyeXs[i] * (facing ? 0.8 : 1);
    const ey = eyeY - (A.eyes === 3 && i === 1 ? R * 0.18 : 0);
    if (sleeping || blink) {
      ctx.strokeStyle = '#222';
      ctx.lineWidth = R * 0.05;
      ctx.beginPath(); ctx.arc(ex, ey, eyeR * 0.7, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
      continue;
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(ex, ey, eyeR, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = dark; ctx.lineWidth = R * 0.03; ctx.stroke();
    ctx.fillStyle = '#1d1d2b';
    ctx.beginPath(); ctx.arc(ex + facing * eyeR * 0.3, ey + eyeR * 0.1, eyeR * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(ex + eyeR * 0.2, ey - eyeR * 0.2, eyeR * 0.18, 0, Math.PI * 2); ctx.fill();
  }
  if (A.cheeks > 0.5) {
    ctx.fillStyle = 'rgba(255,110,140,0.35)';
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(faceX + side * (spread + eyeR * 0.9), eyeY + eyeR * 1.4, R * 0.12, R * 0.07, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  const mw = R * (0.15 + 0.25 * A.mouth);
  const my = eyeY + eyeR + R * 0.22;
  ctx.strokeStyle = '#2a1d1d';
  ctx.lineWidth = R * 0.05;
  ctx.beginPath();
  if (sleeping) ctx.arc(faceX, my, mw * 0.25, 0, Math.PI * 2);
  else {
    const curve = (mood - 0.5) * R * 0.5;
    ctx.moveTo(faceX - mw, my);
    ctx.quadraticCurveTo(faceX, my + curve, faceX + mw, my);
  }
  ctx.stroke();
  ctx.restore();

  if (sleeping) {
    ctx.fillStyle = 'rgba(60,60,90,0.7)';
    ctx.font = `bold ${Math.round(size * 0.1)}px system-ui`;
    const z = (time * 0.6) % 1;
    ctx.globalAlpha = 1 - z;
    ctx.fillText('z', cx + R * 0.9, cy - R * (0.8 + z));
    ctx.globalAlpha = 1;
  }
}

// A small facing-right sprite for use inside challenges, cropped tight so the
// pet fills its box.
export function makeSprite(genome, stage = 'adult', size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const big = size * 1.6;
  drawPet(c.getContext('2d'), genome, {
    x: -(big - size) / 2, y: -(big - size) * 0.8, size: big,
    time: 0, mood: 0.8, stage: stage === 'egg' ? 'sprout' : stage, facing: 1,
  });
  return c;
}
