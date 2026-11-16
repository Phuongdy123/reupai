"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useEngine } from "./engine-provider";
import { useYoutubeConnection } from "./youtube-connection";
import { Icon } from "./icon";
import { ACTIVE_JOBS, JOB_LABELS, Loading, ErrorMessage, Notice, VideoCover, PreviewDialog } from "./library-ui";
import { OutputEditor } from "./output-editor";
import { YoutubePublishDialog } from "./youtube-publish-dialog";
import { VIETNAMESE_TTS_VOICES, playVoicePreview } from "../lib/tts-voices";
import { prepareSourceInput, videoUrlForIdentity } from "../lib/source-url-input";

function isDouyinLink(value) {
  return /(?:^|\.)?(?:douyin\.com|v\.douyin\.com|iesdouyin\.com)/i.test(String(value || ""));
}

function isDouyinAuthError(message) {
  return /\[?DOUYIN_LOGIN_REQUIRED\]?|douyin.*(?:đăng nhập|xác minh|captcha|cookie|login)|yêu cầu đăng nhập/i.test(String(message || ""));
}

function cleanStudioError(message) {
  return String(message || "").replace(/\[DOUYIN_LOGIN_REQUIRED\]\s*/gi, "").trim();
}

function douyinLoginTargetUrl(rawUrl) {
  const prepared = prepareSourceInput(rawUrl);
  return isDouyinLink(prepared) ? prepared : "https://www.douyin.com/";
}

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

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("vi-VN");
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

const YOUTUBE_PROFILES = [
  {
    id: "yt_cinema",
    name: "Phim / Review Dài",
    tag: "CINEMA",
    desc: "Giọng trầm 1.00x · Sub sạch · Giữ 15% nhạc nền",
    mode: "voiceover",
    voice: "Hải Đăng",
    ttsSpeed: 1.0,
    subtitleStyle: "minimal",
    originalVolume: 0.15,
    autoBlur: true,
    boostGpu: true,
  },
  {
    id: "yt_story",
    name: "Series / Kể Chuyện",
    tag: "STORY",
    desc: "Giọng Trúc Ly 1.05x · Nhịp cuốn hút",
    mode: "voiceover",
    voice: "Trúc Ly",
    ttsSpeed: 1.05,
    subtitleStyle: "minimal",
    originalVolume: 0.12,
    autoBlur: true,
    boostGpu: true,
  },
  {
    id: "yt_sub_only",
    name: "Vietsub Chuẩn Gốc",
    tag: "PURE SUB",
    desc: "Giữ 100% âm thanh gốc · Phụ đề nét",
    mode: "subtitle",
    voice: "Trúc Ly",
    ttsSpeed: 1.0,
    subtitleStyle: "minimal",
    originalVolume: 1.0,
    autoBlur: false,
    boostGpu: true,
  },
  {
    id: "yt_master_gpu",
    name: "Master Turbo GPU",
    tag: "MAX SPEED",
    desc: "Tối đa CUDA/NVENC · Tắt âm gốc 0% · Lồng tiếng 1.05x",
    mode: "voiceover",
    voice: "Trúc Ly",
    ttsSpeed: 1.05,
    subtitleStyle: "bold",
    originalVolume: 0,
    autoBlur: true,
    boostGpu: true,
  },
];

const SHORTS_PROFILES = [
  {
    id: "sh_viral_hook",
    name: "Hook 3s Bùng Nổ",
    tag: "VIRAL",
    desc: "Nhịp nhanh 1.15x · Chữ to nổi bật · Dọc 9:16",
    mode: "voiceover",
    voice: "Trúc Ly",
    ttsSpeed: 1.15,
    subtitleStyle: "bold",
    originalVolume: 0.1,
    autoBlur: true,
    boostGpu: true,
  },
  {
    id: "sh_tiktok_fast",
    name: "TikTok / Reels Nhanh",
    tag: "1.20X",
    desc: "Tốc độ 1.20x · Hải Đăng · Che logo tự động",
    mode: "voiceover",
    voice: "Hải Đăng",
    ttsSpeed: 1.2,
    subtitleStyle: "bold",
    originalVolume: 0.08,
    autoBlur: true,
    boostGpu: true,
  },
  {
    id: "sh_movie_recap",
    name: "Tóm Tắt Phim Ngắn",
    tag: "RECAP",
    desc: "1.10x · Giữ 15% nhạc phim · Sub đậm rõ nét",
    mode: "voiceover",
    voice: "Trúc Ly",
    ttsSpeed: 1.1,
    subtitleStyle: "bold",
    originalVolume: 0.15,
    autoBlur: true,
    boostGpu: true,
  },
  {
    id: "sh_sub_viral",
    name: "Shorts Sub Gốc",
    tag: "ORIGINAL",
    desc: "Chỉ Vietsub đậm · Giữ nguyên âm thanh viral",
    mode: "subtitle",
    voice: "Trúc Ly",
    ttsSpeed: 1.0,
    subtitleStyle: "bold",
    originalVolume: 1.0,
    autoBlur: false,
    boostGpu: true,
  },
];

function needsVietnameseTranslation(text) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u.test(String(text || ""));
}

function cleanHookSourceTitle(text) {
  return String(text || "")
    .replace(/【[^】]*】/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[#@]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSmartHook(video, isYoutube, translatedTitle = "") {
  const candidate = translatedTitle || video?.title_vi || video?.translated_title || cleanHookSourceTitle(video?.title) || "Video nổi bật";
  const raw = String(candidate).replace(/[#@]+/g, "").trim();
  const shortTitle = raw.length > 78 ? `${raw.slice(0, 75)}...` : raw;
  if (isYoutube) {
    return {
      hook: `[Vietsub + Thuyết Minh] ${shortTitle} | Bản Full Đầy Đủ`,
      tags: "#ReupAI #Vietsub #ThuyetMinh #ReviewPhim #YouTube16x9",
    };
  }
  return {
    hook: `Đừng lướt qua! ${shortTitle} (Xem hết 3s cuối 🔥)`,
    tags: "#Shorts #YouTubeShorts #TikTokViral #Reels #ReupAI",
  };
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
  const youtube = useYoutubeConnection();

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

  // Streamlined Pro Studio Preset
  const profiles = isYoutube ? YOUTUBE_PROFILES : SHORTS_PROFILES;
  const [activeProfileId, setActiveProfileId] = useState(isYoutube ? "yt_cinema" : "sh_viral_hook");
  const [processMode, setProcessMode] = useState("voiceover");
  const [voiceName, setVoiceName] = useState(isYoutube ? "Hải Đăng" : "Trúc Ly");
  const [ttsSpeed, setTtsSpeed] = useState(isYoutube ? 1.0 : 1.15);
  const [subtitleStyle, setSubtitleStyle] = useState(isYoutube ? "minimal" : "bold");
  const [originalVolume, setOriginalVolume] = useState(0.15);
  const [autoBrandBlur, setAutoBrandBlur] = useState(true);
  const [boostGpu, setBoostGpu] = useState(true);
  const [submittingIds, setSubmittingIds] = useState({});
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [hookPreviewId, setHookPreviewId] = useState(null);
  const [translatedTitles, setTranslatedTitles] = useState({});
  const [translatingHookId, setTranslatingHookId] = useState(null);
  const [copiedHookId, setCopiedHookId] = useState(null);
  const [douyinAuthNeeded, setDouyinAuthNeeded] = useState(false);
  const [douyinCookieOpen, setDouyinCookieOpen] = useState(false);
  const [douyinCookieText, setDouyinCookieText] = useState("");
  const [douyinBusy, setDouyinBusy] = useState(false);

  const toggleSmartHook = async (video) => {
    const id = video?.video_id || video?.platform_video_id;
    if (!id) return;
    if (hookPreviewId === id) {
      setHookPreviewId(null);
      return;
    }
    setHookPreviewId(id);
    const cleaned = cleanHookSourceTitle(video?.title) || String(video?.title || "").trim();
    if (!cleaned || !needsVietnameseTranslation(cleaned) || translatedTitles[id] || video?.title_vi || video?.translated_title) {
      return;
    }
    setTranslatingHookId(id);
    try {
      const res = await client.json("/api/preview/subtitle-translation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_language: "auto",
          lines: [{ id: 1, text: cleaned.slice(0, 900) }],
        }),
      });
      const vi = String(res?.translations?.[0]?.text || "").replace(/[#@]+/g, "").trim();
      if (vi) {
        setTranslatedTitles((prev) => ({ ...prev, [id]: vi }));
      }
    } catch (err) {
      setError(err?.message || "Chưa dịch được tiêu đề để tạo Hook tiếng Việt.");
    } finally {
      setTranslatingHookId((cur) => (cur === id ? null : cur));
    }
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem("reupai:boost-gpu");
      if (saved !== null) setBoostGpu(saved === "1");
    } catch {}
  }, []);

  const applyProfile = (profile) => {
    setActiveProfileId(profile.id);
    setProcessMode(profile.mode);
    setVoiceName(profile.voice);
    setTtsSpeed(profile.ttsSpeed);
    setSubtitleStyle(profile.subtitleStyle);
    setOriginalVolume(profile.originalVolume);
    setAutoBrandBlur(profile.autoBlur);
    setBoostGpu(profile.boostGpu);
    try {
      localStorage.setItem("reupai:boost-gpu", profile.boostGpu ? "1" : "0");
    } catch {}
    setNotice(`Đã kích hoạt cấu hình Pro "${profile.name}".`);
  };

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

  const fetchSourceVideos = useCallback(async (rawUrl, refresh = false) => {
    const cleanUrl = prepareSourceInput(rawUrl);
    if (!cleanUrl) throw new Error("Hãy dán link kênh Bilibili hoặc Douyin để quét lọc.");

    const firstPage = await client.json("/api/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: cleanUrl,
        limit: 10,
        refresh: Boolean(refresh),
      }),
    });

    const collected = [];
    const seen = new Set();
    const pushItems = (items) => {
      for (const item of items || []) {
        const key = item?.video_id || item?.platform_video_id;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        collected.push(item);
      }
    };

    pushItems(firstPage?.videos || firstPage?.items || []);
    let hasMore = Boolean(firstPage?.has_more);

    for (let page = 2; page <= 3 && hasMore && collected.length >= 10; page += 1) {
      try {
        const nextRes = await client.json("/api/videos/page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: cleanUrl, page, limit: 10 }),
        });
        const nextItems = nextRes?.videos || nextRes?.items || [];
        if (!nextItems.length) break;
        pushItems(nextItems);
        hasMore = Boolean(nextRes?.has_more);
      } catch {
        break;
      }
    }

    return collected;
  }, [client]);

  const handleSelectSource = async (value) => {
    setSelectedSourceId(value);
    setError(null);
    setNotice(null);
    setDouyinAuthNeeded(false);
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
      const list = await fetchSourceVideos(found.profile_url, false);
      setVideos(list);
    } catch (err) {
      const msg = err?.message || "Không thể đọc video từ nguồn đã chọn.";
      setError(cleanStudioError(msg));
      if (isDouyinAuthError(msg) || isDouyinLink(found.profile_url)) {
        setDouyinAuthNeeded(true);
      }
    } finally {
      setScanning(false);
    }
  };

  const scanCurrentUrl = async (targetRaw = sourceUrl, refresh = true) => {
    const url = String(targetRaw || "").trim();
    if (!url) { setError("Hãy dán link kênh Bilibili hoặc Douyin để quét lọc."); return; }
    setScanning(true);
    setError(null);
    setNotice(null);
    setDouyinAuthNeeded(false);
    try {
      const list = await fetchSourceVideos(url, refresh);
      setVideos(list);
      setNotice(`Đã quét ${list.length} video từ nguồn và tự động chấm điểm phù hợp cho ${isYoutube ? "YouTube Ngang" : "Shorts 9:16"}.`);
    } catch (err) {
      const msg = err?.message || "Không thể quét nguồn này.";
      setError(cleanStudioError(msg));
      if (isDouyinAuthError(msg)) {
        setDouyinAuthNeeded(true);
      }
    } finally {
      setScanning(false);
    }
  };

  const handleScanUrl = async (event) => {
    event?.preventDefault();
    await scanCurrentUrl(sourceUrl, true);
  };

  const openDouyinNewTab = () => {
    const target = douyinLoginTargetUrl(sourceUrl);
    window.open(target, "_blank", "noopener,noreferrer");
    setDouyinAuthNeeded(true);
    setNotice("Đã mở Douyin ở tab mới trong trình duyệt hiện tại. Sau khi đăng nhập / xác minh xong, bấm \"Thử quét lại\" (hoặc dán Cookie nếu cần).");
  };

  const handleSaveDouyinCookies = async () => {
    const raw = douyinCookieText.trim();
    if (!raw) { setError("Hãy dán chuỗi Cookie Douyin (hoặc copy(document.cookie)) trước."); return; }
    setDouyinBusy(true);
    setError(null);
    try {
      const res = await client.json("/api/douyin/cookies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: raw }),
      });
      setDouyinCookieOpen(false);
      setDouyinCookieText("");
      setDouyinAuthNeeded(false);
      setNotice(`Đã lưu ${res?.count || 0} cookie Douyin. Đang quét lại nguồn…`);
      if (sourceUrl.trim()) await scanCurrentUrl(sourceUrl, true);
    } catch (err) {
      setError(err?.message || "Không lưu được cookie Douyin.");
    } finally {
      setDouyinBusy(false);
    }
  };

  const handleEngineDouyinLogin = async () => {
    setDouyinBusy(true);
    setError(null);
    setNotice("Đang mở cửa sổ đăng nhập Douyin của Local Engine… Hãy đăng nhập/xác minh xong trên cửa sổ đó.");
    try {
      await client.json("/api/douyin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: douyinLoginTargetUrl(sourceUrl) }),
      });
      setDouyinAuthNeeded(false);
      setNotice("Đã đồng bộ phiên đăng nhập Douyin. Đang quét lại nguồn…");
      if (sourceUrl.trim()) await scanCurrentUrl(sourceUrl, true);
    } catch (err) {
      setError(err?.message || "Không hoàn tất đăng nhập Douyin trên Local Engine.");
    } finally {
      setDouyinBusy(false);
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
        url: video.url || video.video_url || videoUrlForIdentity(id) || (video.platform === "douyin" ? `https://www.douyin.com/video/${id}` : `https://www.bilibili.com/video/${id}`),
        title: video.title || id,
        platform: video.platform || "bilibili",
        channel: "default",
        mode: processMode,
        aspect_ratio: isYoutube ? "16:9" : "9:16",
        subtitle_style: subtitleStyle,
        original_volume: Number(originalVolume),
        auto_brand_blur: Boolean(autoBrandBlur),
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

  const activeStudioJobs = useMemo(
    () =>
      Object.values(jobsByVideo).filter((job) => ACTIVE_JOBS.has(job?.state || job?.status)),
    [jobsByVideo]
  );

  const toggleSelectCard = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startBatchStudioProcess = async () => {
    const targets = candidates
      .map((entry) => entry.video)
      .filter((video) => selectedIds.has(video.video_id || video.platform_video_id));
    if (!targets.length) return;
    setBatchSubmitting(true);
    setError(null);
    let queued = 0;
    for (const video of targets) {
      try {
        await startStudioProcess(video);
        queued += 1;
      } catch {
        // continue batch
      }
    }
    setBatchSubmitting(false);
    setSelectedIds(new Set());
    if (queued > 0) {
      setNotice(`Đã xếp ${queued} video vào hàng chờ Pro Studio (${isYoutube ? "16:9" : "9:16"}).`);
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
            <div className="studio-eyebrow-row">
              <span className="studio-eyebrow">{isYoutube ? "YOUTUBE LONG-FORM STUDIO · 16:9" : "SHORTS VERTICAL STUDIO · 9:16"}</span>
              <span className="studio-pro-badge">PRO STUDIO ENGINE</span>
            </div>
            <h2>{isYoutube ? "Studio sản xuất YouTube chuyên nghiệp" : "Shorts & TikTok Viral Studio"}</h2>
            <p>
              {isYoutube
                ? "Bộ lọc thông minh cho video dài 16:9 & Series, Mastering âm thanh/phụ đề chuẩn Cinema và xuất hàng loạt GPU."
                : "Tự động săn clip dọc 9:16 & video ngắn ≤ 90s, nhịp voice nhanh 1.15x–1.20x, sub nổi bật và tạo Hook 3s."}
            </p>
          </div>
          <div className="studio-stats">
            <div className="studio-stat"><strong>{candidates.length}</strong><span>Video phù hợp</span></div>
            <div className="studio-stat"><strong>{activeStudioJobs.length}</strong><span>Đang render</span></div>
            <div className="studio-stat"><strong>{isYoutube ? "16:9" : "9:16"}</strong><span>Khung xuất</span></div>
          </div>
        </div>

        <div className="studio-profiles-grid" role="group" aria-label="Cấu hình Pro 1 chạm">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              aria-pressed={activeProfileId === profile.id}
              className={`studio-profile-btn ${activeProfileId === profile.id ? "is-active" : ""}`}
              onClick={() => applyProfile(profile)}
            >
              <strong>
                <span>{profile.name}</span>
                <span className="studio-profile-tag">{profile.tag}</span>
              </strong>
              <small>{profile.desc}</small>
            </button>
          ))}
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
          {isDouyinLink(sourceUrl) && (
            <button type="button" className="btn secondary" onClick={openDouyinNewTab} title="Mở Douyin trong tab mới của trình duyệt hiện tại để đăng nhập">
              <Icon name="external" size={14} />
              Tab Douyin
            </button>
          )}
          <button type="submit" className="btn primary" disabled={scanning}>
            <Icon name="search" size={15} />
            {scanning ? "Đang quét…" : "Quét & lọc nguồn"}
          </button>
        </form>

        {(douyinAuthNeeded || isDouyinAuthError(error)) && (
          <div className="douyin-auth-bar" role="region" aria-label="Đăng nhập Douyin">
            <div className="douyin-auth-copy">
              <strong>Cần xác minh hoặc đăng nhập Douyin</strong>
              <span>Mở Douyin ngay trong tab mới của trình duyệt hiện tại để đăng nhập/giải captcha, hoặc dùng cửa sổ Local Engine / dán Cookie.</span>
            </div>
            <div className="douyin-auth-actions">
              <button type="button" className="btn primary" onClick={openDouyinNewTab}>
                <Icon name="external" size={14} />
                Mở tab Douyin đăng nhập
              </button>
              <button type="button" className="btn secondary" disabled={scanning || douyinBusy} onClick={() => scanCurrentUrl(sourceUrl, true)}>
                Thử quét lại
              </button>
              <button type="button" className="btn secondary" disabled={douyinBusy} onClick={handleEngineDouyinLogin}>
                {douyinBusy ? "Đang chờ đăng nhập…" : "Cửa sổ tự động"}
              </button>
              <button type="button" className="btn secondary" onClick={() => setDouyinCookieOpen((prev) => !prev)}>
                Dán Cookie
              </button>
            </div>
            {douyinCookieOpen && (
              <div className="douyin-cookie-drawer">
                <input
                  type="text"
                  value={douyinCookieText}
                  onChange={(e) => setDouyinCookieText(e.target.value)}
                  placeholder="Dán Cookie header hoặc JSON cookie từ tab Douyin…"
                />
                <button type="button" className="btn primary" disabled={douyinBusy} onClick={handleSaveDouyinCookies}>
                  Lưu &amp; quét lại
                </button>
              </div>
            )}
          </div>
        )}

        <div className="studio-preset-bar">
          <span className="studio-preset-title"><Icon name="settings" size={14} />Mastering Pro:</span>
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
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)}>
                  {VIETNAMESE_TTS_VOICES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
                <button type="button" className="btn secondary" onClick={(e) => playVoicePreview(voiceName, { button: e.currentTarget, onError: (msg) => setError(msg) })}>🔊 Nghe thử</button>
              </div>
            </label>
            <label>
              Tốc độ
              <select value={String(ttsSpeed)} onChange={(e) => setTtsSpeed(Number(e.target.value))}>
                <option value="1">1.00x (Chuẩn)</option>
                <option value="1.05">1.05x (Cuốn hút)</option>
                <option value="1.1">1.10x (Nhanh)</option>
                <option value="1.15">1.15x (Shorts)</option>
                <option value="1.2">1.20x (TikTok)</option>
              </select>
            </label>
          </>}
          <label>
            Kiểu Sub
            <select value={subtitleStyle} onChange={(e) => setSubtitleStyle(e.target.value)}>
              <option value="minimal">Cinema Clean</option>
              <option value="bold">Viral Bold</option>
            </select>
          </label>
          <label>
            Âm gốc
            <select value={String(originalVolume)} onChange={(e) => setOriginalVolume(Number(e.target.value))}>
              <option value="0">0% Tắt gốc</option>
              <option value="0.12">12% Nhạc nhẹ</option>
              <option value="0.15">15% Cân bằng</option>
              <option value="0.25">25% Rõ nền</option>
              <option value="1">100% Gốc</option>
            </select>
          </label>
          <label className="studio-check-pill">
            <input type="checkbox" checked={autoBrandBlur} onChange={(e) => setAutoBrandBlur(e.target.checked)} />
            <span>Che Watermark</span>
          </label>
          <label className="boost-gpu-toggle" title="Tăng tốc GPU tối đa (CUDA / NVENC / OCR GPU / đa luồng)">
            <input type="checkbox" checked={boostGpu} onChange={(e) => { const next = e.target.checked; setBoostGpu(next); try { localStorage.setItem("reupai:boost-gpu", next ? "1" : "0"); } catch {} }} />
            <span>Boost GPU</span>
          </label>
          <span className="studio-aspect-pill">Tỷ lệ: {isYoutube ? "16:9 Ngang" : "9:16 Dọc"}</span>
        </div>
      </section>

      {activeStudioJobs.length > 0 && (
        <div className="studio-live-strip" role="status">
          <span className="studio-preset-title"><Icon name="spark" size={14} />Đang render ({activeStudioJobs.length}):</span>
          {activeStudioJobs.slice(0, 5).map((job) => (
            <span className="studio-live-chip" key={job.video_id}>
              <span>{job.title || job.video_id}</span>
              <strong>{job.progress ? `${Math.round(job.progress)}%` : JOB_LABELS[job.state || job.status] || "Đang chạy"}</strong>
            </span>
          ))}
        </div>
      )}

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

        {!loading && !scanning && candidates.length > 0 && (
          <div className="studio-batch-bar">
            <div className="studio-batch-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  const visibleIds = candidates.slice(0, 60).map((c) => c.video.video_id || c.video.platform_video_id);
                  setSelectedIds(selectedIds.size === visibleIds.length ? new Set() : new Set(visibleIds));
                }}
              >
                {selectedIds.size > 0 && selectedIds.size === Math.min(60, candidates.length) ? "Bỏ chọn" : "Chọn tất cả"}
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  const top5 = candidates.slice(0, 5).map((c) => c.video.video_id || c.video.platform_video_id);
                  setSelectedIds(new Set(top5));
                  setNotice("Đã chọn Top 5 video phù hợp nhất.");
                }}
              >
                Chọn Top 5
              </button>
              <span className="status">{selectedIds.size} đã chọn</span>
            </div>
            <button
              type="button"
              className="btn primary"
              disabled={batchSubmitting || selectedIds.size === 0}
              onClick={startBatchStudioProcess}
            >
              <Icon name={isYoutube ? "play" : "spark"} size={14} />
              {batchSubmitting ? "Đang xếp hàng chờ…" : `Xuất hàng loạt (${selectedIds.size} video)`}
            </button>
          </div>
        )}

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
              const isSelected = selectedIds.has(id);
              const smartHook = hookPreviewId === id ? buildSmartHook(video, isYoutube, translatedTitles[id]) : null;
              const isTranslatingHook = hookPreviewId === id && translatingHookId === id && !translatedTitles[id];
              return (
                <article className={`studio-card ${isSelected ? "is-selected" : ""}`} key={id}>
                  <VideoCover client={client} video={video}>
                    <label className="studio-select-box" title="Chọn xử lý hàng loạt">
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelectCard(id)} />
                    </label>
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
                    {smartHook && (
                      <div className="studio-hook-box">
                        {isTranslatingHook ? (
                          <span>Đang dịch tiêu đề sang tiếng Việt &amp; tạo Hook…</span>
                        ) : (
                          <>
                            <strong>{smartHook.hook}</strong>
                            <span>{smartHook.tags}</span>
                            <button
                              type="button"
                              className="btn secondary"
                              style={{ marginTop: 6, minHeight: 26, height: 26, padding: "0 10px", fontSize: 11, justifySelf: "start" }}
                              onClick={() => {
                                navigator.clipboard?.writeText(`${smartHook.hook}\n${smartHook.tags}`).then(() => {
                                  setCopiedHookId(id);
                                  setTimeout(() => setCopiedHookId((cur) => (cur === id ? null : cur)), 1600);
                                }).catch(() => {});
                              }}
                            >
                              {copiedHookId === id ? "Đã sao chép ✓" : "Sao chép Hook"}
                            </button>
                          </>
                        )}
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
                      <button
                        type="button"
                        className="btn secondary"
                        title="Dịch tiêu đề & gợi ý Hook + Hashtag"
                        onClick={() => toggleSmartHook(video)}
                      >
                        Hook
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
