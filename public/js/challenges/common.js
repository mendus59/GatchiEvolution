// Shared constants and drawing helpers for challenges. Simulations run in a
// fixed 480x270 world at 60 ticks per second, headless during training.

export const W = 480;
export const H = 270;
export const DT = 1 / 60;

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const approach = (v, target, maxDelta) =>
  v < target ? Math.min(target, v + maxDelta) : Math.max(target, v - maxDelta);

export function drawSprite(ctx, sprite, x, y, size, opts = {}) {
  if (!sprite) {
    ctx.fillStyle = '#f6a';
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  if (opts.rot) ctx.rotate(opts.rot);
  const sx = (opts.flip ? -1 : 1) * (opts.stretchX ?? 1);
  const sy = opts.stretchY ?? 1;
  ctx.scale(sx, sy);
  ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
  ctx.restore();
}

export function sky(ctx, top = '#bfe3ff', bottom = '#eef8ff') {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

export function hud(ctx, left, right = '', color = 'rgba(0,0,0,0.65)') {
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.fillText(left, 10, 18);
  if (right) {
    ctx.textAlign = 'right';
    ctx.fillText(right, W - 10, 18);
  }
  ctx.textAlign = 'left';
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
