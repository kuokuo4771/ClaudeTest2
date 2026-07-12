import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CanvasView from './components/CanvasView';
import SidePanel from './components/SidePanel';
import { generateGuides } from './engine/wrinkles';
import { drawGuides } from './engine/draw';
import { createDemoImage } from './engine/demo';
import { MATERIAL_PRESETS } from './types';
import type {
  Anchor,
  AnchorKind,
  CameraAngle,
  GuideSettings,
  Material,
} from './types';

let anchorSeq = 0;

export default function App() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [defaultKind, setDefaultKind] = useState<AnchorKind>('fixed');
  const [cam, setCam] = useState<CameraAngle>({ azimuth: 0, elevation: 0 });
  const [material, setMaterial] = useState<Material>({ ...MATERIAL_PRESETS[0].m });
  const [materialPreset, setMaterialPreset] = useState(0);
  const [mode, setMode] = useState<'anchor' | 'select'>('anchor');
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [settings, setSettings] = useState<GuideSettings>({
    show: { tension: true, compression: true, pooling: true, drape: true },
    opacity: 0.85,
    density: 'standard',
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Undo/Redo (アンカー操作対象) ----
  const pastRef = useRef<Anchor[][]>([]);
  const futureRef = useRef<Anchor[][]>([]);
  const anchorsRef = useRef(anchors);
  anchorsRef.current = anchors;

  const pushHistory = useCallback(() => {
    pastRef.current.push(anchorsRef.current);
    if (pastRef.current.length > 100) pastRef.current.shift();
    futureRef.current = [];
  }, []);

  const undo = useCallback(() => {
    const prev = pastRef.current.pop();
    if (!prev) return;
    futureRef.current.push(anchorsRef.current);
    setAnchors(prev);
    setSelectedId((id) => (prev.some((a) => a.id === id) ? id : null));
  }, []);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(anchorsRef.current);
    setAnchors(next);
    setSelectedId((id) => (next.some((a) => a.id === id) ? id : null));
  }, []);

  // ---- アンカー操作 ----
  const addAnchor = useCallback(
    (x: number, y: number) => {
      pushHistory();
      const a: Anchor = {
        id: `a${Date.now().toString(36)}_${anchorSeq++}`,
        kind: defaultKind,
        x,
        y,
        depth: 0,
        label: '',
        bendAngle: 90,
      };
      setAnchors((prev) => [...prev, a]);
      setSelectedId(a.id);
    },
    [defaultKind, pushHistory],
  );

  const updateAnchor = useCallback(
    (id: string, patch: Partial<Anchor>, withHistory = true) => {
      if (withHistory) pushHistory();
      setAnchors((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    },
    [pushHistory],
  );

  const deleteAnchor = useCallback(
    (id: string) => {
      pushHistory();
      setAnchors((prev) => prev.filter((a) => a.id !== id));
      setSelectedId((sel) => (sel === id ? null : sel));
    },
    [pushHistory],
  );

  const dragMove = useCallback((id: string, x: number, y: number) => {
    setAnchors((prev) => prev.map((a) => (a.id === id ? { ...a, x, y } : a)));
  }, []);

  // ---- シワガイド計算 ----
  const guides = useMemo(() => {
    if (!image) return [];
    return generateGuides(
      anchors,
      material,
      cam,
      image.naturalWidth,
      image.naturalHeight,
      settings.density,
    );
  }, [image, anchors, material, cam, settings.density]);

  // ---- 画像読み込み ----
  const loadFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setAnchors([]);
      setSelectedId(null);
      pastRef.current = [];
      futureRef.current = [];
    };
    img.src = url;
  }, []);

  const loadDemo = useCallback(async () => {
    const img = await createDemoImage();
    setImage(img);
    setAnchors([]);
    setSelectedId(null);
    pastRef.current = [];
    futureRef.current = [];
  }, []);

  // ---- PNG書き出し(ガイドのみ・透過) ----
  const exportPng = useCallback(() => {
    if (!image) return;
    const c = document.createElement('canvas');
    c.width = image.naturalWidth;
    c.height = image.naturalHeight;
    const ctx = c.getContext('2d')!;
    drawGuides(ctx, guides, settings);
    c.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'wrinkle-guide.png';
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  }, [image, guides, settings]);

  // ---- キーボードショートカット ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      switch (e.key) {
        case 'a':
        case 'A':
          setMode('anchor');
          break;
        case 'v':
        case 'V':
          setMode('select');
          break;
        case 'Tab':
          e.preventDefault();
          setOverlayVisible((v) => !v);
          break;
        case 'Delete':
        case 'Backspace':
          setSelectedId((sel) => {
            if (sel) deleteAnchor(sel);
            return null;
          });
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, deleteAnchor]);

  const selected = anchors.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="app">
      <header className="header">
        <h1>
          Wrinkle Guide<span>シワ描画補助ツール v0.2</span>
        </h1>
        <button className="primary" onClick={() => fileInputRef.current?.click()}>
          📂 画像読込
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFile(f);
            e.target.value = '';
          }}
        />
        <button onClick={loadDemo}>🧍 デモ画像</button>
        <button onClick={exportPng} disabled={!image || guides.length === 0}>
          💾 PNG書出
        </button>
        <div className="spacer" />
        <button className={mode === 'anchor' ? 'active' : ''} onClick={() => setMode('anchor')}>
          📍 配置 (A)
        </button>
        <button className={mode === 'select' ? 'active' : ''} onClick={() => setMode('select')}>
          🖱️ 選択 (V)
        </button>
        <button onClick={undo} title="Ctrl+Z">
          ↩ Undo
        </button>
        <button onClick={redo} title="Ctrl+Shift+Z">
          ↪ Redo
        </button>
      </header>
      <div className="main">
        <CanvasView
          image={image}
          anchors={anchors}
          guides={guides}
          settings={settings}
          overlayVisible={overlayVisible}
          mode={mode}
          selectedId={selectedId}
          onAddAnchor={addAnchor}
          onSelect={setSelectedId}
          onDragStart={() => pushHistory()}
          onDragMove={dragMove}
          onDelete={deleteAnchor}
          onDropFile={loadFile}
        />
        <SidePanel
          cam={cam}
          onCamChange={setCam}
          material={material}
          materialPreset={materialPreset}
          onMaterialChange={(m, i) => {
            setMaterial(m);
            setMaterialPreset(i);
          }}
          defaultKind={defaultKind}
          onDefaultKindChange={setDefaultKind}
          selected={selected}
          onAnchorUpdate={(id, patch) => updateAnchor(id, patch)}
          onAnchorDelete={deleteAnchor}
          settings={settings}
          onSettingsChange={setSettings}
          anchorCount={anchors.length}
        />
      </div>
    </div>
  );
}
