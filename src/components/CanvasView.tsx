import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { Anchor, AnchorKind, Region } from '../types';
import { PART_LABELS } from '../engine/labels';
import { pointInPolygon } from '../engine/region';

const KIND_COLORS: Record<AnchorKind, string> = {
  fixed: '#e53935',
  joint: '#1e88e5',
  support: '#43a047',
};

export type CanvasMode = 'anchor' | 'select' | 'region';

interface Props {
  image: HTMLImageElement | null;
  anchors: Anchor[];
  regions: Region[];
  guideLayer: HTMLCanvasElement | null;
  overlayVisible: boolean;
  mode: CanvasMode;
  selectedId: string | null;
  onAddAnchor: (x: number, y: number) => void;
  onSelect: (id: string | null) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDelete: (id: string) => void;
  onAddRegion: (pts: { x: number; y: number }[]) => void;
  onDeleteRegion: (id: string) => void;
  onDropFile: (file: File) => void;
}

interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

export default function CanvasView(props: Props) {
  const {
    image,
    anchors,
    regions,
    guideLayer,
    overlayVisible,
    mode,
    selectedId,
    onAddAnchor,
    onSelect,
    onDragStart,
    onDragMove,
    onDelete,
    onAddRegion,
    onDeleteRegion,
    onDropFile,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<Transform>({ scale: 1, tx: 0, ty: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [draft, setDraft] = useState<{ x: number; y: number }[]>([]);
  const [hoverPt, setHoverPt] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<
    | { type: 'pan'; startX: number; startY: number; startTx: number; startTy: number }
    | { type: 'anchor'; id: string }
    | null
  >(null);

  const toImage = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      return {
        x: (sx - transform.tx) / transform.scale,
        y: (sy - transform.ty) / transform.scale,
      };
    },
    [transform],
  );

  const hitTest = useCallback(
    (ix: number, iy: number): Anchor | null => {
      const r = 12 / transform.scale;
      let best: Anchor | null = null;
      let bestD = r;
      for (const a of anchors) {
        const d = Math.hypot(a.x - ix, a.y - iy);
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
      return best;
    },
    [anchors, transform.scale],
  );

  const closeDraft = useCallback(() => {
    setDraft((d) => {
      if (d.length >= 3) onAddRegion(d);
      return [];
    });
  }, [onAddRegion]);

  // モードが変わったら下書きを破棄
  useEffect(() => {
    if (mode !== 'region') {
      setDraft([]);
      setHoverPt(null);
    }
  }, [mode]);

  // 画像読み込み時にフィット
  useEffect(() => {
    if (!image || !containerRef.current) return;
    const { clientWidth: cw, clientHeight: ch } = containerRef.current;
    const scale = Math.min(cw / image.naturalWidth, ch / image.naturalHeight) * 0.92;
    setTransform({
      scale,
      tx: (cw - image.naturalWidth * scale) / 2,
      ty: (ch - image.naturalHeight * scale) / 2,
    });
  }, [image]);

  // Space / Enter / Escape キー監視
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'BUTTON') return;
      if (e.code === 'Space') {
        e.preventDefault();
        setSpaceHeld(true);
      } else if (e.key === 'Enter' && mode === 'region') {
        closeDraft();
      } else if (e.key === 'Escape' && mode === 'region') {
        setDraft([]);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [mode, closeDraft]);

  // ホイールズーム(non-passiveで登録)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      setTransform((t) => {
        const factor = Math.exp(-e.deltaY * 0.0015);
        const scale = Math.min(20, Math.max(0.05, t.scale * factor));
        const k = scale / t.scale;
        return {
          scale,
          tx: sx - (sx - t.tx) * k,
          ty: sy - (sy - t.ty) * k,
        };
      });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return; // 右クリックはcontextmenuで処理
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (spaceHeld || e.button === 1) {
      dragRef.current = {
        type: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        startTx: transform.tx,
        startTy: transform.ty,
      };
      return;
    }
    if (!image) return;
    const p = toImage(e.clientX, e.clientY);

    if (mode === 'region') {
      // 始点の近くをクリックしたら閉じる
      if (draft.length >= 3 && Math.hypot(p.x - draft[0].x, p.y - draft[0].y) < 12 / transform.scale) {
        closeDraft();
      } else {
        setDraft((d) => [...d, p]);
      }
      return;
    }

    const hit = hitTest(p.x, p.y);
    if (mode === 'select') {
      onSelect(hit ? hit.id : null);
      if (hit) {
        onDragStart(hit.id);
        dragRef.current = { type: 'anchor', id: hit.id };
      }
    } else {
      if (hit) {
        onSelect(hit.id);
        onDragStart(hit.id);
        dragRef.current = { type: 'anchor', id: hit.id };
      } else if (
        p.x >= 0 &&
        p.y >= 0 &&
        p.x <= image.naturalWidth &&
        p.y <= image.naturalHeight
      ) {
        onAddAnchor(p.x, p.y);
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (mode === 'region' && draft.length > 0) {
      setHoverPt(toImage(e.clientX, e.clientY));
    }
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.type === 'pan') {
      setTransform((t) => ({
        ...t,
        tx: drag.startTx + e.clientX - drag.startX,
        ty: drag.startTy + e.clientY - drag.startY,
      }));
    } else {
      const p = toImage(e.clientX, e.clientY);
      onDragMove(drag.id, p.x, p.y);
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const onDoubleClick = () => {
    if (mode === 'region') closeDraft();
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!image) return;
    const p = toImage(e.clientX, e.clientY);
    if (mode === 'region') {
      if (draft.length > 0) {
        setDraft((d) => d.slice(0, -1));
      } else {
        const hitRegion = regions.find(
          (r) => r.pts.length >= 3 && pointInPolygon(r.pts, p.x, p.y),
        );
        if (hitRegion) onDeleteRegion(hitRegion.id);
      }
      return;
    }
    const hit = hitTest(p.x, p.y);
    if (hit) onDelete(hit.id);
  };

  // 描画
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!image) return;

    ctx.save();
    ctx.translate(transform.tx, transform.ty);
    ctx.scale(transform.scale, transform.scale);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0);

    if (overlayVisible && guideLayer) {
      ctx.drawImage(guideLayer, 0, 0);
    }

    const s = transform.scale;

    // 服の領域
    for (const r of regions) {
      if (r.pts.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(r.pts[0].x, r.pts[0].y);
      for (let i = 1; i < r.pts.length; i++) ctx.lineTo(r.pts[i].x, r.pts[i].y);
      ctx.closePath();
      if (mode === 'region') {
        ctx.fillStyle = 'rgba(255, 213, 79, 0.08)';
        ctx.fill();
      }
      ctx.strokeStyle = mode === 'region' ? '#ffd54f' : 'rgba(255, 213, 79, 0.45)';
      ctx.lineWidth = 1.5 / s;
      ctx.setLineDash([6 / s, 4 / s]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 領域の下書き
    if (mode === 'region' && draft.length > 0) {
      ctx.beginPath();
      ctx.moveTo(draft[0].x, draft[0].y);
      for (let i = 1; i < draft.length; i++) ctx.lineTo(draft[i].x, draft[i].y);
      if (hoverPt) ctx.lineTo(hoverPt.x, hoverPt.y);
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 1.5 / s;
      ctx.stroke();
      for (let i = 0; i < draft.length; i++) {
        ctx.beginPath();
        ctx.arc(draft[i].x, draft[i].y, (i === 0 ? 5 : 3.5) / s, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? '#fff176' : '#ffd54f';
        ctx.fill();
      }
    }

    // アンカーマーカー(画面上で一定サイズ)
    for (const a of anchors) {
      const r = (a.id === selectedId ? 8 : 6) / s;
      ctx.beginPath();
      ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
      ctx.fillStyle = KIND_COLORS[a.kind];
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = (a.id === selectedId ? 2.5 : 1.5) / s;
      ctx.strokeStyle = a.id === selectedId ? '#ffffff' : 'rgba(255,255,255,0.6)';
      ctx.stroke();
      if (a.label) {
        const name = PART_LABELS.find((l) => l.id === a.label)?.name ?? '';
        if (name) {
          ctx.font = `${11 / s}px sans-serif`;
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.fillText(name, a.x + 10 / s, a.y - 8 / s);
        }
      }
    }
    ctx.restore();
  }, [
    image,
    anchors,
    regions,
    guideLayer,
    overlayVisible,
    selectedId,
    transform,
    mode,
    draft,
    hoverPt,
  ]);

  // コンテナリサイズで再描画
  const [, setResizeTick] = useState(0);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => setResizeTick((t) => t + 1));
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && /image\/(png|jpeg)/.test(file.type)) onDropFile(file);
  };

  const cursor = spaceHeld
    ? 'grab'
    : mode === 'select'
      ? 'default'
      : 'crosshair';

  const modeLabel =
    mode === 'anchor'
      ? '📍 アンカー配置 (A)'
      : mode === 'select'
        ? '🖱️ 選択/移動 (V)'
        : '🧥 服の領域 (R)';

  return (
    <div
      ref={containerRef}
      className="canvas-area"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <canvas
        ref={canvasRef}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      />
      {!image && (
        <div className="drop-hint">
          <div style={{ fontSize: 40 }}>🖼️</div>
          <div>
            3Dレンダー画像(PNG / JPEG)をここにドラッグ&ドロップ
            <br />
            またはヘッダーの「画像読込」から選択
          </div>
        </div>
      )}
      {image && (
        <div className="mode-indicator">
          モード: <b>{modeLabel}</b>
          {mode === 'region' &&
            (draft.length > 0
              ? ' ｜ クリックで頂点追加、始点クリック/Enterで確定、Escで取消'
              : ' ｜ 服の輪郭をクリックで囲む。右クリックで領域削除')}
          {!overlayVisible && ' ｜ ガイド非表示 (Tab)'}
        </div>
      )}
    </div>
  );
}
