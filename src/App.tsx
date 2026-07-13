import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CanvasView, { CanvasMode } from './components/CanvasView';
import SidePanel from './components/SidePanel';
import { generateGuides } from './engine/wrinkles';
import {
  buildRegionMask,
  buildSampler,
  imageHasAlpha,
  renderGuideLayer,
} from './engine/draw';
import { createDemoImage } from './engine/demo';
import { MATERIAL_PRESETS } from './types';
import type {
  Anchor,
  AnchorKind,
  CameraAngle,
  GuideSettings,
  Material,
  Region,
} from './types';

let idSeq = 0;

interface Snapshot {
  anchors: Anchor[];
  regions: Region[];
}

export default function App() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [defaultKind, setDefaultKind] = useState<AnchorKind>('fixed');
  const [cam, setCam] = useState<CameraAngle>({ azimuth: 0, elevation: 0 });
  const [material, setMaterial] = useState<Material>({ ...MATERIAL_PRESETS[0].m });
  const [materialPreset, setMaterialPreset] = useState(0);
  const [mode, setMode] = useState<CanvasMode>('anchor');
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [settings, setSettings] = useState<GuideSettings>({
    show: { tension: true, compression: true, pooling: true, drape: true },
    opacity: 0.9,
    density: 'standard',
    clip: true,
    style: 'finish',
    lightAngle: -90,
    showShadow: true,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Undo/Redo (アンカー+領域が対象) ----
  const pastRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);
  const snapRef = useRef<Snapshot>({ anchors, regions });
  snapRef.current = { anchors, regions };

  const pushHistory = useCallback(() => {
    pastRef.current.push(snapRef.current);
    if (pastRef.current.length > 100) pastRef.current.shift();
    futureRef.current = [];
  }, []);

  const restore = useCallback((snap: Snapshot) => {
    setAnchors(snap.anchors);
    setRegions(snap.regions);
    setSelectedId((id) => (snap.anchors.some((a) => a.id === id) ? id : null));
  }, []);

  const undo = useCallback(() => {
    const prev = pastRef.current.pop();
    if (!prev) return;
    futureRef.current.push(snapRef.current);
    restore(prev);
  }, [restore]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(snapRef.current);
    restore(next);
  }, [restore]);

  // ---- アンカー操作 ----
  const addAnchor = useCallback(
    (x: number, y: number) => {
      pushHistory();
      const a: Anchor = {
        id: `a${Date.now().toString(36)}_${idSeq++}`,
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
    (id: string, patch: Partial<Anchor>) => {
      pushHistory();
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

  // ---- 服の領域操作 ----
  const addRegion = useCallback(
    (pts: { x: number; y: number }[]) => {
      pushHistory();
      setRegions((prev) => [...prev, { id: `r${Date.now().toString(36)}_${idSeq++}`, pts }]);
    },
    [pushHistory],
  );

  const deleteRegion = useCallback(
    (id: string) => {
      pushHistory();
      setRegions((prev) => prev.filter((r) => r.id !== id));
    },
    [pushHistory],
  );

  const clearRegions = useCallback(() => {
    if (snapRef.current.regions.length === 0) return;
    pushHistory();
    setRegions([]);
  }, [pushHistory]);

  // ---- シワガイド計算 ----
  const guides = useMemo(() => {
    if (!image) return [];
    return generateGuides(
      anchors,
      regions,
      material,
      cam,
      image.naturalWidth,
      image.naturalHeight,
      settings.density,
    );
  }, [image, anchors, regions, material, cam, settings.density]);

  // ---- クリップマスク: 服の領域 > 画像の透明部分 ----
  const alphaMaskAvailable = useMemo(() => (image ? imageHasAlpha(image) : false), [image]);
  const mask = useMemo(() => {
    if (!image) return null;
    const regionMask = buildRegionMask(image.naturalWidth, image.naturalHeight, regions);
    if (regionMask) return regionMask;
    return alphaMaskAvailable ? image : null;
  }, [image, regions, alphaMaskAvailable]);

  // ---- 仕上げスタイル用の色サンプラー ----
  const sampler = useMemo(() => (image ? buildSampler(image) : null), [image]);

  // ---- ガイドレイヤー(画像解像度で描画+クリップ済み) ----
  const guideLayer = useMemo(() => {
    if (!image) return null;
    return renderGuideLayer(
      image.naturalWidth,
      image.naturalHeight,
      guides,
      settings,
      mask,
      sampler,
    );
  }, [image, guides, settings, mask, sampler]);

  // ---- 画像読み込み ----
  const resetProject = useCallback((img: HTMLImageElement) => {
    setImage(img);
    setAnchors([]);
    setRegions([]);
    setSelectedId(null);
    pastRef.current = [];
    futureRef.current = [];
  }, []);

  const loadFile = useCallback(
    (file: File) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resetProject(img);
      img.src = url;
    },
    [resetProject],
  );

  const loadDemo = useCallback(async () => {
    resetProject(await createDemoImage());
  }, [resetProject]);

  // ---- PNG書き出し(ガイドのみ・透過・クリップ適用) ----
  const exportPng = useCallback(() => {
    if (!image || !guideLayer) return;
    guideLayer.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'wrinkle-guide.png';
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  }, [image, guideLayer]);

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
        case 'r':
        case 'R':
          setMode('region');
          break;
        case 'Tab':
          e.preventDefault();
          setOverlayVisible((v) => !v);
          break;
        case 'Escape':
          setSelectedId(null);
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
          Wrinkle Guide<span>シワ描画補助ツール v0.4</span>
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
        <button className={mode === 'region' ? 'active' : ''} onClick={() => setMode('region')}>
          🧥 領域 (R)
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
          regions={regions}
          guideLayer={guideLayer}
          overlayVisible={overlayVisible}
          mode={mode}
          selectedId={selectedId}
          onAddAnchor={addAnchor}
          onSelect={setSelectedId}
          onDragStart={() => pushHistory()}
          onDragMove={dragMove}
          onDelete={deleteAnchor}
          onAddRegion={addRegion}
          onDeleteRegion={deleteRegion}
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
          regionCount={regions.length}
          onClearRegions={clearRegions}
          onEnterRegionMode={() => setMode('region')}
          alphaMaskAvailable={alphaMaskAvailable}
        />
      </div>
    </div>
  );
}
