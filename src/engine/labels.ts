import type { CameraAngle } from '../types';

/**
 * パーツラベル。
 * theta: 体の円筒周りの角度(度)。0=正面, +が体の右側(向かって左), 180=背面
 * radius: 体中心からの半径(深度スケールに対する比率 0..1)
 */
export interface PartLabel {
  id: string;
  name: string;
  theta: number;
  radius: number;
}

export const PART_LABELS: PartLabel[] = [
  { id: 'chest', name: '胸', theta: 0, radius: 0.55 },
  { id: 'waist', name: '腰', theta: 0, radius: 0.45 },
  { id: 'collar', name: '襟元', theta: 0, radius: 0.4 },
  { id: 'hem', name: '裾', theta: 0, radius: 0.4 },
  { id: 'shoulder_r', name: '右肩', theta: 55, radius: 0.8 },
  { id: 'shoulder_l', name: '左肩', theta: -55, radius: 0.8 },
  { id: 'elbow_r', name: '右肘', theta: 70, radius: 0.95 },
  { id: 'elbow_l', name: '左肘', theta: -70, radius: 0.95 },
  { id: 'wrist_r', name: '右手首', theta: 80, radius: 1.0 },
  { id: 'wrist_l', name: '左手首', theta: -80, radius: 1.0 },
  { id: 'hip_r', name: '右腰骨', theta: 40, radius: 0.6 },
  { id: 'hip_l', name: '左腰骨', theta: -40, radius: 0.6 },
  { id: 'knee_r', name: '右膝', theta: 25, radius: 0.7 },
  { id: 'knee_l', name: '左膝', theta: -25, radius: 0.7 },
  { id: 'back', name: '背中', theta: 180, radius: 0.55 },
];

/**
 * カメラ方位角に基づく典型的な深度値の推定 (-1..1)。
 * パーツが向いている方向とカメラ方向が一致するほど手前(+)になる。
 */
export function estimateDepth(labelId: string, cam: CameraAngle): number | null {
  const label = PART_LABELS.find((l) => l.id === labelId);
  if (!label) return null;
  const d = label.radius * Math.cos(((label.theta - cam.azimuth) * Math.PI) / 180);
  return Math.max(-1, Math.min(1, Math.round(d * 100) / 100));
}
