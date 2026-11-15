"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useEngine } from "./engine-provider";
import { useYoutube } from "./youtube-provider";
import { Icon } from "./icon";
import { ACTIVE_JOBS, JOB_LABELS, Loading, ErrorMessage, Notice, VideoCover, formatDate } from "./library-ui";
import { PreviewDialog } from "./preview-dialog";
import { OutputEditor } from "./output-editor";
import { YoutubePublishDialog } from "./youtube-publish-dialog";

function parseDurationSeconds(video) {
  if (Number.isFinite(Number(video?.duration_sec)) && Number(video.duration_sec) > 0) return Number(video.duration_sec);
  if (Number.isFinite(Number(video?.duration)) && Number(video.duration) > 0) return Number(video.duration);
  const text = String(video?.duration_text || video?.length || "").trim();
  if (!text) return 0;
  const parts = text.split(":").map((part) => Number(part));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function formatDuration(sec) {
  if (!sec || sec <= 0) return "—";
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function detectOrientation(video) {
  const w = Number(video?.width || video?.video_width || 0);
  const h = Number(video?.height || video?.video_height || 0);
  if (w > 0 && h > 0) {
    if (h > w * 1.05) return "vertical";
    if (w > h * 1.05) return "horizontal";
    return "square";
  }
  const platform = String(video?.platform || "").toLowerCase();
  if (platform === "douyin") return "vertical";
  if (platform === "bilibili") return "horizontal";
  return "unknown";
}

function scoreVideoForStudio(video, studioMode) {
  const sec = parseDurationSeconds(video);
  const orient = detectOrientation(video);
  const views = Number(video?.play_count || video?.views || 0);
  let score = 0;
  const reasons = [];

  if (studioMode === "youtube") {
    if (orient === "horizontal") { score += 45; reasons.push("Khung ngang 16:9"); }
    else if (orient === "square") { score += 15; }
    else if (orient === "vertical") { score -= 25; }

    if (sec >= 180) { score += 40; reasons.push("Video dài 3p+"); }
    else if (sec >= 90) { score += 30; reasons.push("Đủ dài ≥ 90s"); }
    else if (sec >= 60) { score += 15; reasons.push("Từ 1 phút"); }
    else if (sec > 0) { score -= 20; }

    if (video?.series_key || video?.series_name) { score += 15; reasons.push("Có Series"); }
  } else {
    if (orient === "vertical") { score += 45; reasons.push("Khung dọc 9:16"); }
    else if (orient === "square") { score += 20; reasons.push("Dễ cắt dọc"); }
    else { score += 5; reasons.push("Chuyển 9:16"); }

    if (sec > 0 && sec <= 60) { score += 45; reasons.push("Chuẩn ≤ 60s"); }
    else if (sec > 60 && sec <= 90) { score += 30; reasons.push("Ngắn ≤ 90s"); }
    else if (sec > 90 && sec <= 180) { score += 12; reasons.push("Cắt đoạn ngắn"); }
    else if (sec > 180) { score -= 15; }
  }

  if (views >= 100000) score += 12;
  else if (views >= 10000) score += 6;

  return { score, sec, orient, views, reasons };
}

function formatViews(views) {
  const num = Number(views || 0);
  if (!num) return "—";
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}N`;
  return String(num);
}

export function StudioPage({ mode = "youtube" }) {
  const isYoutube = mode === "youtube";
  const { client, status: engineStatus } = useEngine();
  const youtube = useYoutube();

  const [sources, setSources] = useState([]);
  const [selectedSourceId, setSelectedSourceId] = useState("all");
  const [sourceUrl, setSourceUrl] = useState("");
  const [videos, setVideos] = useState([]);
  const [jobsByVideo, setJobsByVideo] = useState({});
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Filters
  const [fitFilter, setFitFilter] = useState(isYoutube ? "youtube_fit" : "shorts_fit");
  const [orientFilter, setOrientFilter] = useState("all");
  const [sortBy, setSortBy] = useState("score");
  const [query, setQuery] = useState("");

  // Streamlined Studio Preset
  const [processMode, setProcessMode] = useState("voiceover");
  const [voiceName, setVoiceName] = useState("Trúc Ly");
  const [ttsSpeed, setTtsSpeed] = useState(isYoutube ? 1.0 : 1.05);
  const [boostGpu, setBoostGpu] = useState(false);
  const [submittingIds, setSubmittingIds] = useState({});

  useEffect(() => {
    try { setBoostGpu(localStorage.getItem("reupai:boost-gpu") === "1"); } catch {}
  }, []);

  // Modals
  const [preview, setPreview] = useState(null);
  const [editor, setEditor] = useState(null);
  const [publishing, setPublishing] = useState(null);
  const pollRef = useRef(null);

  const loadJobs = useCallback(async () => {
    try {
      const data = await client.json("/api/jobs?channel=default");
      const map = {};
      for (const job of data?.jobs || data?.items || []) {
        if (job?.video_id) map[job.video_id] = job;
      }
      setJobsByVideo(map);
    } catch {
      // Ignore transient polling failures.
    }
  }, [client]);

  const loadInitial = useCallback(async () => {
    if (engineStatus !== "connected") return;
    setLoading(true);
    setError(null);
    try {
      const [sourcesRes, videosRes] = await Promise.all([
        client.json("/api/library/sources"),
        client.json("/api/library/videos?limit=500"),
      ]);
      setSources(sourcesRes?.sources || sourcesRes?.items || []);
      setVideos(videosRes?.videos || videosRes?.items || []);
      await loadJobs();
    } catch (err) {
      setError(err.message || "Không thể tải dữ liệu nguồn từ Local Engine.");
    } finally {
      setLoading(false);
    }
  }, [client, engineStatus, loadJobs]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (engineStatus !== "connected") return undefined;
    const hasActive = Object.values(jobsByVideo).some((job) => ACTIVE_JOBS.has(job?.state || job?.status));
    pollRef.current = window.setInterval(loadJobs, hasActive ? 2500 : 10000);
    return () => window.clearInterval(pollRef.current);
  }, [engineStatus, jobsByVideo, loadJobs]);

  const handleSelectSource = async (value) => {
    setSelectedSourceId(value);
    setError(null);
    setNotice(null);
    if (value === "all") {
      setLoading(true);
      try {
        const res = await client.json("/api/library/videos?limit=500");
        setVideos(res?.videos || res?.items || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
      return;
    }
    const found = sources.find((s) => String(s.id) === String(value));
    if (!found) return;
    setSourceUrl(found.profile_url || "");
    setScanning(true);
    try {
      const res = await client.json(`/api/videos?url=${encodeURIComponent(found.profile_url)}&page=1&limit=60`);
      setVideos(res?.videos || res?.items || []);
    } catch (err) {
      setError(err.message || "Không thể đọc video từ nguồn đã chọn.");
    } finally {
      setScanning(false);
    }
  };

  const handleScanUrl = async (event) => {
    event?.preventDefault();
    const url = sourceUrl.trim();
    if (!url) { setError("Hãy dán link kênh Bilibili hoặc Douyin để quét lọc."); return; }
    setScanning(true);
    setError(null);
    setNotice(null);
    try {
      const res = await client.json(`/api/videos?url=${encodeURIComponent(url)}&refresh=true&page=1&limit=60`);
      const list = res?.videos || res?.items || [];
      setVideos(list);
      setNotice(`Đã quét ${list.length} video từ nguồn và tự động chấm điểm phù hợp cho ${isYoutube ? "YouTube Ngang" : "Shorts 9:16"}.`);
    } catch (err) {
      setError(err.message || "Không thể quét nguồn này.");
    } finally {
      setScanning(false);
    }
  };

  const candidates = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const enriched = videos
      .map((video) => ({ video, meta: scoreVideoForStudio(video, mode) }))
      .filter(({ video, meta }) => {
        if (q && !`${video.title || ""} ${video.video_id || ""}`.toLocaleLowerCase().includes(q)) return false;
        if (orientFilter !== "all" && meta.orient !== orientFilter) return false;
        if (isYoutube) {
          if (fitFilter === "youtube_fit") return meta.sec === 0 || meta.sec >= 60;
          if (fitFilter === "long_3m") return meta.sec >= 180;
          if (fitFilter === "series") return Boolean(video.series_key || video.series_name);
        } else {
          if (fitFilter === "shorts_fit") return meta.sec === 0 || meta.sec <= 95;
          if (fitFilter === "quick_60") return meta.sec > 0 && meta.sec <= 60;
          if (fitFilter === "vertical_only") return meta.orient === "vertical";
        }
        return true;
      });

    enriched.sort((a, b) => {
      if (sortBy === "views") return b.meta.views - a.meta.views;
      if (sortBy === "duration") return isYoutube ? b.meta.sec - a.meta.sec : (a.meta.sec || 9999) - (b.meta.sec || 9999);
      if (sortBy === "score") return b.meta.score - a.meta.score || b.meta.views - a.meta.views;
      return 0;
    });
    return enriched;
  }, [fitFilter, isYoutube, mode, orientFilter, query, sortBy, videos]);

  const startStudioProcess = async (video) => {
    const id = video.video_id || video.platform_video_id;
    if (!id) return;
    setSubmittingIds((prev) => ({ ...prev, [id]: true }));
    setError(null);
    setNotice(null);
    try {
      const payload = {
        video_id: id,
        url: video.url || video.video_url || `https://www.bilibili.com/video/${id}`,
        title: video.title || id,
        platform: video.platform || "bilibili",
        channel: "default",
        mode: processMode,
        aspect_ratio: isYoutube ? "16:9" : "9:16",
        subtitle_style: isYoutube ? "minimal" : "bold",
        voice: voiceName,
        tts_speed: Number(ttsSpeed) || 1.0,
        source_language: "auto",
        translation_model: "gemini-3.1-flash-lite",
        output_format: "video",
        boost_gpu: boostGpu,
        ocr_use_gpu: boostGpu,
        ocr_parallelism: boostGpu ? 4 : 2,
      };
      await client.json("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setNotice(`Đã đưa "${video.title || id}" vào hàng đợi ${isYoutube ? "YouTube 16:9" : "Shorts 9:16"}.`);
      await loadJobs();
    } catch (err) {
      setError(err.message || "Không thể bắt đầu xử lý video.");
    } finally {
      setSubmittingIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  if (engineStatus !== "connected") {
    return (
      <section className="panel studio-disconnected">
        <div className="studio-empty-box">
          <Icon name={isYoutube ? "play" : "spark"} size={28} />
          <h2>{isYoutube ? "YouTube Studio" : "Shorts Studio"} cần Local Engine</h2>
          <p>Kết nối Local Engine để tự động quét nguồn, lọc video phù hợp và xuất chuẩn {isYoutube ? "YouTube ngang 16:9" : "Shorts dọc 9:16"}.</p>
          <Link className="btn primary" href="/sources">Mở Nguồn video</Link>
        </div>
      </section>
    );
  }

  return (
    <div className="studio-shell">
      <section className="panel studio-hero">
        <div className="studio-hero-head">
          <div>
            <span className="studio-eyebrow">{isYoutube ? "YOUTUBE LONG-FORM STUDIO · 16:9" : "SHORTS VERTICAL STUDIO · 9:16"}</span>
            <h2>{isYoutube ? "Chọn lọc video chuẩn YouTube ngang" : "Chọn lọc video chuẩn YouTube Shorts"}</h2>
            <p>
              {isYoutube
                ? "Tự động lọc video có thời lượng dài, khung ngang 16:9 hoặc theo Series để dựng video YouTube chất lượng cao."
                : "Tự động bắt các video ngắn ≤ 90s hoặc khung dọc 9:16 từ nguồn để làm Shorts nhịp nhanh, chữ nổi bật."}
            </p>
          </div>
          <div className="studio-stats">
            <div className="studio-stat"><strong>{candidates.length}</strong><span>Video phù hợp</span></div>
            <div className="studio-stat"><strong>{isYoutube ? "16:9" : "9:16"}</strong><span>Khung xuất</span></div>
          </div>
        </div>

        <form className="studio-source-bar" onSubmit={handleScanUrl}>
          <select aria-label="Chọn nguồn đã theo dõi" value={selectedSourceId} onChange={(e) => handleSelectSource(e.target.value)}>
            <option value="all">Tất cả nguồn đã đồng bộ ({videos.length})</option>
            {sources.map((src) => <option key={src.id} value={src.id}>{src.name} ({src.platform})</option>)}
          </select>
          <input
            aria-label="Link kênh nguồn"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="Hoặc dán link kênh Bilibili / Douyin để quét chọn lọc..."
          />
          <button type="submit" className="btn primary" disabled={scanning}>
            <Icon name="search" size={15} />
            {scanning ? "Đang quét…" : "Quét & lọc nguồn"}
          </button>
        </form>

        <div className="studio-preset-bar">
          <span className="studio-preset-title"><Icon name="settings" size={14} />Cấu hình xuất nhanh:</span>
          <label>
            Chế độ
            <select value={processMode} onChange={(e) => setProcessMode(e.target.value)}>
              <option value="voiceover">Vietsub + Voice</option>
              <option value="subtitle">Chỉ Vietsub</option>
            </select>
          </label>
          {processMode === "voiceover" && <>
            <label>
              Giọng đọc
              <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)}>
                <option value="Trúc Ly">Trúc Ly</option>
                <option value="Hải Đăng">Hải Đăng</option>
              </select>
            </label>
            <label>
              Tốc độ
              <select value={String(ttsSpeed)} onChange={(e) => setTtsSpeed(Number(e.target.value))}>
                <option value="1">1.00x (Chuẩn)</option>
                <option value="1.05">1.05x (Hơi nhanh)</option>
                <option value="1.1">1.10x (Nhịp Shorts)</option>
              </select>
            </label>
          </>}
          <label className="boost-gpu-toggle" title="Tăng tốc GPU tối đa (CUDA / NVENC / OCR GPU / đa luồng)">
            <input type="checkbox" checked={boostGpu} onChange={(e) => { const next = e.target.checked; setBoostGpu(next); try { localStorage.setItem("reupai:boost-gpu", next ? "1" : "0"); } catch {} }} />
            <span>Boost GPU</span>
          </label>
          <span className="studio-aspect-pill">Tỷ lệ: {isYoutube ? "16:9 Ngang" : "9:16 Dọc"}</span>
        </div>
      </section>

      <section className="panel studio-filter-panel">
        <div className="studio-filter-bar">
          <div className="studio-pills" role="group" aria-label="Bộ lọc chọn lọc">
            {isYoutube ? <>
              <button type="button" className={`btn ${fitFilter === "youtube_fit" ? "primary" : "secondary"}`} onClick={() => setFitFilter("youtube_fit")}>Chuẩn YouTube (≥ 60s)</button>
              <button type="button" className={`btn ${fitFilter === "long_3m" ? "primary" : "secondary"}`} onClick={() => setFitFilter("long_3m")}>Video dài (≥ 3p)</button>
              <button type="button" className={`btn ${fitFilter === "series" ? "primary" : "secondary"}`} onClick={() => setFitFilter("series")}>Thuộc Series</button>
              <button type="button" className={`btn ${fitFilter === "all" ? "primary" : "secondary"}`} onClick={() => setFitFilter("all")}>Tất cả</button>
            </> : <>
              <button type="button" className={`btn ${fitFilter === "shorts_fit" ? "primary" : "secondary"}`} onClick={() => setFitFilter("shorts_fit")}>Chuẩn Shorts (≤ 90s)</button>
              <button type="button" className={`btn ${fitFilter === "quick_60" ? "primary" : "secondary"}`} onClick={() => setFitFilter("quick_60")}>Ngắn (≤ 60s)</button>
              <button type="button" className={`btn ${fitFilter === "vertical_only" ? "primary" : "secondary"}`} onClick={() => setFitFilter("vertical_only")}>Dọc sẵn (9:16)</button>
              <button type="button" className={`btn ${fitFilter === "all" ? "primary" : "secondary"}`} onClick={() => setFitFilter("all")}>Tất cả</button>
            </>}
          </div>
          <div className="studio-filter-right">
            <input aria-label="Tìm nhanh video" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Lọc theo tên video…" />
            <select aria-label="Khung hình" value={orientFilter} onChange={(e) => setOrientFilter(e.target.value)}>
              <option value="all">Mọi khung hình</option>
              <option value="horizontal">Khung ngang (16:9)</option>
              <option value="vertical">Khung dọc (9:16)</option>
            </select>
            <select aria-label="Sắp xếp" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="score">Phù hợp nhất</option>
              <option value="views">Nhiều lượt xem</option>
              <option value="duration">{isYoutube ? "Dài nhất trước" : "Ngắn nhất trước"}</option>
            </select>
          </div>
        </div>

        <ErrorMessage error={error} />
        <Notice>{notice}</Notice>

        {loading || scanning ? <Loading label={scanning ? "Đang quét video từ nguồn…" : "Đang phân tích video phù hợp…"} /> : !candidates.length ? (
          <div className="empty-state">Không có video nào khớp bộ lọc hiện tại. Hãy chọn nguồn khác hoặc chuyển sang tab <strong>Tất cả</strong>.</div>
        ) : (
          <div className="studio-grid">
            {candidates.slice(0, 60).map(({ video, meta }) => {
              const id = video.video_id || video.platform_video_id;
              const job = jobsByVideo[id];
              const jobState = job?.state || job?.status;
              const isRunning = ACTIVE_JOBS.has(jobState);
              const isDone = Boolean(video.output_exists || video.file_path || jobState === "completed");
              return (
                <article className="studio-card" key={id}>
                  <VideoCover client={client} video={video}>
                    <span className={`studio-fit-badge ${meta.score >= 55 ? "is-high" : ""}`}>
                      {meta.reasons[0] || (isYoutube ? "YouTube 16:9" : "Shorts 9:16")}
                    </span>
                    {meta.sec > 0 && <span className="studio-dur-badge">{formatDuration(meta.sec)}</span>}
                  </VideoCover>
                  <div className="studio-card-body">
                    <h3>{video.title || id}</h3>
                    <div className="studio-card-meta">
                      <span>{video.platform || "bilibili"}</span>
                      <span>{formatViews(meta.views)} xem</span>
                      {video.series_name && <span className="studio-series-tag">{video.series_name}</span>}
                      {video.published_at && <span>{formatDate(video.published_at)}</span>}
                    </div>
                    {meta.reasons.length > 1 && (
                      <div className="studio-reasons">
                        {meta.reasons.slice(0, 3).map((reason) => <span key={reason}>{reason}</span>)}
                      </div>
                    )}
                    {isRunning && (
                      <div className="studio-job-progress">
                        <span>{JOB_LABELS[jobState] || "Đang xử lý"} {job?.progress ? `${Math.round(job.progress)}%` : ""}</span>
                      </div>
                    )}
                    <div className="studio-card-actions">
                      <button
                        type="button"
                        className="btn primary"
                        disabled={Boolean(submittingIds[id]) || isRunning}
                        onClick={() => startStudioProcess(video)}
                      >
                        <Icon name={isYoutube ? "play" : "spark"} size={14} />
                        {isRunning ? "Đang xử lý…" : submittingIds[id] ? "Đang gửi…" : isYoutube ? "Xuất YouTube 16:9" : "Xuất Shorts 9:16"}
                      </button>
                      {isDone && (
                        <button type="button" className="btn secondary" onClick={() => setPreview({ ...video, channel: "default", mode: processMode })}>
                          <Icon name="eye" size={14} />
                          Xem
                        </button>
                      )}
                      {isDone && youtube.connection?.connected && (
                        <button type="button" className="btn secondary" onClick={() => setPublishing({ ...video, channel: "default", mode: processMode })}>
                          <Icon name="upload" size={14} />
                          Đăng
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {preview && <PreviewDialog client={client} item={preview} onClose={() => setPreview(null)} onError={setError} onPublish={youtube.connection?.connected ? (item) => { setPreview(null); setPublishing(item); } : undefined} onEdit={(item) => { setPreview(null); setEditor(item); }} />}
      {editor && <OutputEditor client={client} item={editor} onClose={() => setEditor(null)} onError={setError} onQueued={() => { setNotice("Đã vào hàng đợi xuất lại."); setEditor(null); loadJobs(); }} />}
      {publishing && youtube.connection?.connected && <YoutubePublishDialog client={client} item={publishing} connection={youtube.connection} onClose={() => setPublishing(null)} />}
    </div>
  );
}
