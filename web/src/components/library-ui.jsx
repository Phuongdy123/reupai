"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon";
import { sendFeedback } from "./feedback-provider";

export const JOB_LABELS = { queued: "Đang chờ", processing: "Đang xử lý", running: "Đang xử lý", stopping: "Đang dừng", completed: "Hoàn tất", failed: "Thất bại", interrupted: "Bị gián đoạn", cancelled: "Đã dừng", stopped: "Đã dừng" };
export const ACTIVE_JOBS = new Set(["queued", "processing", "running", "stopping"]);
export const numberText = (value) => Number(value || 0).toLocaleString("vi-VN");
export const progressValue = (value) => Math.round(Math.max(0, Math.min(100, Number(value) || 0)));
export const jobVideoId = (job) => job.platform_video_id || job.video_id || "";
export const modeLabel = (mode) => mode === "voiceover" ? "Vietsub + Voice" : "Vietsub";
export function dateText(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("vi-VN");
}
export function stageLabel(stage) {
  return ({ queued: "Hàng đợi", starting: "Khởi động", download: "Tải video", downloading: "Tải video", audio: "Tách audio", extract_audio: "Tách audio", transcribe: "Whisper", transcription: "Whisper", whisper: "Whisper", translate: "Dịch phụ đề", translation: "Dịch phụ đề", tts: "Voice TTS", voice: "Voice TTS", detect_subtitle: "Nhận diện subtitle", subtitle_detect: "Nhận diện subtitle", render: "Render video", rendering: "Render video", completed: "Hoàn tất", failed: "Lỗi" })[stage] || stage || "—";
}
export function videoBody(video) {
  const body = {};
  for (const key of ["video_id", "platform", "url", "title", "cover_url", "source_id", "source_name", "channel_key", "published_at", "play_count", "like_count", "comment_count", "share_count"]) {
    if (video[key] !== undefined && video[key] !== null) body[key] = video[key];
  }
  body.video_id = video.video_id || video.platform_video_id;
  body.url = video.url || video.source_url || "";
  return body;
}
export function outputPath(item) {
  return item.file_path || `channels/${item.channel || item.channel_key || "2d_animation"}/jobs/${item.video_id || item.platform_video_id}/${item.mode === "voiceover" ? "final_voice.mp4" : "final_sub.mp4"}`;
}
export function sourcePath(item) {
  if (item?.file_path) return item.file_path;
  const path = String(item?.path || "").replaceAll("\\", "/");
  const match = path.match(/(?:^|\/)(downloads\/.+)$/i);
  return match ? match[1] : null;
}
export function sourceHref(video, mode = "subtitle") {
  const query = new URLSearchParams({ video: video.video_id || video.platform_video_id, mode });
  return `/sources?${query}`;
}
export function withLocalFiles(video, downloads, outputs) {
  const id = video.video_id || video.platform_video_id;
  const source = downloads.find((item) => item.video_id === id);
  const subtitle = outputs.find((item) => item.video_id === id && item.mode === "subtitle");
  const voice = outputs.find((item) => item.video_id === id && item.mode === "voiceover");
  return { ...video, downloaded: Boolean(source) || Boolean(video.downloaded), has_subtitle_result: Boolean(subtitle), has_voice_result: Boolean(voice), subtitle_output: subtitle, voice_output: voice };
}
export function EngineGate({ status, connect, check, title }) {
  const needsAuth = ["authorization_required", "permission_denied"].includes(status);
  const waiting = ["checking", "reconnecting", "authorizing"].includes(status);
  return <section className="panel"><div className="empty-state">
    {waiting && <span className="spinner" />}
    <h2>{needsAuth ? "Cần cấp quyền Local Engine" : waiting ? "Đang kết nối Local Engine" : "Local Engine offline"}</h2>
    <p>{needsAuth ? `Kết nối ReupAI để mở ${title || "dữ liệu trên máy"}.` : waiting ? "Đang kiểm tra kết nối và quyền truy cập trên máy này." : "Khởi động ReupAI Local Engine rồi kiểm tra lại."}</p>
    <button className="btn primary" disabled={waiting} onClick={needsAuth ? connect : check}>{needsAuth ? "Kết nối ReupAI" : "Kiểm tra lại"}</button>
  </div></section>;
}
export function ErrorMessage({ error, retry }) {
  useEffect(() => { if (error) sendFeedback("error", error); }, [error]);
  return error ? <div className="error-banner" role="alert"><span><Icon name="alert" size={17} /> {error}</span>{retry && <button onClick={retry}>Thử lại</button>}</div> : null;
}
export function Notice({ children }) { return children ? <div className="notice-banner" role="status"><Icon name="check" size={17} />{children}</div> : null; }
export function Loading({ label = "Đang tải dữ liệu local" }) {
  useEffect(() => { const id = `loading-${crypto.randomUUID()}`; sendFeedback("waiting", label, id); return () => sendFeedback("done", "", id); }, [label]);
  return <div className="empty-state compact" role="status"><span className="spinner" /> Vui lòng chờ · {label}</div>;
}
export function Pager({ page, total, pageSize, onChange }) {
  const pages = Math.ceil(total / pageSize);
  if (pages < 2) return null;
  const numbers = new Set([1, pages, page - 1, page, page + 1]);
  const visible = [...numbers].filter((n) => n > 0 && n <= pages).sort((a, b) => a - b);
  return <nav className="bottom-pages" aria-label="Phân trang"><button className="bottom-page-btn" disabled={page === 1} onClick={() => onChange(page - 1)}>Trước</button>{visible.map((n, i) => <span key={n}>{i > 0 && n - visible[i - 1] > 1 && <span className="bottom-page-dots">…</span>}<button className={`bottom-page-btn ${page === n ? "active" : ""}`} aria-current={page === n ? "page" : undefined} onClick={() => onChange(n)}>{n}</button></span>)}<button className="bottom-page-btn" disabled={page === pages} onClick={() => onChange(page + 1)}>Sau</button></nav>;
}
export function VideoCover({ client, video, children, previewPath }) {
  const coverRef = useRef(null);
  const [url, setUrl] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const node = coverRef.current;
    if (!node || typeof IntersectionObserver === "undefined") { setShouldLoad(true); return undefined; }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setShouldLoad(true);
      observer.disconnect();
    }, { rootMargin: "320px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldLoad) return undefined;
    const controller = new AbortController();
    let alive = true;
    let blobUrl;
    setUrl(null); setPreviewUrl(null);
    const loadCover = async () => {
      if (video.cover_url) {
        try {
          const response = await client.request(`/api/cover?url=${encodeURIComponent(video.cover_url)}`, { signal: controller.signal });
          if (response.ok) {
            const blob = await response.blob();
            if (blob.type.startsWith("image/")) {
              blobUrl = URL.createObjectURL(blob);
              if (alive) setUrl(blobUrl); else URL.revokeObjectURL(blobUrl);
              return;
            }
          }
        } catch (_) { /* A local video frame is used when the remote cover is unavailable. */ }
      }
      if (previewPath && alive) {
        try { const value = await client.mediaUrl(previewPath); if (alive) setPreviewUrl(value); }
        catch (_) { /* A missing local file leaves a neutral video icon. */ }
      }
    };
    loadCover();
    return () => { alive = false; controller.abort(); if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [client, shouldLoad, video.cover_url, previewPath]);
  return <div className="library-cover" ref={coverRef}>{url ? <img src={url} alt={video.title || video.video_id} loading="lazy" /> : previewUrl ? <video className="library-preview" crossOrigin="anonymous" src={previewUrl} muted playsInline preload="metadata" aria-label={`Xem trước ${video.title || video.video_id}`} onLoadedMetadata={(event) => { event.currentTarget.currentTime = Math.min(.1, event.currentTarget.duration || 0); }} /> : <div className="no-cover"><Icon name="play" size={30} /></div>}{children}</div>;
}
export function PreviewDialog({ client, item, onClose, onError }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const [downloadNotice, setDownloadNotice] = useState(null);
  useEffect(() => {
    let alive = true;
    setUrl(null); setError(null); setDownloadError(null); setDownloadNotice(null);
    client.mediaUrl(item.file_path).then((value) => { if (alive) setUrl(value); }).catch((requestError) => { if (alive) setError(requestError.message || "Không thể mở video local."); });
    return () => { alive = false; };
  }, [client, item.file_path]);
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [onClose]);
  const download = async () => {
    if (downloading) return;
    if (!item.file_path) { setDownloadError("Không tìm thấy đường dẫn file local. Làm mới thư viện rồi thử lại."); return; }
    setDownloading(true); setDownloadError(null); setDownloadNotice(null);
    try {
      await client.downloadFile(item.file_path, item.filename || `${item.video_id || "video"}-${item.mode || "source"}.${item.file_path.split(".").pop() || "mp4"}`);
      setDownloadNotice("Đã chuyển file tới trình duyệt. Kiểm tra danh sách tải xuống.");
    } catch (requestError) {
      const message = requestError.message || "Không thể tải file local. Hãy thử lại.";
      onError?.(message); setDownloadError(message);
    } finally { setDownloading(false); }
  };
  return <div className="modal open" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-box" role="dialog" aria-modal="true" aria-label={`Xem video ${item.title || item.video_id}`}><div className="modal-head"><strong className="modal-title">{item.mode_label || modeLabel(item.mode)} · {item.title || item.video_id}</strong><button className="btn secondary" onClick={onClose} aria-label="Đóng video">×</button></div>{error ? <ErrorMessage error={error} /> : url ? <video crossOrigin="anonymous" src={url} controls playsInline autoPlay /> : <Loading label="Đang mở video trên máy" />}<div className="library-body"><div className="library-meta"><span>{item.video_id}</span>{item.size_text && <span>{item.size_text}</span>}{item.updated_at && <span>{dateText(item.updated_at)}</span>}</div><ErrorMessage error={downloadError} retry={downloading ? null : download} /><Notice>{downloadNotice}</Notice><button className="btn primary" disabled={downloading || !item.file_path} aria-busy={downloading} onClick={download}><Icon name="download" size={16} />{downloading ? "Đang đọc file local…" : "Tải file"}</button>{downloading && <p className="muted" role="status">Đang nhận file từ Local Engine; tiến trình phụ thuộc kích thước video.</p>}</div></section></div>;
}
export function LibraryVideoCard({ client, video, selected, onSelect, onFavorite, onDownload, onPreview, onRemove, busy, collectionAction, sourceFile }) {
  const id = video.video_id || video.platform_video_id;
  const resultItem = (mode) => {
    const output = mode === "voiceover" ? video.voice_output : video.subtitle_output;
    const item = output ? { ...video, ...output } : { ...video, channel: video.channel_key, mode };
    return { ...item, file_path: outputPath(item) };
  };
  return <article className="library-card">
    <VideoCover client={client} video={video} previewPath={sourceFile ? sourcePath(sourceFile) : undefined}>{onSelect && <label className="select-control" style={{ position: "absolute", top: 10, left: 10 }}><input type="checkbox" checked={Boolean(selected)} onChange={() => onSelect(id)} aria-label={`Chọn ${video.title || id}`} /><span className="select-visual" /></label>}{video.episode_number != null && <span className="mode-badge">Tập {video.episode_number}</span>}</VideoCover>
    <div className="library-body"><div className="card-header-row"><h3>{video.title || id}</h3>{onFavorite && <button className={`favorite-btn modern-icon-btn ${video.favorite ? "is-favorite" : ""}`} onClick={() => onFavorite(video)} disabled={busy} aria-label={video.favorite ? "Bỏ yêu thích" : "Yêu thích"}><Icon name="heart" size={19} /></button>}</div>
      <div className="library-meta"><span>{id}</span><span>{numberText(video.play_count)} lượt xem</span>{video.source_name && <span>{video.source_name}</span>}{video.published_at && <span>{dateText(video.published_at)}</span>}</div>
      <div className="badges compact-badges"><span className={`status ${video.downloaded ? "completed" : ""}`}>{video.downloaded ? "Đã tải" : "Chưa tải"}</span>{video.processing && <span className="status processing">Đang xử lý</span>}{video.has_subtitle_result && <button className="result-chip" onClick={() => onPreview(resultItem("subtitle"))}>SUB</button>}{video.has_voice_result && <button className="result-chip" onClick={() => onPreview(resultItem("voiceover"))}>VOICE</button>}</div>
      <div className="library-actions"><Link className="btn primary" href={sourceHref(video)}>Vietsub</Link><Link className="btn secondary" href={sourceHref(video, "voiceover")}>Voice</Link>{sourceFile && <button className="btn secondary" onClick={() => onPreview({ ...video, ...sourceFile, mode_label: "Video gốc", file_path: sourcePath(sourceFile) })}><Icon name="play" size={15} />Xem</button>}{onDownload && <button className="btn secondary" disabled={busy || (!video.url && !sourceFile)} onClick={() => onDownload(video, sourceFile)}><Icon name="download" size={15} />{busy ? "Đang tải…" : "Tải"}</button>}{video.url && <a className="btn secondary" href={video.url} target="_blank" rel="noopener noreferrer" aria-label="Mở video gốc"><Icon name="external" size={15} /></a>}{onRemove && <button className="btn danger" onClick={() => onRemove(video)} disabled={busy}>Bỏ khỏi Collection</button>}</div>{collectionAction}
    </div>
  </article>;
}
export function HistoryTable({ items, onStop, stopping }) {
  return <div className="table-wrap"><table><thead><tr><th>ID</th><th>Video</th><th>Kênh</th><th>Chế độ</th><th>Bước xử lý</th><th>Tiến độ</th><th>Trạng thái</th><th>Lỗi</th><th>Cập nhật</th><th /></tr></thead><tbody>{items.map((job) => <tr key={job.id || job.job_key || `${jobVideoId(job)}-${job.mode}`}><td>#{job.id || "—"}</td><td className="mono">{jobVideoId(job)}</td><td>{job.channel_key || "—"}</td><td>{modeLabel(job.mode)}</td><td>{stageLabel(job.stage)}</td><td>{progressValue(job.progress)}%</td><td><span className={`status ${job.status}`}>{JOB_LABELS[job.status] || job.status}</span></td><td className="error-cell" title={job.error_message || ""}>{job.error_message || "—"}</td><td>{dateText(job.updated_at || job.completed_at || job.created_at)}</td><td>{ACTIVE_JOBS.has(job.status) && onStop && <button className="btn danger" disabled={stopping === jobVideoId(job)} onClick={() => onStop(job)}>Dừng</button>}</td></tr>)}</tbody></table></div>;
}
