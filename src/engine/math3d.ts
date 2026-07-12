import type { CameraAngle } from '../types';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

const D2R = Math.PI / 180;

/**
 * 座標系:
 * - ビュー空間: x=右, y=下(画像座標と一致), z=+が手前(カメラ側)
 * - ワールド空間: カメラ角度 0,0 のときビュー空間と一致
 * - 変換: view = Ry(azimuth) · Rx(elevation) · world
 */
export function worldToView(p: V3, cam: CameraAngle): V3 {
  const a = cam.azimuth * D2R;
  const e = cam.elevation * D2R;
  // Rx(elevation)
  const y1 = p.y * Math.cos(e) - p.z * Math.sin(e);
  const z1 = p.y * Math.sin(e) + p.z * Math.cos(e);
  // Ry(azimuth)
  const x2 = p.x * Math.cos(a) + z1 * Math.sin(a);
  const z2 = -p.x * Math.sin(a) + z1 * Math.cos(a);
  return { x: x2, y: y1, z: z2 };
}

/** worldToView の逆変換 */
export function viewToWorld(p: V3, cam: CameraAngle): V3 {
  const a = cam.azimuth * D2R;
  const e = cam.elevation * D2R;
  // Ry(-azimuth)
  const x1 = p.x * Math.cos(a) - p.z * Math.sin(a);
  const z1 = p.x * Math.sin(a) + p.z * Math.cos(a);
  // Rx(-elevation)
  const y2 = p.y * Math.cos(e) + z1 * Math.sin(e);
  const z2 = -p.y * Math.sin(e) + z1 * Math.cos(e);
  return { x: x1, y: y2, z: z2 };
}

/** ワールド空間での「カメラへ向かう」単位ベクトル */
export function cameraDirWorld(cam: CameraAngle): V3 {
  return viewToWorld({ x: 0, y: 0, z: 1 }, cam);
}

export function add(a: V3, b: V3): V3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
export function sub(a: V3, b: V3): V3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function scale(a: V3, s: number): V3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
export function dot(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function cross(a: V3, b: V3): V3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
export function len(a: V3): number {
  return Math.hypot(a.x, a.y, a.z);
}
export function norm(a: V3): V3 {
  const l = len(a);
  return l < 1e-9 ? { x: 0, y: 0, z: 0 } : scale(a, 1 / l);
}
export function lerp(a: V3, b: V3, t: number): V3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}
