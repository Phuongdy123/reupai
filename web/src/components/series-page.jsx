"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "./icon";
import { useEngine } from "./engine-provider";
import { VIETNAMESE_TTS_VOICES, playVoicePreview } from "../lib/tts-voices";
import { releaseBillingToken, reserveBillingToken } from "../lib/billing-reserve";
import {
  EngineGate,
  ErrorMessage,
  LibraryVideoCard,
  Loading,
  Notice,
  Pager,
  PreviewDialog,
  addVideosToCollection,
  createLocalFileIndex,
  sourcePath,
  videoBody,
  withLocalFiles,
} from "./library-ui";

const PAGE_SIZE = 12;

const DEFAULT_SERIES_CONFIG = {
  mode: "both",
  voice: "Trúc Ly",
  voice_speed: 1.0,
  source_lang: "auto",
  target_lang: "vi",
  transcript_source: "audio",
  aspect_ratio: "auto",
  boost_gpu: true,
};

function fromSource(video, source) {
  if (!source) return true;
  if (source.source_id != null) return String(video.source_id || "") === String(source.source_id);
  const name = video.source_name || video.channel_name || video.platform || "Nguồn không tên";
  return name === source.name && (video.platform || "") === source.platform;
}

function episodeSortValue(video, sortMode) {
  const ep = video?.episode_number != null && Number.isFinite(Number(video.episode_number))
    ? Number(video.episode_number)
    : 999999;
  const pub = String(video?.published_at || video?.upload_date || "9999-99-99");
  const title = String(video?.title || "").toLowerCase();
  if (sortMode === "oldest_first") {
    return { primary: pub, secondary: ep, tertiary: title };
  }
  return { primary: ep, secondary: pub, tertiary: title };
}

function sortEpisodes(list, sortMode) {
  return [...list].sort((a, b) => {
    const ka = episodeSortValue(a, sortMode);
    const kb = episodeSortValue(b, sortMode);
    if (ka.primary < kb.primary) return -1;
    if (ka.primary > kb.primary) return 1;
    if (ka.secondary < kb.secondary) return -1;
    if (ka.secondary > kb.secondary) return 1;
    return ka.tertiary.localeCompare(kb.tertiary);
  });
}

function isVideoDone(video) {
  return Boolean(
    video?.has_subtitle_result ||
      video?.has_voice_result ||
      (Array.isArray(video?.output_files) && video.output_files.length > 0)
  );
}

function summarizeConfig(cfg) {
  const c = { ...DEFAULT_SERIES_CONFIG, ...(cfg || {}) };
  const modeLabel =
    c.mode === "subtitle" ? "Vietsub" : c.mode === "voice" ? "Lồng tiếng AI" : "Vietsub + Voice";
  const parts = [modeLabel, c.target_lang || "vi"];
  if (c.mode !== "subtitle") parts.push(`${Number(c.voice_speed || 1).toFixed(2)}x`);
  if (c.transcript_source === "video_subtitles") parts.push("OCR phụ đề");
  if (c.boost_gpu) parts.push("Boost GPU");
  return parts.join(" · ");
}

function _readLocalSavedSeries() {
  try {
    const raw = window.localStorage.getItem("reupai:saved-series-v1");
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function _writeLocalSavedSeries(list) {
  try {
    window.localStorage.setItem("reupai:saved-series-v1", JSON.stringify(list));
  } catch {}
}

function _readDetectedSeriesCache() {
  try {
    const raw = window.localStorage.getItem("reupai:detected-series-cache-v1");
    const parsed = JSON.parse(raw || "null");
    if (!parsed || typeof parsed !== "object") return { groups: [], videosByKey: {} };
    return {
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      videosByKey: parsed.videosByKey && typeof parsed.videosByKey === "object" ? parsed.videosByKey : {},
    };
  } catch {
    return { groups: [], videosByKey: {} };
  }
}

function _mergeDetectedSeries(serverList = [], cache = null) {
  const cached = cache || _readDetectedSeriesCache();
  const byKey = new Map();
  for (const item of serverList) {
    if (item?.series_key) byKey.set(item.series_key, item);
  }
  for (const item of cached.groups || []) {
    if (!item?.series_key) continue;
    const existing = byKey.get(item.series_key);
    if (!existing) {
      byKey.set(item.series_key, { ...item, fromLocalCache: true });
    } else if (Number(item.count || 0) > Number(existing.count || 0)) {
      byKey.set(item.series_key, {
        ...existing,
        count: item.count,
        episodes: item.episodes?.length ? item.episodes : existing.episodes,
        fromLocalCache: true,
      });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
}

async function _syncSavedSeriesToUiState(client, list) {
  try {
    await client.json("/api/library/ui-state/saved_series_v1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: { series: Array.isArray(list) ? list : [] } }),
    });
  } catch {
    // ignore ui-state backup failure
  }
}

function _mergeSavedSeries(serverList = [], uiStateList = []) {
  const byKey = new Map();
  const applyEntry = (item, fromServer = false) => {
    if (!item?.series_key) return;
    const prev = byKey.get(item.series_key) || {};
    const videoIds = item.video_ids || prev.video_ids || [];
    const totalCount = fromServer
      ? (item.total_count ?? videoIds.length ?? 0)
      : Math.max(Number(item.total_count ?? videoIds.length ?? 0), Number(prev.total_count || 0));
    byKey.set(item.series_key, {
      ...prev,
      ...item,
      videos: item.videos?.length ? item.videos : prev.videos,
      video_ids: videoIds,
      total_count: totalCount,
      processed_count: item.processed_count ?? prev.processed_count ?? 0,
      pending_count: item.pending_count ?? prev.pending_count ?? totalCount,
      processing_count: item.processing_count ?? prev.processing_count ?? 0,
    });
  };
  for (const item of _readLocalSavedSeries()) applyEntry(item, false);
  for (const item of uiStateList || []) applyEntry(item, false);
  for (const item of serverList || []) applyEntry(item, true);
  return Array.from(byKey.values());
}

export function SeriesPage() {
  const { status, client, connect, check } = useEngine();
  const [series, setSeries] = useState([]);
  const [savedSeries, setSavedSeries] = useState([]);
  const [selected, setSelected] = useState(null);
  const [sourceKey, setSourceKey] = useState("");
  const [videos, setVideos] = useState([]);
  const [downloads, setDownloads] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selectedVideos, setSelectedVideos] = useState(new Set());
  const [busy, setBusy] = useState(new Set());
  const [targetCollection, setTargetCollection] = useState("");
  const [saving, setSaving] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [preview, setPreview] = useState(null);
  const [episodeRange, setEpisodeRange] = useState("");
  const [sortMode, setSortMode] = useState("episode_asc");
  const [seriesConfig, setSeriesConfig] = useState(() => {
    try {
      const boost = localStorage.getItem("reupai:boost-gpu") === "1";
      return { ...DEFAULT_SERIES_CONFIG, boost_gpu: boost };
    } catch {
      return { ...DEFAULT_SERIES_CONFIG };
    }
  });

  const sources = useMemo(
    () => [
      ...new Map(
        series.flatMap((item) => item.sources || []).map((source) => [source.key, source])
      ).values(),
    ],
    [series]
  );
  const currentSource = sources.find((item) => item.key === sourceKey);

  const loadSeries = useCallback(async () => {
    if (status !== "connected") return;
    setLoading(true);
    setError(null);
    try {
      const [result, savedRes, uiSavedRes, files, rendered, groups] = await Promise.all([
        client.json("/api/library/series"),
        client.json("/api/library/series/saved").catch(() => ({ series: [] })),
        client.json("/api/library/ui-state/saved_series_v1").catch(() => ({ value: { series: [] } })),
        client.json("/api/library/downloads"),
        client.json("/api/library/outputs"),
        client.json("/api/library/collections"),
      ]);
      const mergedSaved = _mergeSavedSeries(savedRes.series || [], uiSavedRes?.value?.series || []);
      if (mergedSaved.length) _writeLocalSavedSeries(mergedSaved);
      setSeries(_mergeDetectedSeries(result.series || []));
      setSavedSeries(mergedSaved);
      setDownloads(files.videos || []);
      setOutputs(rendered.outputs || []);
      setCollections(groups.collections || []);
    } catch (requestError) {
      setError(requestError.message || "Không thể tải Series.");
    } finally {
      setLoading(false);
    }
  }, [client, status]);

  useEffect(() => {
    loadSeries();
  }, [loadSeries]);

  const loadEpisodes = useCallback(async () => {
    if (status !== "connected" || !selected) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ series: selected.series_key, limit: "2000" });
      if (currentSource?.source_id != null) params.set("source_id", currentSource.source_id);
      const [data, files, rendered, savedRes, uiSavedRes] = await Promise.all([
        client.json(`/api/library/videos?${params}`),
        client.json("/api/library/downloads"),
        client.json("/api/library/outputs"),
        client.json("/api/library/series/saved").catch(() => ({ series: [] })),
        client.json("/api/library/ui-state/saved_series_v1").catch(() => ({ value: { series: [] } })),
      ]);
      setDownloads(files.videos || []);
      setOutputs(rendered.outputs || []);
      const mergedSaved = _mergeSavedSeries(savedRes.series || [], uiSavedRes?.value?.series || []);
      setSavedSeries(mergedSaved);
      const matchedSaved = mergedSaved.find((s) => s.series_key === selected.series_key);
      const savedEntryVideos = Array.isArray(selected.videos) && selected.videos.length
        ? selected.videos
        : (Array.isArray(matchedSaved?.videos) ? matchedSaved.videos : []);
      const serverVideos = (data.videos || []).filter((video) => fromSource(video, currentSource));
      const cachedVideos = (_readDetectedSeriesCache().videosByKey?.[selected.series_key] || []);
      const mergedVideosMap = new Map();
      for (const v of savedEntryVideos) {
        if (v?.video_id) mergedVideosMap.set(String(v.video_id), v);
      }
      for (const v of cachedVideos) {
        if (v?.video_id) mergedVideosMap.set(String(v.video_id), v);
      }
      for (const v of serverVideos) {
        if (v?.video_id) mergedVideosMap.set(String(v.video_id), v);
      }
      if (!mergedVideosMap.size && Array.isArray(selected.video_ids) && selected.video_ids.length) {
        const wanted = new Set(selected.video_ids.map(String));
        const libAll = await client.json("/api/library/videos?limit=2000").catch(() => ({ videos: [] }));
        for (const v of (libAll.videos || [])) {
          if (v?.video_id && wanted.has(String(v.video_id))) {
            mergedVideosMap.set(String(v.video_id), v);
          }
        }
      }
      setVideos(Array.from(mergedVideosMap.values()));
    } catch (requestError) {
      setError(requestError.message || "Không thể tải danh sách tập.");
    } finally {
      setLoading(false);
    }
  }, [client, currentSource, selected, status]);

  useEffect(() => {
    loadEpisodes();
  }, [loadEpisodes]);

  // Poll tiến độ hàng chờ nếu có series đang xử lý
  useEffect(() => {
    if (status !== "connected") return;
    const hasActive =
      savedSeries.some((item) => (item.processing_count || 0) > 0) ||
      videos.some((v) => v.processing);
    if (!hasActive) return;
    const timer = setInterval(() => {
      if (selected) loadEpisodes();
      else loadSeries();
    }, 5000);
    return () => clearInterval(timer);
  }, [status, savedSeries, videos, selected, loadEpisodes, loadSeries]);

  useEffect(() => {
    setPage(1);
    setSelectedVideos(new Set());
  }, [query, filter, sourceKey, selected]);

  const openSeriesItem = (item) => {
    const saved = savedSeries.find((s) => s.series_key === item.series_key);
    if (saved) {
      setSortMode(saved.sort_mode || "episode_asc");
      setSeriesConfig({ ...DEFAULT_SERIES_CONFIG, ...(saved.config || {}) });
    }
    setSelected(item);
    setVideos([]);
    setQuery("");
    setFilter("");
  };

  const visibleSeries = useMemo(
    () =>
      series.filter(
        (item) =>
          (!sourceKey || (item.sources || []).some((source) => source.key === sourceKey)) &&
          (!query.trim() ||
            `${item.name} ${item.source_label}`
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase()))
      ),
    [series, sourceKey, query]
  );

  const localFiles = useMemo(() => createLocalFileIndex(downloads, outputs), [downloads, outputs]);
  const localVideos = useMemo(
    () => videos.map((video) => withLocalFiles(video, localFiles)),
    [videos, localFiles]
  );

  const sortedLocalVideos = useMemo(
    () => sortEpisodes(localVideos, sortMode),
    [localVideos, sortMode]
  );

  const filteredVideos = useMemo(
    () =>
      sortedLocalVideos.filter(
        (video) =>
          (!query.trim() ||
            `${video.title} ${video.video_id} ${video.episode_number || ""}`
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase())) &&
          (!filter ||
            (filter === "downloaded"
              ? video.downloaded
              : filter === "not-downloaded"
                ? !video.downloaded
                : filter === "subtitle"
                  ? video.has_subtitle_result
                  : filter === "voiceover"
                    ? video.has_voice_result
                    : filter === "done"
                      ? isVideoDone(video)
                      : filter === "pending"
                        ? !isVideoDone(video) && !video.processing
                        : video.processing))
      ),
    [sortedLocalVideos, query, filter]
  );

  const seriesProgress = useMemo(() => {
    const total = sortedLocalVideos.length;
    const done = sortedLocalVideos.filter(isVideoDone).length;
    const running = sortedLocalVideos.filter((v) => v.processing && !isVideoDone(v)).length;
    return { total, done, running, pending: Math.max(0, total - done - running) };
  }, [sortedLocalVideos]);

  const setBusyId = (id, value) =>
    setBusy((previous) => {
      const next = new Set(previous);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggleFavorite = async (video) => {
    setBusyId(video.video_id, true);
    setError(null);
    try {
      const result = await client.json("/api/library/favorites/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(videoBody(video)),
      });
      setVideos((previous) =>
        previous.map((item) =>
          item.video_id === video.video_id ? { ...item, favorite: result.favorite } : item
        )
      );
    } catch (requestError) {
      setError(requestError.message || "Không thể cập nhật yêu thích.");
    } finally {
      setBusyId(video.video_id, false);
    }
  };

  const download = async (video, sourceFile) => {
    setBusyId(video.video_id, true);
    setError(null);
    try {
      if (sourceFile) await client.downloadFile(sourcePath(sourceFile), `${video.video_id}-source.mp4`);
      else {
        const response = await client.request("/api/download?local_only=true", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ video_id: video.video_id, url: video.url }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.detail || `Không thể tải video (HTTP ${response.status}).`);
        }
        try {
          await response.body?.cancel();
        } catch (_) {
          // Local Engine đã lưu file nguồn.
        }
        const files = await client.json("/api/library/downloads");
        setDownloads(files.videos || []);
        await loadEpisodes();
        setNotice("Đã tải video về máy.");
      }
    } catch (requestError) {
      setError(requestError.message || "Không thể tải video.");
      throw requestError;
    } finally {
      setBusyId(video.video_id, false);
    }
  };

  const downloadSelection = async () => {
    setSaving(true);
    try {
      for (const video of sortedLocalVideos.filter(
        (item) => selectedVideos.has(item.video_id) && !item.downloaded && item.url
      )) {
        await download(video, null);
      }
      setNotice("Đã tải các tập được chọn về máy.");
    } catch (_) {
      // Lỗi đã hiển thị trong download.
    } finally {
      setSaving(false);
    }
  };

  const addSelection = async () => {
    if (!targetCollection) return;
    setSaving(true);
    setError(null);
    try {
      const selectedItems = videos.filter((item) => selectedVideos.has(item.video_id));
      await addVideosToCollection(client, targetCollection, selectedItems);
      setNotice("Đã thêm các tập vào Collection.");
      setSelectedVideos(new Set());
    } catch (requestError) {
      setError(requestError.message || "Không thể thêm tập vào Collection.");
    } finally {
      setSaving(false);
    }
  };

  const selectEpisodeRange = () => {
    const raw = episodeRange.trim();
    if (!raw) {
      setSelectedVideos(new Set(filteredVideos.map((item) => item.video_id)));
      return;
    }
    const match = raw.match(/^(\d+)(?:\s*[-–:]\s*(\d+))?$/);
    if (!match) {
      setError("Nhập số tập, ví dụ 4 hoặc 5-80.");
      return;
    }
    const from = Number(match[1]);
    const to = Number(match[2] || match[1]);
    if (to < from) {
      setError("Tập cuối phải lớn hơn hoặc bằng tập đầu.");
      return;
    }
    const chosen = filteredVideos.filter((item, index) => {
      const episode = Number(item.episode_number || index + 1);
      return episode >= from && episode <= to;
    });
    setSelectedVideos(new Set(chosen.map((item) => item.video_id)));
    setNotice(`Đã chọn ${chosen.length} tập trong khoảng ${from}–${to}.`);
  };

  const saveCurrentSeries = async (customVideos = null) => {
    if (!selected) return null;
    setSaving(true);
    setError(null);
    try {
      const targetList = customVideos || sortedLocalVideos;
      const orderedIds = targetList.map((v) => v.video_id);
      const payload = {
        series_key: selected.series_key,
        name: selected.name,
        source_key: currentSource?.key || "",
        source_label: currentSource?.name || selected.source_label || "",
        sort_mode: sortMode,
        config: seriesConfig,
        video_ids: orderedIds,
        videos: targetList.slice(0, 500).map(videoBody),
      };
      let res = null;
      try {
        res = await client.json("/api/library/series/saved", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        if (!/not found|404/i.test(String(err?.message || ""))) throw err;
      }
      const nextLocal = _readLocalSavedSeries().filter((s) => s.series_key !== selected.series_key);
      const { videos: _omitVideos, ...localMeta } = payload;
      nextLocal.unshift({
        ...(res?.series || localMeta),
        total_count: res?.series?.total_count ?? orderedIds.length,
        videos: targetList.slice(0, 120),
        saved_at: Date.now(),
      });
      _writeLocalSavedSeries(nextLocal);
      await _syncSavedSeriesToUiState(client, nextLocal);
      const updated = await client.json("/api/library/series/saved").catch(() => ({ series: [] }));
      setSavedSeries(_mergeSavedSeries(updated.series || [], nextLocal));
      setNotice(`Đã lưu Series "${selected.name}" (${seriesProgress.done}/${seriesProgress.total}).`);
      return res?.series || localMeta;
    } catch (requestError) {
      setError(requestError.message || "Không thể lưu Series.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const queueBatchVideos = async (targetVideos, cfg, seriesItemMeta) => {
    if (!targetVideos.length) {
      setError("Không có tập nào cần xử lý.");
      return;
    }
    setBatchRunning(true);
    setError(null);
    let queuedCount = 0;
    let skippedCount = 0;
    const finalCfg = { ...DEFAULT_SERIES_CONFIG, ...(cfg || {}) };

    try {
      if (seriesItemMeta) {
        const metaPayload = {
          series_key: seriesItemMeta.series_key,
          name: seriesItemMeta.name,
          source_key: seriesItemMeta.source_key || "",
          source_label: seriesItemMeta.source_label || "",
          sort_mode: seriesItemMeta.sort_mode || sortMode,
          config: finalCfg,
          video_ids: seriesItemMeta.video_ids || targetVideos.map((v) => v.video_id),
          videos: targetVideos.slice(0, 500).map(videoBody),
        };
        const savedMeta = await client
          .json("/api/library/series/saved", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(metaPayload),
          })
          .catch(() => null);
        const { videos: _omitVideos, ...localMeta } = metaPayload;
        const nextLocal = _readLocalSavedSeries().filter((s) => s.series_key !== metaPayload.series_key);
        nextLocal.unshift({ ...(savedMeta?.series || localMeta), saved_at: Date.now() });
        _writeLocalSavedSeries(nextLocal);
      }

      const apiMode = finalCfg.mode === "subtitle" ? "subtitle" : "voiceover";
      const aspectRatio = finalCfg.aspect_ratio && finalCfg.aspect_ratio !== "auto" ? finalCfg.aspect_ratio : null;

      let lastProcessError = "";
      for (const video of targetVideos) {
        if (!video?.video_id) continue;
        let billingToken = null;
        try {
          billingToken = await reserveBillingToken({ videoId: video.video_id, mode: apiMode });
          await client.json("/api/process", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              video_id: video.video_id,
              channel: video.channel_key || "default",
              url: video.url || "",
              mode: apiMode,
              voice: finalCfg.voice || "Trúc Ly",
              tts_speed: Number(finalCfg.voice_speed || 1.0),
              source_language: finalCfg.source_lang || "auto",
              transcript_source: finalCfg.transcript_source || "audio",
              aspect_ratio: aspectRatio,
              boost_gpu: Boolean(finalCfg.boost_gpu),
              ocr_use_gpu: Boolean(finalCfg.boost_gpu),
              ocr_parallelism: finalCfg.boost_gpu ? 4 : 2,
              stability_mode: true,
              ...(billingToken ? { billing_token: billingToken } : {}),
            }),
          });
          queuedCount += 1;
        } catch (err) {
          await releaseBillingToken(billingToken);
          lastProcessError = err?.message || lastProcessError;
          skippedCount += 1;
          if ([401, 402, 403].includes(Number(err?.status))) {
            break;
          }
        }
      }

      const savedRes = await client.json("/api/library/series/saved").catch(() => ({ series: [] }));
      setSavedSeries(_mergeSavedSeries(savedRes.series || []));
      if (selected) await loadEpisodes();
      else await loadSeries();

      if (queuedCount === 0 && lastProcessError) {
        setError(lastProcessError);
      } else {
        setNotice(
          `Đã đẩy ${queuedCount} tập vào hàng chờ Series theo thứ tự${
            skippedCount ? ` (bỏ qua ${skippedCount} tập đang chạy/lỗi)` : ""
          }.`
        );
      }
    } catch (requestError) {
      setError(requestError.message || "Không thể đẩy hàng loạt vào hàng chờ.");
    } finally {
      setBatchRunning(false);
    }
  };

  const runSelectedBatch = async () => {
    const orderedSelected = sortedLocalVideos.filter((v) => selectedVideos.has(v.video_id));
    if (!orderedSelected.length) {
      setError("Hãy tích chọn ít nhất 1 tập để xử lý hàng loạt.");
      return;
    }
    await queueBatchVideos(orderedSelected, seriesConfig, {
      series_key: selected.series_key,
      name: selected.name,
      source_key: currentSource?.key || "",
      source_label: currentSource?.name || selected.source_label || "",
      sort_mode: sortMode,
      video_ids: sortedLocalVideos.map((v) => v.video_id),
    });
  };

  const resumeSavedSeries = async (savedItem) => {
    setBatchRunning(true);
    setError(null);
    try {
      const params = new URLSearchParams({ series: savedItem.series_key, limit: "2000" });
      const data = await client.json(`/api/library/videos?${params}`);
      let rawVideos = data.videos || [];
      if (!rawVideos.length && Array.isArray(savedItem.video_ids) && savedItem.video_ids.length) {
        const allData = await client.json("/api/library/videos?limit=2000");
        const idSet = new Set(savedItem.video_ids.map(String));
        rawVideos = (allData.videos || []).filter((v) => idSet.has(String(v.video_id)));
      }
      const ordered = sortEpisodes(rawVideos, savedItem.sort_mode || "episode_asc");
      const remaining = ordered.filter((v) => !isVideoDone(v) && !v.processing);
      if (!remaining.length) {
        setNotice(`Series "${savedItem.name}" đã xử lý xong toàn bộ (${savedItem.progress_label}).`);
        setBatchRunning(false);
        return;
      }
      await queueBatchVideos(remaining, savedItem.config || DEFAULT_SERIES_CONFIG, savedItem);
    } catch (requestError) {
      setError(requestError.message || "Không thể tiếp tục xử lý Series.");
      setBatchRunning(false);
    }
  };

  const removeSavedSeries = async (seriesKey) => {
    setError(null);
    try {
      try {
        await client.json(`/api/library/series/saved/${encodeURIComponent(seriesKey)}`, {
          method: "DELETE",
        });
      } catch (err) {
        if (!/not found|404/i.test(String(err?.message || ""))) throw err;
      }
      const nextLocal = _readLocalSavedSeries().filter((item) => item.series_key !== seriesKey);
      _writeLocalSavedSeries(nextLocal);
      await _syncSavedSeriesToUiState(client, nextLocal);
      setSavedSeries((prev) => prev.filter((item) => item.series_key !== seriesKey));
      setNotice("Đã xóa Series khỏi danh mục quản lý.");
    } catch (requestError) {
      setError(requestError.message || "Không thể xóa Series đã lưu.");
    }
  };

  if (status !== "connected") {
    return <EngineGate status={status} connect={connect} check={check} title="Series" />;
  }

  return (
    <>
      <ErrorMessage error={error} retry={selected ? loadEpisodes : loadSeries} />
      <Notice>{notice}</Notice>

      {!selected && (
        <section className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-head">
            <div>
              <h2>Quản lý Series đã lưu &amp; Hàng chờ xử lý</h2>
              <p>Theo dõi tiến độ xử lý từng tập theo thứ tự từ tập 1 hoặc ngày đăng cũ nhất.</p>
            </div>
            <span className="status">{savedSeries.length} series đã lưu</span>
          </div>
          {!savedSeries.length ? (
            <div className="empty-state">
              Chưa có Series nào được lưu. Mở <Link href="/sources">Nguồn video</Link> bấm nút <strong>Series</strong> → nhập tên và bấm <strong>Lưu vào Series đã lưu</strong>, hoặc mở một Series bên dưới để lưu.
            </div>
          ) : (
          <div className="library-grid series-saved-grid">
            {savedSeries.map((item) => {
              const total = item.total_count || 0;
              const done = item.processed_count || 0;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              return (
                <article className="library-card series-saved-card" key={item.series_key}>
                  <div className="library-body">
                    <div className="card-header-row">
                      <h3 style={{ height: "auto", marginBottom: 6 }}>
                        <Icon name="folder" size={18} /> {item.name}
                      </h3>
                      <span className="status is-active">
                        Đã xử lý {done}/{total}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 6,
                        background: "rgba(255,255,255,0.08)",
                        borderRadius: 4,
                        overflow: "hidden",
                        marginBottom: 10,
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: "100%",
                          background: "#ef4444",
                          transition: "width 200ms ease",
                        }}
                      />
                    </div>
                    <div className="library-meta">
                      <span>{item.source_label || "Nguồn local"}</span>
                      <span>
                        {item.sort_mode === "oldest_first"
                          ? "Ngày đăng cũ → mới"
                          : "Từ tập 1 → cuối"}
                      </span>
                      {item.processing_count > 0 && (
                        <span>Đang chạy: {item.processing_count}</span>
                      )}
                      <span>Cấu hình: {summarizeConfig(item.config)}</span>
                    </div>
                    <div className="library-actions">
                      <button
                        className="btn primary"
                        disabled={batchRunning || item.pending_count === 0}
                        onClick={() => resumeSavedSeries(item)}
                      >
                        <Icon name="play" size={15} />
                        {item.pending_count === 0
                          ? "Đã xong hết"
                          : `Xử lý tiếp (${item.pending_count} tập)`}
                      </button>
                      <button
                        className="btn secondary"
                        onClick={() => {
                          const found = series.find((s) => s.series_key === item.series_key) || item;
                          openSeriesItem(found);
                        }}
                      >
                        Chi tiết
                      </button>
                      <button
                        className="btn secondary"
                        onClick={() => removeSavedSeries(item.series_key)}
                      >
                        Xóa
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          )}
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{selected?.name || "Series tự nhận diện"}</h2>
            <p>
              {selected
                ? `Đã xử lý ${seriesProgress.done}/${seriesProgress.total} tập${
                    seriesProgress.running ? ` · ${seriesProgress.running} đang chạy` : ""
                  }${currentSource ? ` · ${currentSource.name}` : ""}`
                : `${series.length} Series trong thư viện · nhóm có từ 2 tập.`}
            </p>
          </div>
          <div className="library-actions">
            {selected && (
              <button
                className="btn secondary"
                onClick={() => {
                  setSelected(null);
                  setVideos([]);
                  setQuery("");
                  setFilter("");
                }}
              >
                Tất cả Series
              </button>
            )}
            <button
              className="btn secondary"
              disabled={loading}
              onClick={selected ? loadEpisodes : loadSeries}
            >
              <Icon name="refresh" size={16} />
              Làm mới
            </button>
          </div>
        </div>

        <div
          className="control-bar"
          style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 18 }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Tìm Series hoặc tập"
            placeholder={selected ? "Tìm tập, tên video hoặc ID..." : "Tìm tên Series..."}
            style={{ flex: "1 1 220px" }}
          />
          <select
            aria-label="Lọc nguồn"
            value={sourceKey}
            onChange={(event) => setSourceKey(event.target.value)}
          >
            <option value="">Tất cả nguồn</option>
            {(selected?.sources || sources).map((source) => (
              <option key={source.key} value={source.key}>
                {source.name} · {source.platform}
              </option>
            ))}
          </select>
          {selected && (
            <>
              <select
                aria-label="Thứ tự tập"
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value)}
              >
                <option value="episode_asc">Thứ tự: Từ tập 1 → cuối</option>
                <option value="oldest_first">Thứ tự: Ngày đăng lâu nhất → mới nhất</option>
              </select>
              <select
                aria-label="Lọc trạng thái tập"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              >
                <option value="">Tất cả trạng thái</option>
                <option value="pending">Chưa xử lý</option>
                <option value="done">Đã xử lý</option>
                <option value="processing">Đang xử lý</option>
                <option value="downloaded">Đã tải</option>
                <option value="not-downloaded">Chưa tải</option>
                <option value="subtitle">Có Vietsub</option>
                <option value="voiceover">Có Voice</option>
              </select>
            </>
          )}
        </div>

        {selected && !loading && (
          <div
            className="panel"
            style={{
              marginBottom: 18,
              padding: "14px 16px",
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <div>
                <strong style={{ fontSize: "0.95rem" }}>
                  Cấu hình chung cho cả Series (1 cấu hình — tất cả tập làm theo)
                </strong>
                <div style={{ fontSize: "0.82rem", opacity: 0.72 }}>
                  Tiến độ: {seriesProgress.done}/{seriesProgress.total} tập đã hoàn thành
                </div>
              </div>
              <button
                type="button"
                className="btn secondary"
                disabled={saving}
                onClick={() => saveCurrentSeries()}
              >
                {saving ? "Đang lưu…" : "Lưu Series & Cấu hình"}
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 10,
              }}
            >
              <label style={{ display: "grid", gap: 4, fontSize: "0.82rem" }}>
                <span>Chế độ xử lý</span>
                <select
                  value={seriesConfig.mode}
                  onChange={(e) => setSeriesConfig((c) => ({ ...c, mode: e.target.value }))}
                >
                  <option value="both">Vietsub + Lồng tiếng</option>
                  <option value="subtitle">Chỉ Vietsub</option>
                  <option value="voice">Chỉ Lồng tiếng AI</option>
                </select>
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: "0.82rem" }}>
                <span>Nguồn phụ đề</span>
                <select
                  value={seriesConfig.transcript_source}
                  onChange={(e) =>
                    setSeriesConfig((c) => ({ ...c, transcript_source: e.target.value }))
                  }
                >
                  <option value="audio">Nghe giọng nói (Whisper)</option>
                  <option value="video_subtitles">Quét chữ trên video (OCR)</option>
                </select>
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: "0.82rem" }}>
                <span>Giọng đọc AI</span>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <select
                    value={seriesConfig.voice}
                    disabled={seriesConfig.mode === "subtitle"}
                    onChange={(e) => setSeriesConfig((c) => ({ ...c, voice: e.target.value }))}
                  >
                    {VIETNAMESE_TTS_VOICES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                  </select>
                  <button type="button" className="btn secondary" disabled={seriesConfig.mode === "subtitle"} onClick={(e) => playVoicePreview(seriesConfig.voice, { button: e.currentTarget, onError: (msg) => setError(msg) })}>🔊 Nghe thử</button>
                </div>
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: "0.82rem" }}>
                <span>Tốc độ giọng</span>
                <select
                  value={String(seriesConfig.voice_speed)}
                  disabled={seriesConfig.mode === "subtitle"}
                  onChange={(e) =>
                    setSeriesConfig((c) => ({ ...c, voice_speed: Number(e.target.value) }))
                  }
                >
                  <option value="1">1.00x (Mặc định)</option>
                  <option value="1.05">1.05x</option>
                  <option value="1.1">1.10x</option>
                  <option value="1.15">1.15x</option>
                  <option value="1.2">1.20x</option>
                </select>
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: "0.82rem" }}>
                <span>Khung hình</span>
                <select
                  value={seriesConfig.aspect_ratio}
                  onChange={(e) =>
                    setSeriesConfig((c) => ({ ...c, aspect_ratio: e.target.value }))
                  }
                >
                  <option value="auto">Giữ nguyên</option>
                  <option value="16:9">Ngang 16:9 (YouTube)</option>
                  <option value="9:16">Dọc 9:16 (Shorts/TikTok)</option>
                </select>
              </label>

              <div style={{ display: "flex", alignItems: "end" }}>
                <label className="boost-gpu-toggle" style={{ width: "100%", justifyContent: "center" }}>
                  <input
                    type="checkbox"
                    checked={Boolean(seriesConfig.boost_gpu)}
                    onChange={(e) =>
                      setSeriesConfig((c) => ({ ...c, boost_gpu: e.target.checked }))
                    }
                  />
                  <span>Boost GPU</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <Loading label={selected ? "Đang đọc danh sách tập" : "Đang đọc Series trên máy"} />
        )}

        {!loading && !selected && !visibleSeries.length && (
          <div className="empty-state">
            {series.length
              ? "Không có Series phù hợp bộ lọc."
              : "Chưa có Series. Đồng bộ video từ một nguồn để hệ thống nhận diện các tập."}
          </div>
        )}

        {!loading && !selected && visibleSeries.length > 0 && (
          <div className="library-grid">
            {visibleSeries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((item) => {
              const saved = savedSeries.find((s) => s.series_key === item.series_key);
              return (
                <article className="library-card" key={item.series_key}>
                  <div className="library-body">
                    <div className="card-header-row">
                      <h3 style={{ height: "auto", marginBottom: 10 }}>
                        <Icon name="folder" size={18} /> {item.name}
                      </h3>
                      <span className="status">
                        {saved ? `Đã xử lý ${saved.processed_count}/${saved.total_count}` : `${item.count} tập`}
                      </span>
                    </div>
                    <div className="library-meta">
                      <span>{item.source_label || "Nguồn local"}</span>
                      {item.episodes?.length > 0 && (
                        <span>
                          Tập {item.episodes[0]}–{item.episodes[item.episodes.length - 1]}
                        </span>
                      )}
                    </div>
                    <button className="btn primary" onClick={() => openSeriesItem(item)}>
                      Xem các tập &amp; Xử lý hàng loạt
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {!loading && !selected && (
          <Pager page={page} total={visibleSeries.length} pageSize={PAGE_SIZE} onChange={setPage} />
        )}

        {selected && !loading && filteredVideos.length > 0 && (
          <>
            <div className="library-actions" style={{ marginBottom: 18, flexWrap: "wrap" }}>
              <button
                className="btn secondary"
                onClick={() =>
                  setSelectedVideos(
                    selectedVideos.size === filteredVideos.length
                      ? new Set()
                      : new Set(filteredVideos.map((video) => video.video_id))
                  )
                }
              >
                {selectedVideos.size === filteredVideos.length ? "Bỏ chọn" : "Chọn tất cả"}
              </button>
              <button
                className="btn secondary"
                onClick={() => {
                  const pendingIds = filteredVideos
                    .filter((v) => !isVideoDone(v) && !v.processing)
                    .map((v) => v.video_id);
                  setSelectedVideos(new Set(pendingIds));
                  setNotice(`Đã tích chọn ${pendingIds.length} tập chưa xử lý.`);
                }}
              >
                Chọn tập chưa xử lý
              </button>
              <input
                aria-label="Khoảng tập"
                placeholder="Chọn tập, vd 4 hoặc 5-80"
                value={episodeRange}
                onChange={(event) => setEpisodeRange(event.target.value)}
                style={{ width: 175 }}
              />
              <button className="btn secondary" onClick={selectEpisodeRange}>
                Chọn khoảng tập
              </button>
              <span className="status">{selectedVideos.size} đã chọn</span>
              <button
                className="btn primary"
                disabled={batchRunning || !selectedVideos.size}
                onClick={runSelectedBatch}
              >
                <Icon name="play" size={15} />
                {batchRunning
                  ? "Đang xếp hàng chờ…"
                  : `Xử lý hàng loạt (${selectedVideos.size} tập)`}
              </button>
              <button
                className="btn secondary"
                disabled={
                  saving ||
                  !sortedLocalVideos.some(
                    (video) => selectedVideos.has(video.video_id) && !video.downloaded && video.url
                  )
                }
                onClick={downloadSelection}
              >
                <Icon name="download" size={15} />
                {saving ? "Đang thực hiện…" : "Tải các tập đã chọn"}
              </button>
              <select
                value={targetCollection}
                onChange={(event) => setTargetCollection(event.target.value)}
                aria-label="Thêm tập vào Collection"
              >
                <option value="">Chọn Collection</option>
                {collections.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <button
                className="btn secondary"
                disabled={!targetCollection || !selectedVideos.size || saving}
                onClick={addSelection}
              >
                Thêm vào Collection
              </button>
            </div>

            <div className="library-grid">
              {filteredVideos.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((video) => (
                <LibraryVideoCard
                  key={video.video_id}
                  client={client}
                  video={video}
                  selected={selectedVideos.has(video.video_id)}
                  onSelect={(id) =>
                    setSelectedVideos((previous) => {
                      const next = new Set(previous);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                  onFavorite={toggleFavorite}
                  onDownload={(item, source) => {
                    download(item, source).catch(() => {});
                  }}
                  onPreview={setPreview}
                  busy={busy.has(video.video_id)}
                  sourceFile={localFiles.sources.get(video.video_id || video.platform_video_id)}
                />
              ))}
            </div>
            <Pager
              page={page}
              total={filteredVideos.length}
              pageSize={PAGE_SIZE}
              onChange={setPage}
            />
          </>
        )}

        {selected && !loading && !filteredVideos.length && (
          <div className="empty-state">Không có tập phù hợp bộ lọc hiện tại.</div>
        )}
      </section>

      {preview && (
        <PreviewDialog
          client={client}
          item={preview}
          onClose={() => setPreview(null)}
          onError={setError}
        />
      )}
    </>
  );
}
