import type {
  Anchor,
  CameraAngle,
  Density,
  GuideLine,
  GuideType,
  Material,
} from '../types';
import {
  V3,
  add,
  cameraDirWorld,
  cross,
  dot,
  len,
  lerp,
  norm,
  scale,
  sub,
  viewToWorld,
  worldToView,
} from './math3d';

/** mulberry32 シード付き乱数 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const DENSITY_MUL: Record<Density, number> = {
  simple: 0.5,
  standard: 1,
  detailed: 1.7,
};

interface Ctx {
  cam: CameraAngle;
  imgW: number;
  imgH: number;
  cx: number;
  cy: number;
  depthScale: number;
  u: number; // 画像サイズに対する基準単位
  camDir: V3; // ワールド空間でカメラへ向かう方向
  densityMul: number;
}

/** アンカーの2D座標+深度 → ワールド座標(カメラ角度で逆投影) */
function anchorWorld(a: Anchor, ctx: Ctx): V3 {
  const view: V3 = {
    x: a.x - ctx.cx,
    y: a.y - ctx.cy,
    z: a.depth * ctx.depthScale,
  };
  return viewToWorld(view, ctx.cam);
}

/**
 * 3Dポリラインを投影し、可視セグメントごとに分割して出力する。
 * normals があれば法線とカメラ方向の内積で表裏判定し、裏面をクリップする。
 */
function projectPolyline(
  pts: V3[],
  normals: (V3 | null)[] | null,
  type: GuideType,
  width: number,
  alpha: number,
  ctx: Ctx,
  out: GuideLine[],
): void {
  let current: { x: number; y: number }[] = [];
  const flush = () => {
    if (current.length >= 2) out.push({ type, pts: current, width, alpha });
    current = [];
  };
  for (let i = 0; i < pts.length; i++) {
    const n = normals ? normals[i] : null;
    const visible = !n || dot(n, ctx.camDir) > -0.05;
    if (!visible) {
      flush();
      continue;
    }
    const v = worldToView(pts[i], ctx.cam);
    current.push({ x: v.x + ctx.cx, y: v.y + ctx.cy });
  }
  flush();
}

/**
 * 体の円筒面ヘルパー。
 * アンカーのワールド位置を「円筒表面上の点」とみなし、鉛直軸の円筒を仮定する。
 * アンカーの向き(法線)は、深度0面より手前ならカメラ寄り、という近似で
 * 配置時カメラから見た正面方向(ワールドz+をアンカー側に回した向き)とする。
 */
interface Cylinder {
  axisX: number; // 軸のワールドx
  axisZ: number; // 軸のワールドz
  r: number;
  phi0: number; // アンカーが乗っている周方向角
}

function makeCylinder(aw: V3, r: number): Cylinder {
  // アンカーは円筒の正面(ワールド+z側)に乗っていると仮定
  return { axisX: aw.x, axisZ: aw.z - r, r, phi0: 0 };
}

/** 円筒表面上の点: phi=0が正面(+z)、dx=周方向オフセット角、y=高さ */
function cylPoint(c: Cylinder, phi: number, y: number): { p: V3; n: V3 } {
  const p: V3 = {
    x: c.axisX + c.r * Math.sin(phi),
    y,
    z: c.axisZ + c.r * Math.cos(phi),
  };
  const n: V3 = { x: Math.sin(phi), y: 0, z: Math.cos(phi) };
  return { p, n };
}

/* ============ A. 張力ジワ ============ */
function tensionWrinkles(
  a: Anchor,
  b: Anchor,
  material: Material,
  ctx: Ctx,
  out: GuideLine[],
): void {
  const A = anchorWorld(a, ctx);
  const B = anchorWorld(b, ctx);
  const d3 = len(sub(B, A));
  if (d3 < ctx.u * 10) return;

  // シワ本数: 距離と硬さで決定
  const spacingBase = (50 * material.stiffness + 20) * ctx.u;
  let n = Math.floor(d3 / spacingBase);
  n = Math.max(1, Math.min(14, Math.round(n * ctx.densityMul)));

  // 2点を結ぶ線がカメラ方向とほぼ平行 → ほぼ点に見えるので省略
  const viewA = worldToView(A, ctx.cam);
  const viewB = worldToView(B, ctx.cam);
  const projLen = Math.hypot(viewB.x - viewA.x, viewB.y - viewA.y);
  if (projLen < d3 * 0.18) return;

  const dir = norm(sub(B, A));
  // 中心線に対する垂直方向(できるだけ画面平行に)
  let perp = norm(cross(dir, ctx.camDir));
  if (len(perp) < 1e-6) perp = norm(cross(dir, { x: 0, y: 1, z: 0 }));

  const rand = rng(hashId(a.id + b.id) ^ 0x51a);
  const spread = ctx.u * (10 + material.thickness * 14);
  const width = 1 + material.thickness * 2.5;
  const samples = 14;
  const prevProj: { x: number; y: number }[] = [];

  for (let i = 0; i < n; i++) {
    const off = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2; // -1..1
    // 端の線ほど短く(楕円包絡)
    const lenScale = Math.sqrt(Math.max(0.15, 1 - off * off * 0.8));
    const t0 = 0.5 - lenScale * 0.42;
    const t1 = 0.5 + lenScale * 0.42;
    const jitterPhase = rand() * Math.PI * 2;
    const jitterAmp = ctx.u * 3 * (1 - material.stiffness * 0.6);
    const sag = ctx.u * (2 + material.weight * 6) * (1 - Math.abs(off) * 0.5);
    const lenJitter = (rand() - 0.5) * 0.08;

    const pts: V3[] = [];
    for (let s = 0; s <= samples; s++) {
      const t = t0 + lenJitter + ((t1 - t0) * s) / samples;
      const bell = Math.sin(((t - t0 - lenJitter) / (t1 - t0)) * Math.PI); // 両端0
      let p = lerp(A, B, t);
      // 端を完全には収束させない(本数が少ないとき輪に見えるのを防ぐ)
      p = add(p, scale(perp, off * spread * (0.3 + 0.7 * bell)));
      // 揺らぎ + 重力たわみ
      p = add(p, scale(perp, Math.sin(t * 9 + jitterPhase) * jitterAmp * bell));
      p.y += sag * bell;
      pts.push(p);
    }
    // 投影後の隣接線間隔が詰まりすぎたら省略(密集防止)
    const mid = worldToView(pts[Math.floor(samples / 2)], ctx.cam);
    const prev = prevProj[prevProj.length - 1];
    if (prev && Math.hypot(mid.x - prev.x, mid.y - prev.y) < 3) continue;
    prevProj.push({ x: mid.x, y: mid.y });

    projectPolyline(pts, null, 'tension', width, 0.9 - Math.abs(off) * 0.35, ctx, out);
  }
}

/* ============ B. 圧縮ジワ ============ */
function compressionWrinkles(
  j: Anchor,
  material: Material,
  ctx: Ctx,
  out: GuideLine[],
): void {
  const J = anchorWorld(j, ctx);
  const bend = j.bendAngle;
  if (bend < 5) return;

  let n = Math.ceil(bend / (60 * material.stiffness + 30));
  n = Math.max(1, Math.min(12, Math.round(n * ctx.densityMul)));

  const r = ctx.u * (35 + material.thickness * 35);
  const cyl = makeCylinder(J, r);
  const rand = rng(hashId(j.id) ^ 0xc0);
  const spacing = ctx.u * (7 + material.thickness * 8);
  const width = 1.2 + material.thickness * 2.8;
  const maxPhi = 1.15 + (bend / 180) * 0.45; // 曲げが深いほど回り込む
  const samples = 20;

  for (let i = 0; i < n; i++) {
    const yOff = (i - (n - 1) / 2) * spacing;
    const phiJitter = (rand() - 0.5) * 0.3;
    const arcScale = 1 - Math.abs(i - (n - 1) / 2) / (n + 1);
    // 曲げの内側の折れ線: 端がやや下がる弧
    const bow = ctx.u * (2 + (bend / 180) * 6) * (1 - material.stiffness * 0.5);

    const pts: V3[] = [];
    const normals: V3[] = [];
    for (let s = 0; s <= samples; s++) {
      const phi = (s / samples - 0.5) * 2 * maxPhi * (0.55 + arcScale * 0.45) + phiJitter;
      const { p, n: nn } = cylPoint(cyl, phi, J.y + yOff);
      p.y += bow * phi * phi;
      pts.push(p);
      normals.push(nn);
    }
    projectPolyline(pts, normals, 'compression', width, 0.85, ctx, out);
  }
}

/* ============ C. たまりジワ ============ */
function poolingWrinkles(
  f: Anchor,
  material: Material,
  ctx: Ctx,
  out: GuideLine[],
): void {
  const F = anchorWorld(f, ctx);
  const excess = (40 + material.weight * 60) * ctx.u;
  let n = Math.ceil(excess / ((30 + material.weight * 20) * ctx.u));
  n = Math.max(1, Math.min(8, Math.round(n * ctx.densityMul) + 1));

  const r = ctx.u * (40 + material.thickness * 30);
  const cyl = makeCylinder(F, r);
  const rand = rng(hashId(f.id) ^ 0x9001);
  const spacing = ctx.u * (9 + material.weight * 7);
  const amp = ctx.u * (3 + material.weight * 5);
  const halfPhi = 0.9;
  const width = 1 + material.thickness * 2.2;
  const samples = 26;
  const waveFreq = 2.5 + (1 - material.stiffness) * 2;

  for (let i = 0; i < n; i++) {
    const yOff = -(i + 0.5) * spacing; // 固定点の上に積み上がる
    const phase = rand() * Math.PI * 2;
    const pts: V3[] = [];
    const normals: V3[] = [];
    for (let s = 0; s <= samples; s++) {
      const phi = (s / samples - 0.5) * 2 * halfPhi;
      // 硬い布は三角波寄り、柔らかい布は正弦波寄り
      const arg = phi * waveFreq * Math.PI + phase + i * 0.8;
      const sine = Math.sin(arg);
      const tri = (2 / Math.PI) * Math.asin(Math.sin(arg));
      const wave = sine * (1 - material.stiffness) + tri * material.stiffness;
      const { p, n: nn } = cylPoint(cyl, phi, F.y + yOff + wave * amp);
      pts.push(p);
      normals.push(nn);
    }
    projectPolyline(pts, normals, 'pooling', width, 0.8, ctx, out);
  }
}

/* ============ D. 落ちジワ ============ */
function drapeWrinkles(
  s: Anchor,
  material: Material,
  ctx: Ctx,
  out: GuideLine[],
): void {
  const S = anchorWorld(s, ctx);
  const rand = rng(hashId(s.id) ^ 0xd4a9);
  let count = 3 + Math.round(material.weight * 2);
  count = Math.max(2, Math.min(7, Math.round(count * ctx.densityMul)));

  const r = ctx.u * (45 + material.thickness * 30);
  const cyl = makeCylinder(S, r);
  const length = ctx.u * (80 + material.weight * 110);
  const width = 1 + material.thickness * 2.5;
  const samples = 18;

  for (let k = 0; k < count; k++) {
    const spreadDir = (k / (count - 1) - 0.5) * 2; // -1..1
    const spreadRand = spreadDir + (rand() - 0.5) * 0.35; // 左右非対称
    const maxPhi = spreadRand * (0.55 + material.weight * 0.25);
    const lenK = length * (0.7 + rand() * 0.45);
    // weightが高いほど急角度で垂れる = 早く垂直になる
    const straighten = 1.5 + material.weight * 2;

    const pts: V3[] = [];
    const normals: V3[] = [];
    for (let t = 0; t <= samples; t++) {
      const tt = t / samples;
      // カテナリー近似: 最初は放射状に広がり、次第に垂直へ
      const lateral = maxPhi * (1 - Math.exp(-tt * straighten)) / (1 - Math.exp(-straighten));
      const phi = lateral;
      const yDrop = lenK * (tt * 0.3 + tt * tt * 0.7);
      const { p, n: nn } = cylPoint(cyl, phi, S.y + yDrop);
      pts.push(p);
      normals.push(nn);
    }
    projectPolyline(pts, normals, 'drape', width, 0.8 - Math.abs(spreadDir) * 0.2, ctx, out);
  }
}

/* ============ エントリポイント ============ */
export function generateGuides(
  anchors: Anchor[],
  material: Material,
  cam: CameraAngle,
  imgW: number,
  imgH: number,
  density: Density,
): GuideLine[] {
  const ctx: Ctx = {
    cam,
    imgW,
    imgH,
    cx: imgW / 2,
    cy: imgH / 2,
    depthScale: imgW * 0.3,
    u: Math.max(imgW, imgH) / 700,
    camDir: cameraDirWorld(cam),
    densityMul: DENSITY_MUL[density],
  };
  const out: GuideLine[] = [];

  const fixed = anchors.filter((a) => a.kind === 'fixed');
  const joints = anchors.filter((a) => a.kind === 'joint');
  const supports = anchors.filter((a) => a.kind === 'support');

  // 張力ジワ: 固定点の全ペア
  for (let i = 0; i < fixed.length; i++) {
    for (let j = i + 1; j < fixed.length; j++) {
      tensionWrinkles(fixed[i], fixed[j], material, ctx, out);
    }
  }
  // 圧縮ジワ: 各関節点
  for (const j of joints) compressionWrinkles(j, material, ctx, out);
  // たまりジワ: 各固定点の上
  for (const f of fixed) poolingWrinkles(f, material, ctx, out);
  // 落ちジワ: 各支持点
  for (const s of supports) drapeWrinkles(s, material, ctx, out);

  return out;
}
