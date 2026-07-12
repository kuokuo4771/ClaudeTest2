import { GUIDE_COLORS, GuideLine, GuideSettings, Region } from '../types';

/** 入り抜きテーパー付きリボンを塗りで描画する */
function fillRibbon(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  widths: number[],
): void {
  const n = pts.length;
  if (n < 2) return;
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[Math.min(n - 1, i + 1)];
    let tx = p1.x - p0.x;
    let ty = p1.y - p0.y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const w = Math.max(0.1, widths[i]) / 2;
    // 法線 = 接線を90°回転
    left.push({ x: pts[i].x - ty * w, y: pts[i].y + tx * w });
    right.push({ x: pts[i].x + ty * w, y: pts[i].y - tx * w });
  }
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fill();
}

/** ガイド線を描画する(画像座標系のコンテキストに対して) */
export function drawGuides(
  ctx: CanvasRenderingContext2D,
  guides: GuideLine[],
  settings: GuideSettings,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const g of guides) {
    if (!settings.show[g.type]) continue;
    if (g.pts.length < 2) continue;
    const color = GUIDE_COLORS[g.type];
    ctx.globalAlpha = Math.max(0, Math.min(1, g.alpha * settings.opacity));
    if (g.widths && g.widths.length === g.pts.length) {
      ctx.fillStyle = color;
      fillRibbon(ctx, g.pts, g.widths);
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = g.width;
      ctx.beginPath();
      ctx.moveTo(g.pts[0].x, g.pts[0].y);
      for (let i = 1; i < g.pts.length - 1; i++) {
        const mx = (g.pts[i].x + g.pts[i + 1].x) / 2;
        const my = (g.pts[i].y + g.pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(g.pts[i].x, g.pts[i].y, mx, my);
      }
      const last = g.pts[g.pts.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** 服の領域ポリゴンからマスクキャンバスを作る */
export function buildRegionMask(
  imgW: number,
  imgH: number,
  regions: Region[],
): HTMLCanvasElement | null {
  const valid = regions.filter((r) => r.pts.length >= 3);
  if (valid.length === 0) return null;
  const c = document.createElement('canvas');
  c.width = imgW;
  c.height = imgH;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  for (const r of valid) {
    ctx.beginPath();
    ctx.moveTo(r.pts[0].x, r.pts[0].y);
    for (let i = 1; i < r.pts.length; i++) ctx.lineTo(r.pts[i].x, r.pts[i].y);
    ctx.closePath();
    ctx.fill();
  }
  return c;
}

/** 画像に透明部分があれば、その画像自体をマスクとして使えるか判定する */
export function imageHasAlpha(image: HTMLImageElement): boolean {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(image, 0, 0, s, s);
  try {
    const data = ctx.getImageData(0, 0, s, s).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 128) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * ガイドを画像解像度のレイヤーに描画し、マスクでクリップして返す。
 * mask: 服の領域マスク or 透過画像(アルファをそのまま使う) or null
 */
export function renderGuideLayer(
  imgW: number,
  imgH: number,
  guides: GuideLine[],
  settings: GuideSettings,
  mask: HTMLCanvasElement | HTMLImageElement | null,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = imgW;
  c.height = imgH;
  const ctx = c.getContext('2d')!;
  drawGuides(ctx, guides, settings);
  if (mask && settings.clip) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0, imgW, imgH);
    ctx.globalCompositeOperation = 'source-over';
  }
  return c;
}
