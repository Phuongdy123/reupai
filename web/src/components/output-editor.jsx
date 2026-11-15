"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icon";
import { ErrorMessage, Loading, Notice, modeLabel } from "./library-ui";
import { OutputTranscriptEditor } from "./output-transcript-editor";
import { OutputYoutubeActions } from "./output-youtube-actions";

const cleanRect = (value) => {
  if (!value || !["x", "y", "width", "height"].every((key) => Number.isFinite(Number(value[key])))) return null;
  const width = Math.max(2, Math.round(Number(value.width)));
  const height = Math.max(2, Math.round(Number(value.height)));
  return { x: Math.max(0, Math.round(Number(value.x))), y: Math.max(0, Math.round(Number(value.y))), width, height };
};

function drawRect(context, rect, color, label) {
  if (!rect) return;
  context.save();
  context.strokeStyle = color;
  context.fillStyle = `${color}22`;
  context.lineWidth = Math.max(2, Math.round(context.canvas.width / 480));
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  context.font = `${Math.max(14, Math.round(context.canvas.width / 45))}px sans-serif`;
  context.fillStyle = color;
  context.fillText(label, rect.x + 6, Math.max(18, rect.y - 7));
  context.restore();
}

function drawHandles(context, rect, color) {
  if (!rect) return;
  const radius = Math.max(14, Math.round(context.canvas.width / 96));
  context.save();
  context.fillStyle = color;
  [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]].forEach(([x, y]) => {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  });
  context.restore();
}

function rectHandle(rect, point, radius) {
  if (!rect) return null;
  const corners = {
    nw: { x: rect.x, y: rect.y }, ne: { x: rect.x + rect.width, y: rect.y },
    sw: { x: rect.x, y: rect.y + rect.height }, se: { x: rect.x + rect.width, y: rect.y + rect.height },
  };
  return Object.entries(corners).find(([, corner]) => Math.hypot(point.x - corner.x, point.y - corner.y) <= radius)?.[0] || null;
}

function pointInRect(rect, point) {
  return Boolean(rect && point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height);
}

function moveRect(rect, dx, dy, bounds) {
  return { ...rect, x: Math.max(0, Math.min(bounds.width - rect.width, Math.round(rect.x + dx))), y: Math.max(0, Math.min(bounds.height - rect.height, Math.round(rect.y + dy))) };
}

function resizeRect(rect, handle, point, bounds) {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const next = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  if (handle.includes("w")) { next.x = Math.max(0, Math.min(point.x, right - 2)); next.width = right - next.x; }
  if (handle.includes("e")) next.width = Math.max(2, Math.min(bounds.width, point.x) - rect.x);
  if (handle.includes("n")) { next.y = Math.max(0, Math.min(point.y, bottom - 2)); next.height = bottom - next.y; }
  if (handle.includes("s")) next.height = Math.max(2, Math.min(bounds.height, point.y) - rect.y);
  return cleanRect(next);
}

export function OutputEditor({ client, item, onClose, onQueued, onError }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const [sourceUrl, setSourceUrl] = useState(null);
  const [resultUrl, setResultUrl] = useState(null);
  const [previewSource, setPreviewSource] = useState(false);
  const [meta, setMeta] = useState(null);
  const [region, setRegion] = useState(null);
  const [intervals, setIntervals] = useState([]);
  const [draft, setDraft] = useState(null);
  const [activeDetailId, setActiveDetailId] = useState(null);
  // Overlay boxes remain visible for review.  The canvas only captures input
  // after the user explicitly enters an edit mode, so video controls work
  // normally and accidental drags cannot change a saved region.
  const [editMode, setEditMode] = useState(null);
  const [newRegionKind, setNewRegionKind] = useState("logo");
  const [voiceName, setVoiceName] = useState("Trúc Ly");
  const [ttsSpeed, setTtsSpeed] = useState(1.00);
  const [dimensions, setDimensions] = useState(null);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [mounted, setMounted] = useState(false);
  const [cues, setCues] = useState([]);
  const [activeTab, setActiveTab] = useState("voice");
  const originalCues = useRef("[]");
  const cueEnd = useRef(null);
  const normalizedCues = cues.map(cue => ({ start: Number(cue.start), end: Number(cue.end), text: cue.text.trim() }));
  const transcriptChanged = JSON.stringify(normalizedCues) !== originalCues.current;
  const voiceChanged = item.mode === "voiceover" && (voiceName !== (meta?.voice || "Trúc Ly") || Number(ttsSpeed) !== Number(meta?.tts_speed || 1.00));
  const intervalKey = items => JSON.stringify(items.map(entry => ({ ...cleanRect(entry), start: Number(entry.start) || 0, end: Number(entry.end) || 0, kind: entry.kind === "logo" ? "logo" : "detail" })));
  const hasChanges = transcriptChanged || voiceChanged || Boolean(editMode) || JSON.stringify(cleanRect(meta?.blur_region)) !== JSON.stringify(region) || intervalKey(meta?.blur_intervals || []) !== intervalKey(intervals);

  useEffect(() => { setMounted(true); }, []);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !dimensions) return;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawRect(context, region, "#ff3850", "Phụ đề");
    if (editMode === "subtitle") drawHandles(context, region, "#ff3850");
    intervals.forEach((entry, index) => {
      const selected = entry.id === activeDetailId && editMode === "interval";
      drawRect(context, entry, selected ? "#ffd166" : "#ff3850", entry.kind === "logo" ? `Logo/chữ ${index + 1}` : `Chi tiết ${index + 1}`);
      if (selected) drawHandles(context, entry, "#ffd166");
    });
    drawRect(context, draft, "#ffd166", "Vùng mới");
  }, [activeDetailId, dimensions, draft, editMode, intervals, region]);

  useEffect(() => { paint(); }, [paint]);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null); setNotice(null); setMeta(null); setRegion(null); setIntervals([]); setDraft(null); setActiveDetailId(null); setEditMode(null); setNewRegionKind("logo"); setPreviewSource(false); setSourceUrl(null); setResultUrl(null);
    Promise.allSettled([
      client.json(`/api/outputs/${encodeURIComponent(item.video_id)}/edit?channel=${encodeURIComponent(item.channel || "2d_animation")}&mode=${encodeURIComponent(item.mode || "subtitle")}`),
      client.mediaUrl(`/api/stream/${encodeURIComponent(item.video_id)}?channel=${encodeURIComponent(item.channel || "2d_animation")}&mode=${encodeURIComponent(item.mode || "subtitle")}`),
      client.mediaUrl(`/api/preview/source/${encodeURIComponent(item.video_id)}?channel=${encodeURIComponent(item.channel || "2d_animation")}`),
    ]).then(([detailsResult, renderedResult, sourceResult]) => {
      if (!alive) return;
      if (detailsResult.status !== "fulfilled") throw detailsResult.reason;
      if (renderedResult.status !== "fulfilled") throw renderedResult.reason;
      const details = detailsResult.value;
      const renderedUrl = renderedResult.value;
      const rawSourceUrl = sourceResult.status === "fulfilled" ? sourceResult.value : null;
      setMeta(details);
      const translated = (details.subtitles || []).map(({ start, end, text }) => ({ start: Number(start), end: Number(end), text: String(text) }));
      setCues(translated); originalCues.current = JSON.stringify(translated);
      setRegion(cleanRect(details.blur_region));
      setIntervals((details.blur_intervals || []).map((entry) => ({ ...cleanRect(entry), start: Number(entry.start) || 0, end: Number(entry.end) || 0, id: crypto.randomUUID(), kind: entry.kind === "logo" ? "logo" : "detail" })).filter((entry) => entry.x !== undefined));
      setVoiceName(details.voice || "Trúc Ly");
      setTtsSpeed(Number(details.tts_speed) || 1.00);
      setResultUrl(renderedUrl);
      setSourceUrl(rawSourceUrl);
      if (!rawSourceUrl) setNotice("Không tìm thấy video gốc trên máy. Bạn vẫn có thể xem thành phẩm, nhưng cần tải lại video nguồn để chỉnh vùng mờ chính xác.");
    }).catch((requestError) => {
      if (alive) setError(requestError.message || "Không thể mở dữ liệu local để chỉnh sửa.");
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [client, item.channel, item.mode, item.video_id]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event) => { if (event.key === "Escape" && !submitting && !document.querySelector("dialog[open]")) onClose(); };
    window.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", keydown); };
  }, [onClose, submitting]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => syncCanvas());
    observer.observe(video);
    return () => observer.disconnect();
  });

  const syncCanvas = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.style.width = `${video.clientWidth}px`;
    canvas.style.height = `${video.clientHeight}px`;
    setDimensions({ width: video.videoWidth, height: video.videoHeight });
    setDuration(video.duration || 0);
  };
  const point = (event) => {
    const canvas = canvasRef.current;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * canvas.width / bounds.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * canvas.height / bounds.height)),
    };
  };
  const pointerDown = (event) => {
    if (!dimensions || !editMode) return;
    const start = point(event);
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    if (editMode === "subtitle" && region) {
      const handle = rectHandle(region, start, Math.max(24, Math.round(dimensions.width / 76)));
      if (handle) { dragRef.current = { type: "resize", handle, start, rect: region }; return; }
      if (pointInRect(region, start)) { dragRef.current = { type: "move", start, rect: region }; return; }
    }
    if (editMode === "interval") {
      const selected = [...intervals].reverse().find((entry) => pointInRect(entry, start));
      if (selected) {
        setActiveDetailId(selected.id);
        const handle = rectHandle(selected, start, Math.max(24, Math.round(dimensions.width / 76)));
        dragRef.current = { type: handle ? "detail-resize" : "detail-move", handle, start, rect: selected, id: selected.id };
        return;
      }
    }
    dragRef.current = { type: "create", start, kind: editMode === "interval" ? newRegionKind : null };
  };
  const pointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const end = point(event);
    let next;
    if (drag.type === "move") next = moveRect(drag.rect, end.x - drag.start.x, end.y - drag.start.y, dimensions);
    else if (drag.type === "resize") next = resizeRect(drag.rect, drag.handle, end, dimensions);
    else next = cleanRect({ x: Math.min(drag.start.x, end.x), y: Math.min(drag.start.y, end.y), width: Math.abs(end.x - drag.start.x), height: Math.abs(end.y - drag.start.y) });
    if (drag.type === "detail-move") { setIntervals((current) => current.map((entry) => entry.id === drag.id ? { ...entry, ...moveRect(drag.rect, end.x - drag.start.x, end.y - drag.start.y, dimensions) } : entry)); return; }
    if (drag.type === "detail-resize") { setIntervals((current) => current.map((entry) => entry.id === drag.id ? { ...entry, ...resizeRect(drag.rect, drag.handle, end, dimensions) } : entry)); return; }
    if (editMode === "subtitle") setRegion(next); else setDraft(next);
  };
  const addInterval = (kind = "detail", selectedRect = draft) => {
    if (!selectedRect) { setNotice("Kéo trực tiếp lên video để khoanh vùng cần làm mờ."); return; }
    const at = videoRef.current?.currentTime || 0;
    const entry = { ...selectedRect, id: crypto.randomUUID(), kind, start: kind === "logo" ? 0 : Math.round(at * 10) / 10, end: kind === "logo" ? Math.round((duration || 86400) * 10) / 10 : Math.round(Math.min(duration || at + 3, at + 3) * 10) / 10 };
    setIntervals((current) => [...current, entry]); setActiveDetailId(entry.id);
    setDraft(null); setNotice(kind === "logo" ? "Đã thêm vùng logo/chữ cho toàn video. Kéo lại khung đỏ hoặc xóa trực tiếp nếu cần." : "Đã thêm vùng chi tiết. Điều chỉnh khoảng thời gian bên dưới nếu cần.");
  };
  const pointerUp = (event) => {
    const drag = dragRef.current;
    if (drag?.type === "create") {
      const end = point(event);
      const next = cleanRect({ x: Math.min(drag.start.x, end.x), y: Math.min(drag.start.y, end.y), width: Math.abs(end.x - drag.start.x), height: Math.abs(end.y - drag.start.y) });
      if (next && next.width >= 8 && next.height >= 8) addInterval(drag.kind || "detail", next);
      else setDraft(null);
    }
    dragRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch (_) {}
  };
  const updateInterval = (id, key, value) => setIntervals((current) => current.map((entry) => entry.id === id ? { ...entry, [key]: key === "kind" ? value : Number(value) } : entry));
  const submit = async () => {
    if (!meta?.can_rerender) { setError("Không tìm được thông tin lần xuất trước. Hãy xử lý lại video từ Nguồn video."); return; }
    if (!meta?.source_ready) { setError("Không tìm thấy video nguồn local để xuất lại. Hãy tải lại video nguồn trước."); return; }
    const invalid = intervals.some((entry) => !cleanRect(entry) || !Number.isFinite(entry.start) || !Number.isFinite(entry.end) || entry.end <= entry.start);
    if (invalid) { setError("Mỗi vùng chi tiết cần có thời gian kết thúc lớn hơn thời gian bắt đầu."); return; }
    if (transcriptChanged && (!normalizedCues.length || normalizedCues.some(cue => !cue.text || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start))) { setError("Mỗi câu cần có nội dung và thời gian kết thúc lớn hơn thời gian bắt đầu."); return; }
    setSubmitting(true); setError(null); setNotice(null);
    try {
      const result = await client.json(`/api/outputs/${encodeURIComponent(item.video_id)}/rerender`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: item.channel || "2d_animation", mode: item.mode || "subtitle", blur_region: region, blur_intervals: intervals.map(({ id, ...entry }) => entry), ...(voiceChanged ? { voice: voiceName, tts_speed: ttsSpeed } : {}), ...(transcriptChanged ? { subtitles: normalizedCues } : {}) }),
      });
      onQueued?.(result, item);
      setNotice("Đã vào hàng đợi xuất lại. Video cũ vẫn được giữ cho tới khi file mới hoàn tất.");
    } catch (requestError) { setError(requestError.message || "Không thể tạo job xuất lại."); onError?.(requestError.message); }
    finally { setSubmitting(false); }
  };

  if (!mounted) return null;
  const previewUrl = previewSource ? sourceUrl : resultUrl;
  const activeInterval = intervals.find((entry) => entry.id === activeDetailId) || null;
  const beginEdit = (mode) => {
    if (!sourceUrl) { setError("Không tìm thấy video gốc trên máy. Hãy tải lại video nguồn trước khi chỉnh vùng mờ."); return; }
    const enabling = editMode !== mode;
    setEditMode(enabling ? mode : null);
    setDraft(null);
    if (enabling) {
      // The rendered output may be cropped for a target aspect ratio.  Region
      // coordinates must be picked on the original frame before rerendering.
      setPreviewSource(true);
      setNotice("Đang dùng video gốc để vùng đỏ khớp chính xác khi xuất lại.");
    }
  };
  const finishEdit = () => {
    setEditMode(null);
    setDraft(null);
    setPreviewSource(false);
    setNotice("Đang xem thành phẩm hiện tại. Vùng đỏ vẫn được giữ lại để bạn kiểm tra.");
  };
  const beginIntervalEdit = (kind) => {
    if (!sourceUrl) { setError("Không tìm thấy video gốc trên máy. Hãy tải lại video nguồn trước khi chỉnh logo hoặc chi tiết."); return; }
    setNewRegionKind(kind);
    setEditMode("interval");
    setDraft(null);
    setPreviewSource(true);
    setNotice(`Đang chỉnh ${kind === "logo" ? "logo / chữ" : "chi tiết"} trên video gốc. Kéo rồi thả chuột để lưu vùng mới.`);
  };
  const removeActiveInterval = () => {
    if (!activeInterval) return;
    setIntervals((current) => current.filter((entry) => entry.id !== activeInterval.id));
    setActiveDetailId(null);
    setNotice(`Đã xóa vùng ${activeInterval.kind === "logo" ? "logo / chữ" : "chi tiết"}.`);
  };

  const dialog = <div className="modal open output-editor-modal" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
    <section className="modal-box output-editor" role="dialog" aria-modal="true" aria-label="Chỉnh thành phẩm video">
      <div className="modal-head">
        <div>
          <strong className="modal-title">Chỉnh thành phẩm · {modeLabel(item.mode)}</strong>
          <p className="muted">{item.title || item.video_id}</p>
        </div>
        <button className="btn secondary" onClick={onClose} disabled={submitting} aria-label="Đóng">×</button>
      </div>
      {loading ? <Loading label="Đang mở thành phẩm và cấu hình trước đó" /> : error && !previewUrl ? <div className="library-body"><ErrorMessage error={error} onRetry={null} /><button className="btn secondary" onClick={() => window.location.reload()}>Tải lại trang</button></div> : <>
        {error && <div className="output-editor-alerts"><ErrorMessage error={error} /></div>}
        <div className="output-editor-studio">
          <div className="output-editor-left">
            <div className="output-editor-toolbar">
              <div className="output-editor-seg" role="group" aria-label="Chế độ xem trước">
                <button type="button" className={`btn ${!previewSource ? "is-active" : ""}`} onClick={() => { setPreviewSource(false); setEditMode(null); setDraft(null); }}>Thành phẩm</button>
                <button type="button" className={`btn ${previewSource ? "is-active" : ""}`} disabled={!sourceUrl} title={sourceUrl ? "" : "Video gốc không còn trên máy"} onClick={() => { setPreviewSource(true); }}>Video gốc</button>
              </div>
              <div className="output-editor-tools" role="group" aria-label="Công cụ chỉnh vùng mờ">
                <button type="button" className={`btn secondary ${editMode === "subtitle" ? "is-editing" : ""}`} disabled={!sourceUrl} onClick={() => beginEdit("subtitle")}><Icon name="edit" size={13} />Phụ đề</button>
                <button type="button" className={`btn secondary ${editMode === "interval" && newRegionKind === "logo" ? "is-editing" : ""}`} disabled={!sourceUrl} onClick={() => { beginIntervalEdit("logo"); setActiveTab("regions"); }}><Icon name="edit" size={13} />Logo</button>
                <button type="button" className={`btn secondary ${editMode === "interval" && newRegionKind === "detail" ? "is-editing" : ""}`} disabled={!sourceUrl} onClick={() => { beginIntervalEdit("detail"); setActiveTab("regions"); }}><Icon name="edit" size={13} />Chi tiết</button>
                {editMode && <button type="button" className="btn secondary" onClick={finishEdit}><Icon name="check" size={13} />Xong</button>}
                {editMode === "subtitle" && <button type="button" className="btn secondary" onClick={() => setRegion(null)}>Xóa</button>}
                {editMode === "interval" && activeInterval && <button type="button" className="btn secondary" onClick={removeActiveInterval}>Xóa</button>}
              </div>
            </div>
            <div className="output-editor-stage-wrap">
              <div className="output-editor-stage">{previewUrl && <><video key={previewSource ? "source" : "result"} ref={videoRef} src={previewUrl} controls playsInline crossOrigin="anonymous" onLoadedMetadata={syncCanvas} onCanPlay={syncCanvas} onResize={syncCanvas} onTimeUpdate={() => { if (cueEnd.current != null && videoRef.current.currentTime >= cueEnd.current) { videoRef.current.pause(); cueEnd.current = null; } }} onError={() => setError("Không thể mở video xem trước từ Local Engine. Hãy thử lại.")} /><canvas ref={canvasRef} className={`output-editor-canvas${editMode ? " editable" : ""}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} /></>}</div>
            </div>
            <div className="output-editor-stage-meta">
              <span className={`output-editor-hint${notice ? " has-notice" : ""}`}>{notice || (editMode === "subtitle" ? "Kéo khung đỏ để di chuyển; kéo góc để đổi cỡ." : editMode === "interval" ? `Kéo quanh ${newRegionKind === "logo" ? "logo / chữ" : "chi tiết"} rồi thả để lưu.` : previewSource ? "Đang xem video gốc." : sourceUrl ? "Các vùng đã lưu hiện màu đỏ." : "Không có video gốc trên máy.")}</span>
              <div className="output-editor-coords">
                <span>Phụ đề: {region ? `${region.x}, ${region.y} · ${region.width}×${region.height}` : "chưa chọn"}</span>
                {dimensions && <span>{dimensions.width}×{dimensions.height}px</span>}
              </div>
            </div>
          </div>

          <aside className="output-editor-right">
            <div className="output-editor-tabs" role="tablist" aria-label="Bảng tùy chỉnh">
              <button type="button" role="tab" aria-selected={activeTab === "voice"} className={`btn ${activeTab === "voice" ? "is-active" : ""}`} onClick={() => setActiveTab("voice")}><Icon name="captions" size={14} />{item.mode === "voiceover" ? "Thoại & Voice" : "Lời thoại"}</button>
              <button type="button" role="tab" aria-selected={activeTab === "regions"} className={`btn ${activeTab === "regions" ? "is-active" : ""}`} onClick={() => setActiveTab("regions")}><Icon name="edit" size={14} />Vùng mờ{intervals.length > 0 ? ` (${intervals.length})` : ""}</button>
              <button type="button" role="tab" aria-selected={activeTab === "publish"} className={`btn ${activeTab === "publish" ? "is-active" : ""}`} onClick={() => setActiveTab("publish")}><Icon name="upload" size={14} />Đăng YouTube</button>
            </div>

            <div className="output-editor-pane">
              {activeTab === "voice" && <>
                {item.mode === "voiceover" && <section className="output-editor-voice">
                  <label>Giọng đọc<select value={voiceName} onChange={(event) => setVoiceName(event.target.value)}><option value="Trúc Ly">Trúc Ly</option><option value="Hải Đăng">Hải Đăng</option></select></label>
                  <label><span>Tốc độ đọc <output>{Number(ttsSpeed).toFixed(2)}x</output></span><input type="range" min="0.5" max="1.6" step="0.05" value={ttsSpeed} onChange={(event) => setTtsSpeed(Number(event.target.value))} /></label>
                </section>}
                <OutputTranscriptEditor cues={cues} supported={Boolean(meta?.subtitle_edit_supported)} onChange={(index,key,value)=>setCues(current=>current.map((cue,i)=>i===index?{...cue,[key]:value}:cue))} onSeek={cue=>{ const video=videoRef.current; if(video) { video.currentTime=Number(cue.start); cueEnd.current=Number(cue.end); video.play().catch(()=>{}); } }} />
              </>}

              {activeTab === "regions" && <div className="output-editor-regions-pane">
                <div className="output-editor-detail">
                  <strong>Logo, chữ và chi tiết</strong>
                  <p>Chọn công cụ ở thanh trên video gốc, kéo trực tiếp quanh vùng cần che rồi thả chuột. Vùng logo áp dụng cho toàn bộ video.</p>
                </div>
                {intervals.length > 0 ? <div className="output-editor-intervals">{intervals.map((entry) => <div className={`output-editor-interval ${entry.id === activeDetailId ? "active" : ""}`} key={entry.id} onClick={() => setActiveDetailId(entry.id)}><select aria-label="Loại vùng" value={entry.kind || "detail"} onChange={(event) => updateInterval(entry.id, "kind", event.target.value)}><option value="detail">Chi tiết</option><option value="logo">Logo / chữ</option></select><label>Từ (s)<input type="number" min="0" step="0.1" value={entry.start} onChange={(event) => updateInterval(entry.id, "start", event.target.value)} /></label><label>Đến (s)<input type="number" min="0" step="0.1" value={entry.end} onChange={(event) => updateInterval(entry.id, "end", event.target.value)} /></label><button className="btn secondary" onClick={(event) => { event.stopPropagation(); setIntervals((current) => current.filter((item) => item.id !== entry.id)); setActiveDetailId(null); }}>Xóa</button></div>)}</div> : <p className="output-editor-empty-regions">Chưa có vùng logo hay chi tiết nào. Bấm <strong>Logo / chữ</strong> hoặc <strong>Chi tiết</strong> ở góc trên bên trái để khoanh trực tiếp trên video.</p>}
              </div>}

              {activeTab === "publish" && <OutputYoutubeActions item={item} hasChanges={hasChanges} />}
            </div>
          </aside>
        </div>

        <div className="output-editor-actions">
          <span className="output-editor-dirty">{hasChanges ? "Có thay đổi chưa xuất lại" : "Chưa có thay đổi"}</span>
          <div className="output-editor-actions-btns">
            <button className="btn secondary" onClick={onClose} disabled={submitting}>Hủy</button>
            <button className="btn primary" disabled={submitting || !meta?.source_ready} title={meta?.source_ready ? "" : "Cần video nguồn local để xuất lại"} onClick={submit}><Icon name="spark" size={15} />{submitting ? "Đang tạo job…" : "Xuất lại video"}</button>
          </div>
        </div>
      </>}
    </section>
  </div>;

  return createPortal(dialog, document.body);
}
