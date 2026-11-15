"use client";

import { useEffect, useRef, useState } from "react";

const FONTS = {
  bold: { label: "Đậm rõ · Sans", value: 'Arial, "Segoe UI", sans-serif' },
  condensed: { label: "Tiêu đề · Impact", value: 'Impact, "Arial Black", Arial, sans-serif' },
  rounded: { label: "Mềm mại · Rounded", value: '"Arial Rounded MT Bold", "Trebuchet MS", Arial, sans-serif' },
  serif: { label: "Điện ảnh · Serif", value: 'Georgia, "Times New Roman", serif' },
};
const LOOKS = {
  story: { label: "Kể chuyện", color: "#ffe066", background: "#ac142b", font: "bold" },
  clean: { label: "Tối giản", color: "#ffffff", background: "#202024", font: "rounded" },
  cinema: { label: "Điện ảnh", color: "#f9e8c2", background: "#252326", font: "serif" },
};
const DEFAULT_TONE = { brightness: 100, contrast: 100, saturation: 100 };

function wrapTitle(context, text, width) {
  const words = text.trim().split(/\s+/u);
  const lines = [];
  let line = "";
  for (const word of words) {
    // Also split long titles without spaces to keep text inside the image.
    const parts = context.measureText(word).width > width ? Array.from(word) : [word];
    for (const part of parts) {
      const joined = line ? line + (parts.length === 1 ? " " : "") + part : part;
      if (line && context.measureText(joined).width > width) { lines.push(line); line = part; }
      else line = joined;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function ThumbnailDesigner({ source, title, onTranslateTitle, onApply, onClose }) {
  const canvas = useRef(null);
  const captionBounds = useRef(null);
  const drag = useRef(null);
  const [image, setImage] = useState(null);
  const [text, setText] = useState("");
  const [font, setFont] = useState("bold");
  const [color, setColor] = useState("#ffe066");
  const [background, setBackground] = useState("#ac142b");
  const [position, setPosition] = useState("auto");
  const [captionOffset, setCaptionOffset] = useState(null);
  const [portraitSide, setPortraitSide] = useState("right");
  const [showBackground, setShowBackground] = useState(false);
  const [tone, setTone] = useState(DEFAULT_TONE);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    if (!/^data:image\/(jpeg|png);base64,/i.test(source)) { setError("Chọn ảnh JPEG/PNG từ video hoặc máy trước khi thiết kế."); return; }
    const picture = new Image();
    picture.onload = () => { if (active) setImage(picture); };
    picture.onerror = () => { if (active) setError("Không đọc được ảnh bìa. Hãy chọn lại ảnh."); };
    picture.src = source;
    return () => { active = false; };
  }, [source]);

  useEffect(() => {
    if (!image || !canvas.current) return;
    const context = canvas.current.getContext("2d");
    captionBounds.current = null;
    context.clearRect(0, 0, 1280, 720);
    context.fillStyle = "#101012";
    context.fillRect(0, 0, 1280, 720);
    context.filter = `brightness(${tone.brightness}%) contrast(${tone.contrast}%) saturate(${tone.saturation}%)`;
    const portrait = image.naturalWidth / image.naturalHeight < 1;
    const imageOnRight = portraitSide === "right";
    const textPosition = position === "auto" ? (portrait ? "center" : "bottom") : position;
    if (portrait) {
      const cover = Math.max(1320 / image.naturalWidth, 760 / image.naturalHeight);
      context.filter += " blur(20px)";
      context.drawImage(image, (1280-image.naturalWidth*cover)/2, (720-image.naturalHeight*cover)/2, image.naturalWidth*cover, image.naturalHeight*cover);
    }
    context.filter = `brightness(${tone.brightness}%) contrast(${tone.contrast}%) saturate(${tone.saturation}%)`;
    const scale = Math.min(1280 / image.naturalWidth, 720 / image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    const imageX = portrait ? (imageOnRight ? 1280 - width - 32 : 32) : (1280 - width) / 2;
    context.drawImage(image, imageX, (720 - height) / 2, width, height);
    context.filter = "none";
    const shade = portrait
      ? context.createLinearGradient(imageOnRight ? 0 : 1280, 0, imageOnRight ? imageX + 100 : imageX + width - 100, 0)
      : context.createLinearGradient(0, 0, 0, 720);
    if (portrait) { shade.addColorStop(0, "#080a10ef"); shade.addColorStop(.72, "#080a10db"); shade.addColorStop(1, "#080a1000"); }
    else { shade.addColorStop(0, textPosition === "top" ? "#080a10df" : "#080a1000"); shade.addColorStop(1, textPosition === "bottom" ? "#080a10df" : "#080a1000"); }
    if (portrait || text.trim()) { context.fillStyle = shade; context.fillRect(0,0,1280,720); }
    if (text.trim()) {
      const textWidth = portrait ? 1280 - width - 152 : 1110;
      let size = portrait ? 78 : 72, lines;
      do {
        context.font = `800 ${size}px ${FONTS[font].value}`;
        lines = wrapTitle(context, text.replace(/\s+/gu, " "), textWidth);
        if (lines.length <= (portrait ? 4 : 3) || size === 26) break;
        size -= 2;
      } while (true);
      const lineHeight = size * 1.24;
      const boxHeight = lines.length * lineHeight;
      const baseX = portrait ? (imageOnRight ? 56 : imageX + width + 64) : 640;
      const baseY = textPosition === "center" ? (720 - boxHeight) / 2 : textPosition === "top" ? 60 : 642 - boxHeight;
      const captionWidth = Math.max(...lines.map(line => context.measureText(line).width));
      const baseLeft = portrait ? baseX : baseX - captionWidth / 2;
      const left = Math.max(16, Math.min(1264 - captionWidth, baseLeft + (captionOffset?.x || 0)));
      const y = Math.max(16, Math.min(704 - boxHeight, baseY + (captionOffset?.y || 0)));
      const x = portrait ? left : left + captionWidth / 2;
      captionBounds.current = { left, top: y, width: captionWidth, height: boxHeight, baseLeft, baseY };
      context.textBaseline = "top";
      context.textAlign = portrait ? "left" : "center";
      context.lineJoin = "round";
      context.strokeStyle = "#080a10";
      context.lineWidth = Math.max(2, size * .045);
      lines.forEach((line, index) => {
        const lineY = y + index * lineHeight;
        if (showBackground) {
          const measured = context.measureText(line).width;
          context.fillStyle = background;
          context.globalAlpha = .88;
          context.fillRect(portrait ? x-12 : x-measured/2-12, lineY-6, measured+24, lineHeight-2);
          context.globalAlpha = 1;
        }
        context.shadowColor = "#000b";
        context.shadowBlur = 14;
        context.shadowOffsetY = 4;
        context.fillStyle = index === lines.length-1 ? color : "#ffffff";
        context.strokeText(line, x, lineY);
        context.fillText(line, x, lineY);
        context.shadowBlur = 0; context.shadowOffsetY = 0;
      });
    }
    setReady(true);
  }, [image, text, font, color, background, position, tone, showBackground, portraitSide, captionOffset]);

  const pointerPosition = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * 1280 / rect.width, y: (event.clientY - rect.top) * 720 / rect.height };
  };
  const startDrag = event => {
    const bounds = captionBounds.current;
    if (!bounds || !event.isPrimary || event.button !== 0) return;
    const point = pointerPosition(event);
    const padding = 14;
    if (point.x < bounds.left - padding || point.x > bounds.left + bounds.width + padding ||
        point.y < bounds.top - padding || point.y > bounds.top + bounds.height + padding) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: point.x - bounds.left, y: point.y - bounds.top };
  };
  const moveDrag = event => {
    const bounds = captionBounds.current;
    if (!bounds || drag.current?.id !== event.pointerId) return;
    const point = pointerPosition(event);
    setCaptionOffset({ x: point.x - drag.current.x - bounds.baseLeft, y: point.y - drag.current.y - bounds.baseY });
  };
  const endDrag = event => {
    if (drag.current?.id === event.pointerId) drag.current = null;
  };
  const moveWithKeys = event => {
    const bounds = captionBounds.current;
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!bounds || !direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 20 : 5;
    setCaptionOffset({ x: bounds.left - bounds.baseLeft + direction[0] * step, y: bounds.top - bounds.baseY + direction[1] * step });
  };

  const chooseLook = key => {
    const look = LOOKS[key];
    setFont(look.font); setColor(look.color); setBackground(look.background);
  };
  const autoLayout = async () => {
    const caption = /[\p{Script=Han}]/u.test(title || "") ? await onTranslateTitle?.() : title;
    if (!caption || /[\p{Script=Han}]/u.test(caption)) { setError("Chưa có tiêu đề tiếng Việt. Hãy dịch hoặc nhập chữ tiếng Việt cho ảnh bìa."); return; }
    setError("");
    const cleanTitle = caption.replace(/#[^\s]+/gu, "").replace(/\s*(?:【[^】]+】|\[[^\]]+\])\s*$/u, "").replace(/\s+/gu, " ").trim();
    setText((cleanTitle || caption).slice(0, 100));
    setPosition("auto");
    setCaptionOffset(null);
  };
  const apply = () => {
    if (!ready || !canvas.current) return;
    if (/[\p{Script=Han}]/u.test(text)) { setError("Chữ trên ảnh vẫn còn tiếng Trung. Bấm Tự bố trí theo tiêu đề hoặc sửa thành tiếng Việt trước khi áp dụng."); return; }
    try {
      let data;
      for (const quality of [.92, .8, .65, .5]) {
        data = canvas.current.toDataURL("image/jpeg", quality);
        if ((data.length - data.indexOf(",") - 1) * .75 <= 2 * 1024 * 1024) { onApply(data); return; }
      }
      setError("Ảnh vẫn lớn hơn 2 MB. Hãy chọn ảnh nguồn đơn giản hơn.");
    } catch { setError("Không xuất được ảnh. Hãy chọn lại ảnh nguồn."); }
  };
  return <section className="thumbnail-designer" aria-label="Thiết kế ảnh bìa">
    <header><div><strong>Thiết kế thumbnail</strong><p>Đổi màu, thêm chữ và xem ngay trên ảnh · 1280 × 720</p></div><button type="button" className="btn secondary" onClick={onClose}>Đóng chỉnh ảnh</button></header>
    {error && <p role="alert" className="youtube-error">{error}</p>}
    <canvas ref={canvas} width={1280} height={720} tabIndex={text.trim() ? 0 : undefined} aria-label="Ảnh bìa xem trước. Kéo chữ hoặc dùng phím mũi tên để di chuyển." className={text.trim() ? "thumbnail-draggable" : undefined} onPointerDown={startDrag} onPointerMove={moveDrag} onLostPointerCapture={endDrag} onPointerCancel={endDrag} onKeyDown={moveWithKeys} />
    {text.trim() && <small>Kéo chữ trên ảnh để đổi vị trí. Dùng phím mũi tên để chỉnh từng bước.</small>}
    <div className="thumbnail-looks">{Object.entries(LOOKS).map(([key, look]) => <button type="button" className="btn secondary" key={key} onClick={()=>chooseLook(key)}>{look.label}</button>)}<button type="button" className="btn primary" onClick={autoLayout} disabled={!title}>Tự bố trí theo tiêu đề</button></div>
    <label>Chữ trên ảnh<textarea rows={2} maxLength={100} placeholder="Nhập tiêu đề ngắn, dễ đọc…" value={text} onChange={event=>{setText(event.target.value);setError("");}} /></label>
    <label className="thumbnail-background-toggle"><input type="checkbox" checked={!showBackground} onChange={event=>setShowBackground(!event.target.checked)} />Không nền chữ · chỉ giữ chữ và viền</label>
    <div className="thumbnail-controls"><label>Kiểu chữ<select value={font} onChange={event=>setFont(event.target.value)}>{Object.entries(FONTS).map(([key, value])=><option key={key} value={key}>{value.label}</option>)}</select></label><label>Vị trí chữ<select value={captionOffset ? "free" : position} onChange={event=>{setPosition(event.target.value);setCaptionOffset(null);}}><option value="free" disabled>Kéo tự do</option><option value="auto">Tự căn</option><option value="top">Phía trên</option><option value="bottom">Phía dưới</option></select></label><label>Màu chữ<input type="color" value={color} onChange={event=>setColor(event.target.value)} /></label><label>Màu nền chữ<input type="color" disabled={!showBackground} value={background} onChange={event=>setBackground(event.target.value)} /></label></div>
    {image && image.naturalWidth < image.naturalHeight && <label>Vị trí ảnh dọc<select value={portraitSide} onChange={event => {setPortraitSide(event.target.value);setCaptionOffset(null);}}><option value="right">Ảnh phải · Chữ trái</option><option value="left">Ảnh trái · Chữ phải</option></select></label>}
    <div className="thumbnail-tone">{[["brightness", "Độ sáng", 60, 150], ["contrast", "Tương phản", 60, 160], ["saturation", "Độ rực", 0, 180]].map(([key, label, min, max])=><label key={key}>{label} <output>{tone[key]}%</output><input type="range" min={min} max={max} value={tone[key]} onChange={event=>setTone(current=>({...current,[key]:Number(event.target.value)}))} /></label>)}</div>
    <div className="library-actions"><button type="button" className="btn secondary" onClick={()=>{setTone(DEFAULT_TONE);setText("");chooseLook("story");setPosition("auto");setCaptionOffset(null);setPortraitSide("right");setShowBackground(false);}}>Đặt lại</button><button type="button" className="btn primary" disabled={!ready || Boolean(error)} onClick={apply}>Dùng ảnh bìa này</button></div>
    <small>Chỉnh ảnh trong trình duyệt. Bấm “Dùng ảnh bìa này” để áp dụng vào lượt đăng. Font hiển thị tùy theo thiết bị.</small>
  </section>;
}
