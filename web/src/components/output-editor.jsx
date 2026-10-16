"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icon";
import { ErrorMessage, Loading, Notice, modeLabel } from "./library-ui";

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

export function OutputEditor({ client, item, onClose, onQueued, onError }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const [sourceUrl, setSourceUrl] = useState(null);
  const [meta, setMeta] = useState(null);
  const [region, setRegion] = useState(null);
  const [intervals, setIntervals] = useState([]);
  const [draft, setDraft] = useState(null);
  const [tool, setTool] = useState("subtitle");
  const [dimensions, setDimensions] = useState(null);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !dimensions) return;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawRect(context, region, "#ff3850", "Vùng phụ đề");
    intervals.forEach((entry, index) => drawRect(context, entry, "#21d3a2", `Chi tiết ${index + 1}`));
    drawRect(context, draft, "#ffd166", "Vùng mới");
  }, [dimensions, draft, intervals, region]);

  useEffect(() => { paint(); }, [paint]);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null); setNotice(null); setMeta(null); setRegion(null); setIntervals([]); setDraft(null);
    Promise.all([
      client.json(`/api/outputs/${encodeURIComponent(item.video_id)}/edit?channel=${encodeURIComponent(item.channel || "2d_animation")}&mode=${encodeURIComponent(item.mode || "subtitle")}`),
      client.mediaUrl(`/api/preview/source/${encodeURIComponent(item.video_id)}?channel=${encodeURIComponent(item.channel || "2d_animation")}`),
    ]).then(([details, url]) => {
      if (!alive) return;
      setMeta(details);
      setRegion(cleanRect(details.blur_region));
      setIntervals((details.blur_intervals || []).map((entry) => ({ ...cleanRect(entry), start: Number(entry.start) || 0, end: Number(entry.end) || 0, id: crypto.randomUUID() })).filter((entry) => entry.x !== undefined));
      setSourceUrl(url);
    }).catch((requestError) => {
      if (alive) setError(requestError.message || "Không thể mở dữ liệu local để chỉnh sửa.");
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [client, item.channel, item.mode, item.video_id]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event) => { if (event.key === "Escape" && !submitting) onClose(); };
    window.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", keydown); };
  }, [onClose, submitting]);

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
  const pointerDown = (event) => { if (!dimensions) return; event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = point(event); };
  const pointerMove = (event) => {
    const start = dragRef.current;
    if (!start) return;
    const end = point(event);
    const next = cleanRect({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) });
    if (tool === "subtitle") setRegion(next); else setDraft(next);
  };
  const pointerUp = (event) => { dragRef.current = null; try { event.currentTarget.releasePointerCapture(event.pointerId); } catch (_) {} };
  const addInterval = () => {
    if (!draft) { setNotice("Chọn “Vùng chi tiết”, rồi kéo chuột trên video để khoanh vùng cần làm mờ."); return; }
    const at = videoRef.current?.currentTime || 0;
    setIntervals((current) => [...current, { ...draft, id: crypto.randomUUID(), start: Math.round(at * 10) / 10, end: Math.round(Math.min(duration || at + 3, at + 3) * 10) / 10 }]);
    setDraft(null); setNotice("Đã thêm vùng chi tiết. Điều chỉnh mốc thời gian bên dưới nếu cần.");
  };
  const updateInterval = (id, key, value) => setIntervals((current) => current.map((entry) => entry.id === id ? { ...entry, [key]: Number(value) } : entry));
  const submit = async () => {
    if (!region) { setError("Hãy kéo vùng phụ đề gốc trên video trước khi xuất lại."); return; }
    if (!meta?.can_rerender) { setError("Không tìm được thông tin lần xuất trước. Hãy xử lý lại video từ Nguồn video."); return; }
    const invalid = intervals.some((entry) => !cleanRect(entry) || !Number.isFinite(entry.start) || !Number.isFinite(entry.end) || entry.end <= entry.start);
    if (invalid) { setError("Mỗi vùng chi tiết cần có thời gian kết thúc lớn hơn thời gian bắt đầu."); return; }
    setSubmitting(true); setError(null); setNotice(null);
    try {
      const result = await client.json(`/api/outputs/${encodeURIComponent(item.video_id)}/rerender`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: item.channel || "2d_animation", mode: item.mode || "subtitle", blur_region: region, blur_intervals: intervals.map(({ id, ...entry }) => entry) }),
      });
      onQueued?.(result, item);
      setNotice("Đã vào hàng đợi xuất lại. Video cũ vẫn được giữ cho tới khi file mới hoàn tất.");
    } catch (requestError) { setError(requestError.message || "Không thể tạo job xuất lại."); onError?.(requestError.message); }
    finally { setSubmitting(false); }
  };

  if (!mounted) return null;

  const dialog = <div className="modal open output-editor-modal" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
    <section className="modal-box output-editor" role="dialog" aria-modal="true" aria-label="Chỉnh vùng mờ video">
      <div className="modal-head"><div><strong className="modal-title">Chỉnh vùng mờ · {modeLabel(item.mode)}</strong><p className="muted">{item.title || item.video_id} · chỉ xuất lại video, không tải hay chạy AI lại.</p></div><button className="btn secondary" onClick={onClose} disabled={submitting} aria-label="Đóng">×</button></div>
      {loading ? <Loading label="Đang mở video nguồn và cấu hình trước đó" /> : error && !sourceUrl ? <div className="library-body"><ErrorMessage error={error} onRetry={null} /><button className="btn secondary" onClick={() => window.location.reload()}>Tải lại trang</button></div> : <div className="output-editor-body">
        <ErrorMessage error={error} /><Notice>{notice}</Notice>
        <div className="output-editor-help"><button className={`btn ${tool === "subtitle" ? "primary" : "secondary"}`} onClick={() => setTool("subtitle")}>1. Kéo vùng phụ đề</button><button className={`btn ${tool === "detail" ? "primary" : "secondary"}`} onClick={() => setTool("detail")}>2. Vùng chi tiết</button><span>{tool === "subtitle" ? "Kéo trực tiếp để đặt lại vùng che phụ đề gốc." : "Kéo để khoanh chi tiết cần làm mờ, sau đó thêm khoảng thời gian."}</span></div>
        <div className="output-editor-stage">{sourceUrl && <video ref={videoRef} src={sourceUrl} controls playsInline crossOrigin="anonymous" onLoadedMetadata={syncCanvas} onResize={syncCanvas} onError={() => setError("Không thể mở video nguồn local. Hãy kiểm tra Local Engine rồi thử lại.")} />}{dimensions && <canvas ref={canvasRef} className="output-editor-canvas" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} />}</div>
        <div className="output-editor-summary"><span>Vùng phụ đề: {region ? `${region.x}, ${region.y} · ${region.width} × ${region.height}px` : "chưa chọn"}</span>{dimensions && <span>Video gốc: {dimensions.width} × {dimensions.height}px</span>}</div>
        <div className="output-editor-detail"><div><strong>Vùng mờ chi tiết</strong><p>Ví dụ che logo, chữ hoặc thông tin chỉ xuất hiện trong một đoạn.</p></div><button className="btn secondary" onClick={addInterval} disabled={!draft}><Icon name="plus" size={16} />Thêm vùng đang chọn</button></div>
        {draft && <div className="notice-banner">Vùng mới đã chọn. Bấm “Thêm vùng đang chọn” để đặt khoảng thời gian.</div>}
        {intervals.length > 0 && <div className="output-editor-intervals">{intervals.map((entry, index) => <div className="output-editor-interval" key={entry.id}><span>Chi tiết {index + 1}</span><label>Từ giây<input type="number" min="0" step="0.1" value={entry.start} onChange={(event) => updateInterval(entry.id, "start", event.target.value)} /></label><label>Đến giây<input type="number" min="0" step="0.1" value={entry.end} onChange={(event) => updateInterval(entry.id, "end", event.target.value)} /></label><button className="btn secondary" onClick={() => setIntervals((current) => current.filter((item) => item.id !== entry.id))}>Xóa</button></div>)}</div>}
        <div className="output-editor-actions"><button className="btn secondary" onClick={onClose} disabled={submitting}>Hủy</button><button className="btn primary" disabled={submitting || !region} onClick={submit}><Icon name="spark" size={16} />{submitting ? "Đang tạo job…" : "Xuất lại video"}</button></div>
      </div>}
    </section>
  </div>;

  return createPortal(dialog, document.body);
}
