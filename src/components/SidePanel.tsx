import type {
  Anchor,
  AnchorKind,
  CameraAngle,
  Density,
  GuideSettings,
  GuideType,
  Material,
} from '../types';
import { CAMERA_PRESETS, GUIDE_COLORS, MATERIAL_PRESETS } from '../types';
import { PART_LABELS, estimateDepth } from '../engine/labels';

interface Props {
  cam: CameraAngle;
  onCamChange: (cam: CameraAngle) => void;
  material: Material;
  materialPreset: number; // -1 = カスタム
  onMaterialChange: (m: Material, presetIndex: number) => void;
  defaultKind: AnchorKind;
  onDefaultKindChange: (k: AnchorKind) => void;
  selected: Anchor | null;
  onAnchorUpdate: (id: string, patch: Partial<Anchor>) => void;
  onAnchorDelete: (id: string) => void;
  settings: GuideSettings;
  onSettingsChange: (s: GuideSettings) => void;
  anchorCount: number;
  regionCount: number;
  onClearRegions: () => void;
  onEnterRegionMode: () => void;
  alphaMaskAvailable: boolean;
}

const KIND_NAMES: { kind: AnchorKind; label: string; cls: string }[] = [
  { kind: 'fixed', label: '固定点', cls: 'k-fixed' },
  { kind: 'joint', label: '関節点', cls: 'k-joint' },
  { kind: 'support', label: '支持点', cls: 'k-support' },
];

const GUIDE_NAMES: { type: GuideType; label: string }[] = [
  { type: 'tension', label: '張力' },
  { type: 'compression', label: '圧縮' },
  { type: 'pooling', label: 'たまり' },
  { type: 'drape', label: '落ち' },
];

export default function SidePanel(props: Props) {
  const {
    cam,
    onCamChange,
    material,
    materialPreset,
    onMaterialChange,
    defaultKind,
    onDefaultKindChange,
    selected,
    onAnchorUpdate,
    onAnchorDelete,
    settings,
    onSettingsChange,
    anchorCount,
    regionCount,
    onClearRegions,
    onEnterRegionMode,
    alphaMaskAvailable,
  } = props;

  const activeKind = selected ? selected.kind : defaultKind;

  const setKind = (k: AnchorKind) => {
    if (selected) onAnchorUpdate(selected.id, { kind: k });
    else onDefaultKindChange(k);
  };

  const setMaterialField = (field: keyof Material, v: number) => {
    onMaterialChange({ ...material, [field]: v }, -1);
  };

  return (
    <div className="side-panel">
      {/* カメラ角度 */}
      <div className="section">
        <h2>📷 カメラ角度</h2>
        <div className="row">
          <label>方位角</label>
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={cam.azimuth}
            onChange={(e) => onCamChange({ ...cam, azimuth: +e.target.value })}
          />
          <span className="value">{cam.azimuth}°</span>
        </div>
        <div className="row">
          <label>仰角</label>
          <input
            type="range"
            min={-45}
            max={45}
            step={1}
            value={cam.elevation}
            onChange={(e) => onCamChange({ ...cam, elevation: +e.target.value })}
          />
          <span className="value">{cam.elevation}°</span>
        </div>
        <div className="preset-buttons">
          {CAMERA_PRESETS.map((p) => (
            <button
              key={p.name}
              className={
                cam.azimuth === p.azimuth && cam.elevation === p.elevation ? 'active' : ''
              }
              onClick={() => onCamChange({ azimuth: p.azimuth, elevation: p.elevation })}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* 素材設定 */}
      <div className="section">
        <h2>🧵 素材設定</h2>
        <select
          value={materialPreset}
          onChange={(e) => {
            const i = +e.target.value;
            if (i >= 0) onMaterialChange({ ...MATERIAL_PRESETS[i].m }, i);
          }}
          style={{ marginBottom: 8 }}
        >
          <option value={-1}>カスタム</option>
          {MATERIAL_PRESETS.map((p, i) => (
            <option key={p.name} value={i}>
              {p.name}
            </option>
          ))}
        </select>
        {(
          [
            ['stiffness', '硬さ'],
            ['thickness', '厚み'],
            ['weight', '重さ'],
          ] as [keyof Material, string][]
        ).map(([field, label]) => (
          <div className="row" key={field}>
            <label>{label}</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={material[field]}
              onChange={(e) => setMaterialField(field, +e.target.value)}
            />
            <span className="value">{material[field].toFixed(2)}</span>
          </div>
        ))}
      </div>

      {/* アンカー */}
      <div className="section">
        <h2>
          📍 アンカー <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({anchorCount})</span>
        </h2>
        <div className="kind-radios">
          {KIND_NAMES.map((k) => (
            <button
              key={k.kind}
              className={`${k.cls} ${activeKind === k.kind ? 'active' : ''}`}
              onClick={() => setKind(k.kind)}
            >
              {k.label}
            </button>
          ))}
        </div>
        {selected ? (
          <>
            <div className="row">
              <label>深度</label>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={selected.depth}
                onChange={(e) => onAnchorUpdate(selected.id, { depth: +e.target.value })}
              />
              <span className="value">{selected.depth.toFixed(2)}</span>
            </div>
            {selected.kind === 'joint' && (
              <div className="row">
                <label>曲げ角</label>
                <input
                  type="range"
                  min={0}
                  max={180}
                  step={1}
                  value={selected.bendAngle}
                  onChange={(e) => onAnchorUpdate(selected.id, { bendAngle: +e.target.value })}
                />
                <span className="value">{selected.bendAngle}°</span>
              </div>
            )}
            <select
              value={selected.label}
              onChange={(e) => {
                const label = e.target.value;
                const patch: Partial<Anchor> = { label };
                const est = estimateDepth(label, cam);
                if (est !== null) patch.depth = est;
                onAnchorUpdate(selected.id, patch);
              }}
            >
              <option value="">ラベルなし（深度は手動）</option>
              {PART_LABELS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <div className="anchor-actions">
              <button className="danger" onClick={() => onAnchorDelete(selected.id)}>
                🗑 このアンカーを削除
              </button>
            </div>
          </>
        ) : (
          <div className="hint">
            キャンバスをクリックして配置。
            <br />
            ドラッグで移動 / 右クリックで削除。
            <br />
            選択するとここで深度・ラベルを編集できます。
          </div>
        )}
      </div>

      {/* 服の領域 */}
      <div className="section">
        <h2>
          🧥 服の領域{' '}
          <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({regionCount})</span>
        </h2>
        <div className="hint" style={{ marginBottom: 8 }}>
          服の輪郭を多角形で囲むと、シワガイドがその中だけに表示され、
          回り込みの丸みも服の幅に合わせて計算されます。
          {alphaMaskAvailable && regionCount === 0 && (
            <>
              <br />
              ※この画像は透過背景なので、未指定でもキャラ形状で自動クリップされます。
            </>
          )}
        </div>
        <div className="anchor-actions" style={{ marginTop: 0 }}>
          <button onClick={onEnterRegionMode}>✏️ 領域を描く (R)</button>
          <button onClick={onClearRegions} disabled={regionCount === 0}>
            クリア
          </button>
        </div>
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12 }}
        >
          <input
            type="checkbox"
            checked={settings.clip}
            onChange={(e) => onSettingsChange({ ...settings, clip: e.target.checked })}
          />
          領域/透過部分でガイドをクリップ
        </label>
      </div>

      {/* ガイド表示 */}
      <div className="section">
        <h2>🎨 ガイド表示</h2>
        <div className="check-grid">
          {GUIDE_NAMES.map((g) => (
            <label key={g.type}>
              <input
                type="checkbox"
                checked={settings.show[g.type]}
                onChange={(e) =>
                  onSettingsChange({
                    ...settings,
                    show: { ...settings.show, [g.type]: e.target.checked },
                  })
                }
              />
              <span className="swatch" style={{ background: GUIDE_COLORS[g.type] }} />
              {g.label}
            </label>
          ))}
        </div>
        <div className="row">
          <label>不透明度</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={settings.opacity}
            onChange={(e) => onSettingsChange({ ...settings, opacity: +e.target.value })}
          />
          <span className="value">{Math.round(settings.opacity * 100)}%</span>
        </div>
        <div className="row">
          <label>密度</label>
          <select
            value={settings.density}
            onChange={(e) => onSettingsChange({ ...settings, density: e.target.value as Density })}
          >
            <option value="simple">シンプル（少）</option>
            <option value="standard">標準</option>
            <option value="detailed">詳細（多）</option>
          </select>
        </div>
      </div>

      {/* ショートカット */}
      <div className="section">
        <h2>⌨️ ショートカット</h2>
        <div className="shortcuts">
          <kbd>A</kbd> アンカー配置モード
          <br />
          <kbd>V</kbd> 選択/移動モード
          <br />
          <kbd>R</kbd> 服の領域モード（<kbd>Enter</kbd>確定 / <kbd>Esc</kbd>取消）
          <br />
          <kbd>Tab</kbd> ガイド表示切替
          <br />
          <kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Shift+Z</kbd> Undo / Redo
          <br />
          <kbd>ホイール</kbd> ズーム ／ <kbd>Space+ドラッグ</kbd> パン
        </div>
      </div>
    </div>
  );
}
