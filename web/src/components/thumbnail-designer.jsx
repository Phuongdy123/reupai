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
const NANO_BANANA_STYLES = [
  { id: "anime", label: "Anime Drama", prompt: "Dramatic anime story poster, expressive lead character, vivid rim lighting, sharp foreground and background layers" },
  { id: "cinema", label: "Điện ảnh 16:9", prompt: "Cinematic movie key art, moody atmospheric lighting, intense expression, shallow depth of field, rich color grading" },
  { id: "viral", label: "Viral YouTube", prompt: "High-contrast viral YouTube thumbnail artwork, dynamic pose, glowing energy accents, clean lower third space for headline" },
  { id: "3d", label: "3D Stylized", prompt: "High-detail 3D stylized illustration, dramatic studio lighting, crisp textures, epic composition" },
];
const NANO_BANANA_MODELS = ["gemini-2.5-flash-image", "gemini-3.1-flash-image-preview", "gemini-2.0-flash-exp-image-generation"];
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

export function ThumbnailDesigner({ source, artworkOnly, title, accountId, channelId, onTranslateTitle, onGenerateCaption, onGenerateArtwork, onApply, onClose }) {
  const canvas = useRef(null);
  const captionBounds = useRef(null);
  const drag = useRef(null);
  const [image, setImage] = useState(null);
  const [text, setText] = useState("");
  const [font, setFont] = useState("bold");
  const [color, setColor] = useState("#ffe066");
  const [background, setBackground] = useState("#ac142b");
  const [position, setPosition] = useState("auto");
  const [captionPosition, setCaptionPosition] = useState(null);
  const [portraitSide, setPortraitSide] = useState("right");
  const [showBackground, setShowBackground] = useState(false);
  const [tone, setTone] = useState(DEFAULT_TONE);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [savedTemplate, setSavedTemplate] = useState(null);
  const [templateMessage, setTemplateMessage] = useState("");
  const [prompt, setPrompt] = useState("");
  const [artDirection, setArtDirection] = useState("");
  const [imageKey, setImageKey] = useState("");
  const [generatedImage, setGeneratedImage] = useState("");
  const [generatingImage, setGeneratingImage] = useState(false);
  const imageRequest = useRef(null);
  const imageSource = generatedImage || (artworkOnly ? "" : source);
  const orientation = image && (image.naturalWidth < image.naturalHeight ? "portrait" : "landscape");
  const templateKey = orientation && `reupai:thumbnail-template:v1:${accountId || "local"}:${channelId || "default"}:${orientation}`;

  useEffect(() => {
    setSavedTemplate(null);
    setTemplateMessage("");
    if (!templateKey) return;
    try {
      const value = JSON.parse(window.localStorage.getItem(templateKey));
      if (value && Object.hasOwn(FONTS, value.font) && ["auto", "top", "bottom"].includes(value.position)) setSavedTemplate(value);
    } catch { /* An unavailable or invalid saved template does not block editing. */ }
  }, [templateKey]);

  useEffect(() => () => imageRequest.current?.abort(), []);

  useEffect(() => {
    let active = true;
    setReady(false);
    setImage(null);
    if (!imageSource) return;
    if (!/^data:image\/(jpeg|png);base64,/i.test(imageSource)) { setError("Chọn ảnh JPEG/PNG từ video hoặc máy trước khi thiết kế."); return; }
    const picture = new Image();
    picture.onload = () => { if (active) setImage(picture); };
    picture.onerror = () => { if (active) setError("Không đọc được ảnh bìa. Hãy chọn lại ảnh."); };
    picture.src = imageSource;
    return () => { active = false; };
  }, [imageSource]);

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
      const left = Math.max(16, Math.min(1264 - captionWidth, captionPosition?.x ?? baseLeft));
      const y = Math.max(16, Math.min(704 - boxHeight, captionPosition?.y ?? baseY));
      const x = portrait ? left : left + captionWidth / 2;
      captionBounds.current = { left, top: y, width: captionWidth, height: boxHeight };
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
  }, [image, text, font, color, background, position, tone, showBackground, portraitSide, captionPosition]);

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
    setCaptionPosition({ x: point.x - drag.current.x, y: point.y - drag.current.y });
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
    setCaptionPosition({ x: bounds.left + direction[0] * step, y: bounds.top + direction[1] * step });
  };

  const chooseLook = key => {
    const look = LOOKS[key];
    setFont(look.font); setColor(look.color); setBackground(look.background);
  };
  const saveTemplate = () => {
    if (!templateKey) return;
    const bounds = captionBounds.current;
    const value = {
      font, color, background, position, tone, showBackground, portraitSide,
      captionPosition: captionPosition && bounds ? { x: bounds.left, y: bounds.top } : null,
    };
    try {
      window.localStorage.setItem(templateKey, JSON.stringify(value));
      setSavedTemplate(value);
      setTemplateMessage("Đã lưu. Tự bố trí sẽ dùng mẫu này cho ảnh cùng chiều trên trình duyệt này.");
    } catch { setTemplateMessage("Trình duyệt không lưu được mẫu ảnh."); }
  };
  const applyTemplate = value => {
    setFont(value.font); setColor(value.color); setBackground(value.background);
    setPosition(value.position); setTone(value.tone); setShowBackground(value.showBackground);
    setPortraitSide(value.portraitSide); setCaptionPosition(value.captionPosition);
    setTemplateMessage("Đã dùng mẫu đã lưu.");
  };
  const layoutCaption = caption => {
    if (!caption?.trim() || /\p{Script=Han}/u.test(caption)) throw new Error("Chưa có chữ tiếng Việt cho ảnh bìa. Hãy thử lại hoặc nhập chữ thủ công.");
    const cleanTitle = caption.replace(/#[^\s]+/gu, "").replace(/\s*(?:【[^】]+】|\[[^\]]+\])\s*$/u, "").replace(/\s+/gu, " ").trim();
    setText((cleanTitle || caption).slice(0, 100));
    if (savedTemplate) applyTemplate(savedTemplate);
    else { setPosition("auto"); setCaptionPosition(null); }
  };
  const autoLayout = async () => {
    setError("");
    try { layoutCaption(/\p{Script=Han}/u.test(title || "") ? await onTranslateTitle?.() : title); }
    catch (requestError) { setError(requestError.message); }
  };
  const generateCaption = async () => {
    if (!prompt.trim()) return;
    setError("");
    try { layoutCaption(await onGenerateCaption(prompt.trim())); }
    catch (requestError) { setError(requestError.message || "Chưa tạo được chữ ảnh bìa."); }
  };
  const fetchFreeFluxImage = async (scenePrompt, signal) => {
    const seed = Math.floor(Math.random() * 999999) + 1;
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(scenePrompt)}?width=1280&height=720&model=flux&nologo=true&seed=${seed}`;
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]) });
    if (!response.ok) throw new Error(`Dịch vụ tạo ảnh miễn phí tạm bận (HTTP ${response.status}). Hãy thử lại sau.`);
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Không đọc được ảnh tải về."));
      reader.readAsDataURL(blob);
    });
    if (!/^data:image\/(jpeg|png|webp);base64,/i.test(dataUrl)) throw new Error("Ảnh miễn phí trả về không hợp lệ.");
    return dataUrl;
  };

  const generateArtwork = async () => {
    if (imageRequest.current) return;
    const reference = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(source);
    const controller = new AbortController();
    imageRequest.current = controller;
    setGeneratingImage(true);
    setError("");
    const freePrompt = `${artDirection.trim() || "Dramatic anime story poster, expressive lead character, vivid rim lighting"}, ${title ? `context: ${title}, ` : ""}16:9 YouTube thumbnail artwork, no text, no watermark`.slice(0, 380);
    const artworkPrompt = `Illustrate a completely new, polished 16:9 YouTube story thumbnail. The reference image is for character identity, art style and story context only. Never reuse the original frame as the background, trace its composition, or just retouch it. Stage a fresh scene with different poses and a different camera angle, a prominent lead character, expressive faces, vivid lighting and clear foreground and background layers. Compose with visual energy and strong contrast like an anime story poster, keeping the lower third visually quiet for a Vietnamese headline to be added later. Do not draw any words, subtitles, logos, borders or interface elements. Stay faithful to the video context: ${title || "the reference image"}. Art direction from the user: ${artDirection.trim() || "dramatic anime story poster"}.`;
    try {
      let newImage = null;
      let skipBackendNano = false;
      try {
        const exhaustedUntil = Number(window.sessionStorage.getItem("reupai:nano-banana-exhausted-until") || 0);
        skipBackendNano = exhaustedUntil > Date.now();
      } catch {}
      if (reference && onGenerateArtwork && !imageKey.trim() && !skipBackendNano) {
        try {
          const result = await onGenerateArtwork(source, artworkPrompt, controller.signal);
          newImage = result?.image || null;
        } catch (backendErr) {
          if (controller.signal.aborted) throw backendErr;
          try {
            window.sessionStorage.setItem("reupai:nano-banana-exhausted-until", String(Date.now() + 15 * 60 * 1000));
          } catch {}
          // Auto-fallback to free Flux if backend Nano Banana hits quota/billing/unavailable
          newImage = await fetchFreeFluxImage(freePrompt, controller.signal);
        }
      } else if (reference && imageKey.trim()) {
        for (const modelName of NANO_BANANA_MODELS) {
          const generationConfig = modelName === "gemini-2.0-flash-exp-image-generation"
            ? { responseModalities: ["TEXT", "IMAGE"] }
            : { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "1K" } };
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": imageKey.trim() },
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]),
            body: JSON.stringify({
              contents: [{ parts: [
                { text: artworkPrompt },
                { inlineData: { mimeType: reference[1], data: reference[2] } },
              ] }],
              generationConfig,
            }),
          });
          if (response.status === 404 || response.status === 429 || response.status === 401 || response.status === 403) continue;
          if (!response.ok) continue;
          const result = await response.json();
          const artwork = result.candidates?.flatMap(candidate => candidate.content?.parts || []).map(part => part.inlineData).find(part => /^image\/(jpeg|png)$/i.test(part?.mimeType) && /^[A-Za-z0-9+/=]+$/.test(part.data) && part.data.length <= 12 * 1024 * 1024);
          if (artwork) {
            newImage = `data:${artwork.mimeType};base64,${artwork.data}`;
            break;
          }
        }
        if (!newImage && !controller.signal.aborted) {
          newImage = await fetchFreeFluxImage(freePrompt, controller.signal);
        }
      } else {
        newImage = await fetchFreeFluxImage(freePrompt, controller.signal);
      }
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(newImage || "")) throw new Error("Không tạo được ảnh dùng được.");
      if (!controller.signal.aborted && newImage !== imageSource) {
        setReady(false);
        setGeneratedImage(newImage);
        if (!text.trim() && title && !/\p{Script=Han}/u.test(title)) {
          try { layoutCaption(title); } catch {}
        }
      }
    } catch (requestError) {
      if (!controller.signal.aborted) setError(requestError.name === "TimeoutError" ? "Tạo ảnh quá lâu. Hãy thử lại." : requestError.message);
    } finally {
      imageRequest.current = null;
      if (!controller.signal.aborted) setGeneratingImage(false);
    }
  };
  const generateFreeArtwork = async () => {
    if (imageRequest.current) return;
    const controller = new AbortController();
    imageRequest.current = controller;
    setGeneratingImage(true);
    setError("");
    const scenePrompt = `${artDirection.trim() || "Dramatic anime story poster, expressive lead character, vivid rim lighting"}, ${title ? `context: ${title}, ` : ""}16:9 YouTube thumbnail artwork, no text, no watermark`.slice(0, 380);
    try {
      const dataUrl = await fetchFreeFluxImage(scenePrompt, controller.signal);
      if (!controller.signal.aborted) {
        setReady(false);
        setGeneratedImage(dataUrl);
      }
    } catch (requestError) {
      if (!controller.signal.aborted) setError(requestError.name === "TimeoutError" ? "Tạo ảnh miễn phí quá lâu. Hãy thử lại." : requestError.message);
    } finally {
      imageRequest.current = null;
      if (!controller.signal.aborted) setGeneratingImage(false);
    }
  };

  const apply = () => {
    if (!ready || !canvas.current || (artworkOnly && !generatedImage)) return;
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
    {(artworkOnly || onGenerateArtwork) && <div className="youtube-ai-draft">
      <div className="thumbnail-reference"><img src={source} alt="Khung hình tham chiếu" /><div><strong>Nano Banana AI Thumbnail (16:9)</strong><p>Dùng Gemini Nano Banana dựng ảnh bìa mới sắc nét từ khung hình video.</p></div></div>
      <div className="thumbnail-looks">
        {NANO_BANANA_STYLES.map(style => (
          <button key={style.id} type="button" className="btn secondary" onClick={() => setArtDirection(style.prompt)}>
            {style.label}
          </button>
        ))}
      </div>
      <label>Phong cách ảnh Nano Banana<input value={artDirection} maxLength={400} onChange={event => setArtDirection(event.target.value)} placeholder="Chọn nhanh style ở trên hoặc tự mô tả cảnh mới…" /></label>
      {onGenerateArtwork && <small>Để trống key để dùng kết nối Gemini / API key trong Cài đặt.</small>}
      <label>{onGenerateArtwork ? "Gemini API key (tùy chọn)" : "Gemini API key"}<input type="password" value={imageKey} autoComplete="off" spellCheck={false} onChange={event => setImageKey(event.target.value)} placeholder="API key của project Gemini" /></label>
      <div className="thumbnail-looks">
        <button type="button" className="btn primary" disabled={generatingImage} onClick={generateArtwork}>{generatingImage ? "Đang vẽ ảnh AI…" : generatedImage ? "Tạo ảnh AI khác" : "Tạo ảnh AI (Nano Banana / Free)"}</button>
        <button type="button" className="btn secondary" disabled={generatingImage} onClick={generateFreeArtwork}>{generatingImage ? "Đang vẽ…" : "Tạo ảnh AI Free (Flux · không cần key)"}</button>
      </div>
    </div>}
    {imageSource && <>
    {artworkOnly && <strong>Ảnh mới · Xem trước</strong>}
    <canvas ref={canvas} width={1280} height={720} tabIndex={text.trim() ? 0 : undefined} aria-label="Ảnh bìa xem trước. Kéo chữ hoặc dùng phím mũi tên để di chuyển." className={text.trim() ? "thumbnail-draggable" : undefined} onPointerDown={startDrag} onPointerMove={moveDrag} onLostPointerCapture={endDrag} onPointerCancel={endDrag} onKeyDown={moveWithKeys} />
    {text.trim() && <small>Kéo chữ trên ảnh để đổi vị trí. Dùng phím mũi tên để chỉnh từng bước.</small>}
    <div className="thumbnail-looks">{Object.entries(LOOKS).map(([key, look]) => <button type="button" className="btn secondary" key={key} onClick={()=>chooseLook(key)}>{look.label}</button>)}<button type="button" className="btn primary" onClick={autoLayout} disabled={!title}>Tự bố trí theo tiêu đề</button></div>
    <div className="thumbnail-looks"><button type="button" className="btn secondary" disabled={!ready} onClick={saveTemplate}>{savedTemplate ? "Cập nhật mẫu đã lưu" : "Lưu làm mẫu"}</button>{savedTemplate && <button type="button" className="btn secondary" onClick={() => applyTemplate(savedTemplate)}>Dùng mẫu đã lưu</button>}</div>
    {templateMessage && <small role="status">{templateMessage}</small>}
    {onGenerateCaption && <div className="youtube-ai-draft"><label>Yêu cầu cho AI<input value={prompt} maxLength={400} onChange={event => setPrompt(event.target.value)} placeholder="Ví dụ: Câu ngắn, bí ẩn, nhấn vào cuốn nhật ký" /></label><button type="button" className="btn secondary" disabled={!ready || !prompt.trim()} onClick={generateCaption}>AI viết chữ và ghép ảnh</button></div>}
    <label>Chữ trên ảnh<textarea rows={2} maxLength={100} placeholder="Nhập tiêu đề ngắn, dễ đọc…" value={text} onChange={event=>{setText(event.target.value);setError("");}} /></label>
    <label className="thumbnail-background-toggle"><input type="checkbox" checked={!showBackground} onChange={event=>setShowBackground(!event.target.checked)} />Không nền chữ · chỉ giữ chữ và viền</label>
    <div className="thumbnail-controls"><label>Kiểu chữ<select value={font} onChange={event=>setFont(event.target.value)}>{Object.entries(FONTS).map(([key, value])=><option key={key} value={key}>{value.label}</option>)}</select></label><label>Vị trí chữ<select value={captionPosition ? "free" : position} onChange={event=>{setPosition(event.target.value);setCaptionPosition(null);}}><option value="free" disabled>Kéo tự do</option><option value="auto">Tự căn</option><option value="top">Phía trên</option><option value="bottom">Phía dưới</option></select></label><label>Màu chữ<input type="color" value={color} onChange={event=>setColor(event.target.value)} /></label><label>Màu nền chữ<input type="color" disabled={!showBackground} value={background} onChange={event=>setBackground(event.target.value)} /></label></div>
    {image && image.naturalWidth < image.naturalHeight && <label>Vị trí ảnh dọc<select value={portraitSide} onChange={event => {setPortraitSide(event.target.value);setCaptionPosition(null);}}><option value="right">Ảnh phải · Chữ trái</option><option value="left">Ảnh trái · Chữ phải</option></select></label>}
    <div className="thumbnail-tone">{[["brightness", "Độ sáng", 60, 150], ["contrast", "Tương phản", 60, 160], ["saturation", "Độ rực", 0, 180]].map(([key, label, min, max])=><label key={key}>{label} <output>{tone[key]}%</output><input type="range" min={min} max={max} value={tone[key]} onChange={event=>setTone(current=>({...current,[key]:Number(event.target.value)}))} /></label>)}</div>
    <div className="library-actions"><button type="button" className="btn secondary" onClick={()=>{setTone(DEFAULT_TONE);setText("");chooseLook("story");setPosition("auto");setCaptionPosition(null);setPortraitSide("right");setShowBackground(false);}}>Đặt lại</button><button type="button" className="btn primary" disabled={!ready || generatingImage || Boolean(error)} onClick={apply}>Dùng ảnh bìa này</button></div>
    </>}
  </section>;
}
