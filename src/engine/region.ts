import type { Region } from '../types';

export function pointInPolygon(pts: { x: number; y: number }[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * 点(x,y)を通る水平線と領域ポリゴンの交差から、
 * その高さでの服の中心xと半幅を求める(円筒フィット用)。
 */
export function horizontalSpanAt(
  region: Region,
  x: number,
  y: number,
): { cx: number; r: number } | null {
  const pts = region.pts;
  const xs: number[] = [];
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const yi = pts[i].y;
    const yj = pts[j].y;
    if (yi > y !== yj > y) {
      xs.push(pts[i].x + ((y - yi) / (yj - yi)) * (pts[j].x - pts[i].x));
    }
  }
  if (xs.length < 2) return null;
  xs.sort((a, b) => a - b);
  // 点を挟む区間を探す
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (x >= xs[i] - 1 && x <= xs[i + 1] + 1) {
      return { cx: (xs[i] + xs[i + 1]) / 2, r: (xs[i + 1] - xs[i]) / 2 };
    }
  }
  return null;
}

/** アンカー位置を含む領域から円筒(中心x・半径)を推定する */
export function regionCylinderAt(
  regions: Region[],
  x: number,
  y: number,
): { cx: number; r: number } | null {
  for (const region of regions) {
    if (region.pts.length < 3) continue;
    if (!pointInPolygon(region.pts, x, y)) continue;
    const span = horizontalSpanAt(region, x, y);
    if (span && span.r > 2) return span;
  }
  return null;
}
