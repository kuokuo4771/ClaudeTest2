import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { Anchor, AnchorKind, GuideLine, GuideSettings } from '../types';
import { drawGuides } from '../engine/draw';
import { PART_LABELS } from '../engine/labels';

const KIND_COLORS: Record<AnchorKind, string> = {
  fixed: '#e53935',
  joint: '#1e88e5',
  support: '#43a047',
};

interface Props {
  image: HTMLImageElement | null;
  anchors: Anchor[];
  guides: GuideLine[];
  settings: GuideSettings;
  overlayVisible: boolean;
  mode: 'anchor' | 'select';
  selectedId: string | null;
  onAddAnchor: (x: number, y: number) => void;
  onSelect: (id: string | null) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDelete: (id: string) => void;
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
    guides,
    settings,
    overlayVisible,
    mode,
    selectedId,
    onAddAnchor,
    onSelect,
    onDragStart,
    onDragMove,
    onDelete,
    onDropFile,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<Transform>({ scale: 1, tx: 0, ty: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
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

  // Spaceキー監視
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const t = e.target as HTMLElement;
        if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'BUTTON') return;
        e.preventDefault();
        setSpaceHeld(true);
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
  }, []);

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
    const hit = hitTest(p.x, p.y);
    if (mode === 'select') {
      onSelect(hit ? hit.id : null);
      if (hit) {
        onDragStart(hit.id);
        dragRef.current = { type: 'anchor', id: hit.id };
      }
    } else {
      // 配置モード: 既存アンカーの上ならドラッグ、それ以外は新規配置
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

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!image) return;
    const p = toImage(e.clientX, e.clientY);
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

    if (overlayVisible) {
      drawGuides(ctx, guides, settings);
    }

    // アンカーマーカー(画面上で一定サイズ)
    const s = transform.scale;
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
  }, [image, anchors, guides, settings, overlayVisible, selectedId, transform]);

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
    : mode === 'anchor'
      ? 'crosshair'
      : 'default';

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
          モード: <b>{mode === 'anchor' ? '📍 アンカー配置 (A)' : '🖱️ 選択/移動 (V)'}</b>
          {!overlayVisible && ' ｜ ガイド非表示 (Tab)'}
        </div>
      )}
    </div>
  );
}
