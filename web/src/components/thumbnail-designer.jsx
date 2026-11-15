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
  const [image, setImage] = useState(null);
  const [text, setText] = useState("");
  const [font, setFont] = useState("bold");
  const [color, setColor] = useState("#ffe066");
  const [background, setBackground] = useState("#ac142b");
  const [position, setPosition] = useState("top");
  const [showBackground, setShowBackground] = useState(true);
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
    context.clearRect(0, 0, 1280, 720);
    context.fillStyle = "#101012";
    context.fillRect(0, 0, 1280, 720);
    context.filter = `brightness(${tone.brightness}%) contrast(${tone.contrast}%) saturate(${tone.saturation}%)`;
    // Keep the entire source frame: portrait videos are never cropped away.
    const scale = Math.min(1280 / image.naturalWidth, 720 / image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    context.drawImage(image, (1280 - width) / 2, (720 - height) / 2, width, height);
    context.filter = "none";
    if (text.trim()) {
      let size = 92, lines;
      do {
        context.font = `900 ${size}px ${FONTS[font].value}`;
        lines = wrapTitle(context, text.replace(/\s+/gu, " "), 1140);
        if (lines.length <= 3) break;
        size -= 2;
      } while (size > 26);
      const lineHeight = size * 1.2;
      const boxHeight = lines.length * lineHeight + 36;
      const y = position === "top" ? 28 : 720 - boxHeight - 28;
      if (showBackground) {
        context.fillStyle = background;
        context.globalAlpha = .9;
        context.fillRect(32, y, 1216, boxHeight);
        context.globalAlpha = 1;
      }
      context.textBaseline = "top";
      context.textAlign = "center";
      context.lineJoin = "round";
      context.strokeStyle = "#101012";
      context.lineWidth = Math.max(3, size * .09);
      context.fillStyle = color;
      lines.forEach((line, index) => {
        context.strokeText(line, 640, y + 18 + index * lineHeight);
        context.fillText(line, 640, y + 18 + index * lineHeight);
      });
    }
    setReady(true);
  }, [image, text, font, color, background, position, tone, showBackground]);

  const chooseLook = key => {
    const look = LOOKS[key];
    setFont(look.font); setColor(look.color); setBackground(look.background);
  };
  const autoLayout = async () => {
    const caption = /[\p{Script=Han}]/u.test(title || "") ? await onTranslateTitle?.() : title;
    if (!caption || /[\p{Script=Han}]/u.test(caption)) { setError("Chưa có tiêu đề tiếng Việt. Hãy dịch hoặc nhập chữ tiếng Việt cho ảnh bìa."); return; }
    setError("");
    setText(String(caption || "").replace(/#[^\s]+/gu, "").replace(/\s+/gu, " ").trim().slice(0, 100));
    chooseLook("story"); setPosition("top");
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
    <canvas ref={canvas} width={1280} height={720} aria-label="Ảnh bìa xem trước" />
    <div className="thumbnail-looks">{Object.entries(LOOKS).map(([key, look]) => <button type="button" className="btn secondary" key={key} onClick={()=>chooseLook(key)}>{look.label}</button>)}<button type="button" className="btn primary" onClick={autoLayout} disabled={!title}>Tự bố trí theo tiêu đề</button></div>
    <label>Chữ trên ảnh<textarea rows={2} maxLength={100} placeholder="Nhập tiêu đề ngắn, dễ đọc…" value={text} onChange={event=>{setText(event.target.value);setError("");}} /></label>
    <label className="thumbnail-background-toggle"><input type="checkbox" checked={!showBackground} onChange={event=>setShowBackground(!event.target.checked)} />Không nền chữ · chỉ giữ chữ và viền</label>
    <div className="thumbnail-controls"><label>Kiểu chữ<select value={font} onChange={event=>setFont(event.target.value)}>{Object.entries(FONTS).map(([key, value])=><option key={key} value={key}>{value.label}</option>)}</select></label><label>Vị trí chữ<select value={position} onChange={event=>setPosition(event.target.value)}><option value="top">Phía trên</option><option value="bottom">Phía dưới</option></select></label><label>Màu chữ<input type="color" value={color} onChange={event=>setColor(event.target.value)} /></label><label>Màu nền chữ<input type="color" disabled={!showBackground} value={background} onChange={event=>setBackground(event.target.value)} /></label></div>
    <div className="thumbnail-tone">{[["brightness", "Độ sáng", 60, 150], ["contrast", "Tương phản", 60, 160], ["saturation", "Độ rực", 0, 180]].map(([key, label, min, max])=><label key={key}>{label} <output>{tone[key]}%</output><input type="range" min={min} max={max} value={tone[key]} onChange={event=>setTone(current=>({...current,[key]:Number(event.target.value)}))} /></label>)}</div>
    <div className="library-actions"><button type="button" className="btn secondary" onClick={()=>{setTone(DEFAULT_TONE);setText("");chooseLook("story");setPosition("top");setShowBackground(true);}}>Đặt lại</button><button type="button" className="btn primary" disabled={!ready || Boolean(error)} onClick={apply}>Dùng ảnh bìa này</button></div>
    <small>Chỉnh ảnh trong trình duyệt. Bấm “Dùng ảnh bìa này” để áp dụng vào lượt đăng. Font hiển thị tùy theo thiết bị.</small>
  </section>;
}
