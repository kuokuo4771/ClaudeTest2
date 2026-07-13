import type {
  Anchor,
  CameraAngle,
  Density,
  GuideLine,
  GuideType,
  Material,
  Region,
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
import { pointInPolygon, regionCylinderAt } from './region';

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
  regions: Region[];
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

/** 入り抜きテーパーの幅配列(端が細く中央が太い、筆致風) */
function taperWidths(n: number, baseW: number, bias = 0.5): number[] {
  const ws: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    // biasで太さのピーク位置をずらせる(0.5=中央)
    const s =
      t <= bias
        ? Math.sin((Math.PI / 2) * (t / bias))
        : Math.sin((Math.PI / 2) * ((1 - t) / (1 - bias)));
    ws.push(baseW * (0.08 + 0.92 * Math.pow(Math.max(0, s), 0.8)));
  }
  return ws;
}

/**
 * 3Dポリラインを投影し、可視セグメントごとに分割して出力する。
 * normals があれば法線とカメラ方向の内積で表裏判定し、裏面をクリップする。
 */
function projectPolyline(
  pts: V3[],
  widths: number[] | null,
  normals: (V3 | null)[] | null,
  type: GuideType,
  baseWidth: number,
  alpha: number,
  ctx: Ctx,
  out: GuideLine[],
): void {
  let curPts: { x: number; y: number }[] = [];
  let curW: number[] = [];
  const flush = () => {
    if (curPts.length >= 2) {
      out.push({
        type,
        pts: curPts,
        width: baseWidth,
        alpha,
        widths: widths ? curW : undefined,
      });
    }
    curPts = [];
    curW = [];
  };
  for (let i = 0; i < pts.length; i++) {
    const n = normals ? normals[i] : null;
    const visible = !n || dot(n, ctx.camDir) > -0.05;
    if (!visible) {
      flush();
      continue;
    }
    const v = worldToView(pts[i], ctx.cam);
    curPts.push({ x: v.x + ctx.cx, y: v.y + ctx.cy });
    if (widths) curW.push(widths[i]);
  }
  flush();
}

/**
 * 体の円筒面ヘルパー。鉛直軸の円筒を仮定する。
 * 服の領域が指定されていれば、その高さでの服の幅に半径・中心をフィットさせる。
 */
interface Cylinder {
  axisX: number;
  axisZ: number;
  r: number;
  phi0: number; // アンカーが乗っている周方向角
}

/** アンカーに合わせた円筒。regionsがあれば服の幅から半径と中心を推定 */
function fitCylinder(a: Anchor, aw: V3, fallbackR: number, ctx: Ctx): Cylinder {
  const span = regionCylinderAt(ctx.regions, a.x, a.y);
  let r = fallbackR;
  let phi0 = 0;
  if (span) {
    r = Math.min(Math.max(span.r * 0.95, ctx.u * 8), ctx.u * 250);
    // アンカーが服の中心からずれている分を周方向角に変換
    const off = (a.x - span.cx) / r;
    phi0 = Math.asin(Math.min(0.95, Math.max(-0.95, off)));
  }
  return {
    axisX: aw.x - r * Math.sin(phi0),
    axisZ: aw.z - r * Math.cos(phi0),
    r,
    phi0,
  };
}

/** 円筒表面上の点: phi=0が正面(+z) */
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

  const spacingBase = (50 * material.stiffness + 20) * ctx.u;
  let n = Math.floor(d3 / spacingBase);
  n = Math.max(1, Math.min(14, Math.round(n * ctx.densityMul)));

  // 2点を結ぶ線がカメラ方向とほぼ平行 → ほぼ点に見えるので省略
  const viewA = worldToView(A, ctx.cam);
  const viewB = worldToView(B, ctx.cam);
  const projLen = Math.hypot(viewB.x - viewA.x, viewB.y - viewA.y);
  if (projLen < d3 * 0.18) return;

  const dir = norm(sub(B, A));
  let perp = norm(cross(dir, ctx.camDir));
  if (len(perp) < 1e-6) perp = norm(cross(dir, { x: 0, y: 1, z: 0 }));

  const rand = rng(hashId(a.id + b.id) ^ 0x51a);
  const spread = ctx.u * (9 + material.thickness * 12);
  const baseW = ctx.u * (1.6 + material.thickness * 3);
  const samples = 14;
  const prevProj: { x: number; y: number }[] = [];

  for (let i = 0; i < n; i++) {
    const off = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2; // -1..1
    const lenScale = Math.sqrt(Math.max(0.15, 1 - off * off * 0.8));
    const t0 = 0.5 - lenScale * 0.42;
    const t1 = 0.5 + lenScale * 0.42;
    const jitterPhase = rand() * Math.PI * 2;
    const jitterAmp = ctx.u * 3 * (1 - material.stiffness * 0.6);
    const sag = ctx.u * (2 + material.weight * 6) * (1 - Math.abs(off) * 0.5);
    const lenJitter = (rand() - 0.5) * 0.08;

    const hook = (rand() > 0.5 ? 1 : -1) * ctx.u * (2 + rand() * 3);
    const pts: V3[] = [];
    for (let s = 0; s <= samples; s++) {
      const t = t0 + lenJitter + ((t1 - t0) * s) / samples;
      const bell = Math.sin(((t - t0 - lenJitter) / (t1 - t0)) * Math.PI);
      let p = lerp(A, B, t);
      p = add(p, scale(perp, off * spread * (0.3 + 0.7 * bell)));
      p = add(p, scale(perp, Math.sin(t * 9 + jitterPhase) * jitterAmp * bell));
      // 終端の抜きハネ(手描き風に少し曲げる)
      const tt = s / samples;
      if (tt > 0.8) p = add(p, scale(perp, hook * Math.pow((tt - 0.8) / 0.2, 2)));
      p.y += sag * bell;
      pts.push(p);
    }
    const mid = worldToView(pts[Math.floor(samples / 2)], ctx.cam);
    const prev = prevProj[prevProj.length - 1];
    if (prev && Math.hypot(mid.x - prev.x, mid.y - prev.y) < 3) continue;
    prevProj.push({ x: mid.x, y: mid.y });

    // 入り抜き: 引っ張り元(A側)がやや太い
    const widths = taperWidths(pts.length, baseW * (1 - Math.abs(off) * 0.35), 0.38);
    const alpha = 0.92 - Math.abs(off) * 0.35;
    projectPolyline(pts, widths, null, 'tension', baseW, alpha, ctx, out);

    // Y字分岐: 柔らかい布ほど発生しやすい
    if (rand() < (1 - material.stiffness) * 0.55 && lenScale > 0.5) {
      const bt = 0.3 + rand() * 0.4;
      const k = Math.round(bt * samples);
      const start = pts[k];
      const branchDir = norm(
        add(scale(dir, 0.8), scale(perp, (rand() > 0.5 ? 1 : -1) * (0.4 + rand() * 0.3))),
      );
      const bl = d3 * (0.08 + rand() * 0.07);
      const bPts: V3[] = [];
      const bSamples = 6;
      for (let s = 0; s <= bSamples; s++) {
        const t = s / bSamples;
        bPts.push(add(start, scale(branchDir, bl * t)));
      }
      projectPolyline(
        bPts,
        taperWidths(bPts.length, baseW * 0.6, 0.25),
        null,
        'tension',
        baseW * 0.6,
        alpha * 0.8,
        ctx,
        out,
      );
    }
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

  const fallbackR = ctx.u * (30 + material.thickness * 25);
  const cyl = fitCylinder(j, J, fallbackR, ctx);
  const rand = rng(hashId(j.id) ^ 0xc0);
  const spacing = Math.min(ctx.u * (7 + material.thickness * 8), (cyl.r * 1.6) / Math.max(2, n));
  const baseW = ctx.u * (1.8 + material.thickness * 3.2);
  const maxPhi = 1.1 + (bend / 180) * 0.4;
  const samples = 20;

  for (let i = 0; i < n; i++) {
    const yOff = (i - (n - 1) / 2) * spacing;
    const phiJitter = (rand() - 0.5) * 0.25;
    const centerIdx = Math.abs(i - (n - 1) / 2);
    const arcScale = 1 - centerIdx / (n + 1);
    const bow = ctx.u * (2 + (bend / 180) * 6) * (1 - material.stiffness * 0.5);

    const pts: V3[] = [];
    const normals: V3[] = [];
    for (let s = 0; s <= samples; s++) {
      const rel = (s / samples - 0.5) * 2; // -1..1
      const phi = cyl.phi0 + rel * maxPhi * (0.55 + arcScale * 0.45) + phiJitter;
      const { p, n: nn } = cylPoint(cyl, phi, J.y + yOff);
      p.y += bow * (phi - cyl.phi0) * (phi - cyl.phi0);
      pts.push(p);
      normals.push(nn);
    }
    // 中央の折り目ほど深く=太く。端は浅く細い
    const widths = taperWidths(pts.length, baseW * (0.65 + arcScale * 0.5), 0.5);
    projectPolyline(pts, widths, normals, 'compression', baseW, 0.88, ctx, out);

    // 深い曲げでは中央の折り目に短いエコー線を添える
    if (bend > 100 && centerIdx < 1 && rand() < 0.8) {
      const ePts: V3[] = [];
      const eNorm: V3[] = [];
      for (let s = 0; s <= 10; s++) {
        const rel = (s / 10 - 0.5) * 2;
        const phi = cyl.phi0 + rel * maxPhi * 0.3 + phiJitter;
        const { p, n: nn } = cylPoint(cyl, phi, J.y + yOff + spacing * 0.4);
        ePts.push(p);
        eNorm.push(nn);
      }
      projectPolyline(
        ePts,
        taperWidths(ePts.length, baseW * 0.5, 0.5),
        eNorm,
        'compression',
        baseW * 0.5,
        0.6,
        ctx,
        out,
      );
    }
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

  const fallbackR = ctx.u * (35 + material.thickness * 25);
  const cyl = fitCylinder(f, F, fallbackR, ctx);
  const rand = rng(hashId(f.id) ^ 0x9001);
  const spacing = ctx.u * (9 + material.weight * 7);
  const amp = ctx.u * (3 + material.weight * 5);
  const halfPhi = 0.85;
  const baseW = ctx.u * (1.5 + material.thickness * 2.6);
  const samples = 26;
  const waveFreq = 2.5 + (1 - material.stiffness) * 2;

  for (let i = 0; i < n; i++) {
    const yOff = -(i + 0.5) * spacing; // 固定点の上に積み上がる
    const phase = rand() * Math.PI * 2;
    const pts: V3[] = [];
    const normals: V3[] = [];
    for (let s = 0; s <= samples; s++) {
      const rel = (s / samples - 0.5) * 2;
      const phi = cyl.phi0 + rel * halfPhi;
      const arg = rel * waveFreq * Math.PI + phase + i * 0.8;
      const sine = Math.sin(arg);
      const tri = (2 / Math.PI) * Math.asin(Math.sin(arg));
      const wave = sine * (1 - material.stiffness) + tri * material.stiffness;
      const { p, n: nn } = cylPoint(cyl, phi, F.y + yOff + wave * amp);
      pts.push(p);
      normals.push(nn);
    }
    const widths = taperWidths(pts.length, baseW, 0.5);
    projectPolyline(pts, widths, normals, 'pooling', baseW, 0.82, ctx, out);
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

  const fallbackR = ctx.u * (40 + material.thickness * 25);
  const cyl = fitCylinder(s, S, fallbackR, ctx);
  const length = ctx.u * (80 + material.weight * 110);
  const baseW = ctx.u * (1.5 + material.thickness * 3);
  const samples = 18;

  for (let k = 0; k < count; k++) {
    const spreadDir = count === 1 ? 0 : (k / (count - 1) - 0.5) * 2;
    const spreadRand = spreadDir + (rand() - 0.5) * 0.35;
    const maxPhi = spreadRand * (0.5 + material.weight * 0.25);
    const lenK = length * (0.7 + rand() * 0.45);
    const straighten = 1.5 + material.weight * 2;

    const curl = (rand() - 0.5) * 0.25; // 裾の抜きハネ
    const pts: V3[] = [];
    const normals: V3[] = [];
    for (let t = 0; t <= samples; t++) {
      const tt = t / samples;
      const lateral =
        (maxPhi * (1 - Math.exp(-tt * straighten))) / (1 - Math.exp(-straighten));
      const phi = cyl.phi0 + lateral + curl * tt * tt * tt;
      const yDrop = lenK * (tt * 0.3 + tt * tt * 0.7);
      const { p, n: nn } = cylPoint(cyl, phi, S.y + yDrop);
      pts.push(p);
      normals.push(nn);
    }
    // 落ちジワは上(支持点側)が太く、裾に向かって抜ける
    const widths = taperWidths(pts.length, baseW * (1 - Math.abs(spreadDir) * 0.25), 0.3);
    projectPolyline(
      pts,
      widths,
      normals,
      'drape',
      baseW,
      0.82 - Math.abs(spreadDir) * 0.2,
      ctx,
      out,
    );
  }
}

/* ============ エントリポイント ============ */
export function generateGuides(
  anchors: Anchor[],
  regions: Region[],
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
    regions,
  };
  const out: GuideLine[] = [];

  const fixed = anchors.filter((a) => a.kind === 'fixed');
  const joints = anchors.filter((a) => a.kind === 'joint');
  const supports = anchors.filter((a) => a.kind === 'support');

  // 張力ジワは同じ服パーツ(領域)内の固定点ペアのみ。
  // 左袖口→右袖口のように別パーツを横断する線は生成しない
  const regionIndexOf = (x: number, y: number): number => {
    for (let i = 0; i < regions.length; i++) {
      if (regions[i].pts.length >= 3 && pointInPolygon(regions[i].pts, x, y)) return i;
    }
    return -1;
  };
  for (let i = 0; i < fixed.length; i++) {
    for (let j = i + 1; j < fixed.length; j++) {
      if (regions.length > 0) {
        const ri = regionIndexOf(fixed[i].x, fixed[i].y);
        const rj = regionIndexOf(fixed[j].x, fixed[j].y);
        if (ri !== rj) continue;
      }
      tensionWrinkles(fixed[i], fixed[j], material, ctx, out);
    }
  }
  for (const j of joints) compressionWrinkles(j, material, ctx, out);

  // たまりジワは布が上から溜まる場所(袖口・裾・ベルト上)にだけ発生する。
  // 服パーツの上側に置かれた固定点(肩の付け根など)には生成しない
  const poolingOk = (f: Anchor): boolean => {
    for (const region of regions) {
      if (region.pts.length < 3 || !pointInPolygon(region.pts, f.x, f.y)) continue;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of region.pts) {
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      if (maxY - minY < 1) return true;
      return (f.y - minY) / (maxY - minY) > 0.45;
    }
    return true; // 領域なし/領域外は従来通り
  };
  for (const f of fixed) {
    if (poolingOk(f)) poolingWrinkles(f, material, ctx, out);
  }
  for (const s of supports) drapeWrinkles(s, material, ctx, out);

  return out;
}
