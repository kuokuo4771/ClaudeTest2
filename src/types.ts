export type AnchorKind = 'fixed' | 'joint' | 'support';

export interface Anchor {
  id: string;
  kind: AnchorKind;
  /** 画像ピクセル座標 */
  x: number;
  y: number;
  /** 深度 -1.0(奥) 〜 +1.0(手前) */
  depth: number;
  /** パーツラベルID（空文字 = 未設定） */
  label: string;
  /** 関節点のみ: 曲げ角度 0〜180° */
  bendAngle: number;
}

export interface Material {
  stiffness: number; // 0..1
  thickness: number; // 0..1
  weight: number; // 0..1
}

export interface CameraAngle {
  azimuth: number; // -180..180
  elevation: number; // -45..45
}

export type GuideType = 'tension' | 'compression' | 'pooling' | 'drape';

export type Density = 'simple' | 'standard' | 'detailed';

/** 表示スタイル: guide=色分けガイド線 / finish=仕上げ(ペン線+セル影) */
export type GuideStyle = 'guide' | 'finish';

export interface GuideSettings {
  show: Record<GuideType, boolean>;
  opacity: number; // 0..1
  density: Density;
  /** 服の領域(または画像の透明部分)でガイドをクリップする */
  clip: boolean;
  style: GuideStyle;
  /** 光の来る方向(度)。-90=真上, 0=右, 180/-180=左 */
  lightAngle: number;
  /** 仕上げスタイルで影シェイプを描くか */
  showShadow: boolean;
}

export interface GuideLine {
  type: GuideType;
  /** 画像座標系の可視ポリライン */
  pts: { x: number; y: number }[];
  width: number;
  alpha: number;
  /** 各点の線幅(入り抜きテーパー)。省略時は width の均一線 */
  widths?: number[];
}

/** 服の領域(画像座標系の多角形) */
export interface Region {
  id: string;
  pts: { x: number; y: number }[];
}

export const GUIDE_COLORS: Record<GuideType, string> = {
  tension: '#ef5350',
  compression: '#42a5f5',
  pooling: '#66bb6a',
  drape: '#ab47bc',
};

export const MATERIAL_PRESETS: { name: string; m: Material }[] = [
  { name: 'Tシャツ（薄手）', m: { stiffness: 0.2, thickness: 0.1, weight: 0.2 } },
  { name: 'パーカー', m: { stiffness: 0.4, thickness: 0.5, weight: 0.5 } },
  { name: 'デニムジャケット', m: { stiffness: 0.8, thickness: 0.7, weight: 0.6 } },
  { name: 'シルクブラウス', m: { stiffness: 0.1, thickness: 0.05, weight: 0.1 } },
  { name: 'レザージャケット', m: { stiffness: 0.9, thickness: 0.8, weight: 0.7 } },
  { name: 'ニットセーター', m: { stiffness: 0.3, thickness: 0.6, weight: 0.4 } },
  { name: 'プリーツスカート', m: { stiffness: 0.5, thickness: 0.2, weight: 0.3 } },
];

export const CAMERA_PRESETS: { name: string; azimuth: number; elevation: number }[] = [
  { name: '正面', azimuth: 0, elevation: 0 },
  { name: '右斜め', azimuth: 30, elevation: 0 },
  { name: '左斜め', azimuth: -30, elevation: 0 },
  { name: '側面', azimuth: 90, elevation: 0 },
  { name: '俯瞰', azimuth: 0, elevation: 30 },
  { name: '煽り', azimuth: 0, elevation: -30 },
];
