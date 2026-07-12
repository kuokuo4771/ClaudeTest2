import { GUIDE_COLORS, GuideLine, GuideSettings } from '../types';

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
    ctx.strokeStyle = GUIDE_COLORS[g.type];
    ctx.globalAlpha = Math.max(0, Math.min(1, g.alpha * settings.opacity));
    ctx.lineWidth = g.width;
    ctx.beginPath();
    ctx.moveTo(g.pts[0].x, g.pts[0].y);
    // 中点quadratic補間でなめらかに
    for (let i = 1; i < g.pts.length - 1; i++) {
      const mx = (g.pts[i].x + g.pts[i + 1].x) / 2;
      const my = (g.pts[i].y + g.pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(g.pts[i].x, g.pts[i].y, mx, my);
    }
    const last = g.pts[g.pts.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
  ctx.restore();
}
