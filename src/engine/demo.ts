/** 動作確認用のデモ画像(簡易マネキン)を生成する */
export function createDemoImage(): Promise<HTMLImageElement> {
  const w = 800;
  const h = 1000;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#8d8d94';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#b9b9c2';
  // 頭
  ctx.beginPath();
  ctx.ellipse(400, 130, 62, 78, 0, 0, Math.PI * 2);
  ctx.fill();
  // 首
  ctx.fillRect(378, 195, 44, 45);
  // 胴体
  ctx.beginPath();
  ctx.moveTo(290, 250);
  ctx.quadraticCurveTo(400, 225, 510, 250);
  ctx.quadraticCurveTo(525, 400, 495, 560);
  ctx.quadraticCurveTo(400, 590, 305, 560);
  ctx.quadraticCurveTo(275, 400, 290, 250);
  ctx.fill();
  // 腕
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#b9b9c2';
  ctx.lineWidth = 62;
  ctx.beginPath();
  ctx.moveTo(300, 285);
  ctx.quadraticCurveTo(245, 400, 235, 520);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(500, 285);
  ctx.quadraticCurveTo(555, 400, 565, 520);
  ctx.stroke();
  // 脚
  ctx.lineWidth = 78;
  ctx.beginPath();
  ctx.moveTo(355, 570);
  ctx.lineTo(345, 900);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(445, 570);
  ctx.lineTo(455, 900);
  ctx.stroke();

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.font = '22px sans-serif';
  ctx.fillText('DEMO — 自分のレンダー画像を読み込んでください', 130, 970);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = c.toDataURL('image/png');
  });
}
