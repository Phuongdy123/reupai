"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "./icon";
import { useEngine } from "./engine-provider";
import { EngineGate, ErrorMessage, LibraryVideoCard, Loading, Notice, Pager, PreviewDialog, addVideosToCollection, createLocalFileIndex, sourcePath, videoBody, withLocalFiles } from "./library-ui";

const PAGE_SIZE = 12;
function fromSource(video, source) {
  if (!source) return true;
  if (source.source_id != null) return String(video.source_id || "") === String(source.source_id);
  const name = video.source_name || video.channel_name || video.platform || "Nguồn không tên";
  return name === source.name && (video.platform || "") === source.platform;
}
export function SeriesPage() {
  const { status, client, connect, check } = useEngine();
  const [series, setSeries] = useState([]);
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
  const [preview, setPreview] = useState(null);
  const sources = useMemo(() => [...new Map(series.flatMap((item) => item.sources || []).map((source) => [source.key, source])).values()], [series]);
  const currentSource = sources.find((item) => item.key === sourceKey);
  const loadSeries = useCallback(async () => {
    if (status !== "connected") return;
    setLoading(true); setError(null);
    try {
      const [result, files, rendered, groups] = await Promise.all([client.json("/api/library/series"), client.json("/api/library/downloads"), client.json("/api/library/outputs"), client.json("/api/library/collections")]);
      setSeries(result.series || []); setDownloads(files.videos || []); setOutputs(rendered.outputs || []); setCollections(groups.collections || []);
    } catch (requestError) { setError(requestError.message || "Không thể tải Series."); }
    finally { setLoading(false); }
  }, [client, status]);
  useEffect(() => { loadSeries(); }, [loadSeries]);
  const loadEpisodes = useCallback(async () => {
    if (status !== "connected" || !selected) return;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ series: selected.series_key, limit: "2000" });
      if (currentSource?.source_id != null) params.set("source_id", currentSource.source_id);
      const [data, files, rendered] = await Promise.all([client.json(`/api/library/videos?${params}`), client.json("/api/library/downloads"), client.json("/api/library/outputs")]);
      setDownloads(files.videos || []); setOutputs(rendered.outputs || []);
      setVideos((data.videos || []).filter((video) => fromSource(video, currentSource)));
    } catch (requestError) { setError(requestError.message || "Không thể tải danh sách tập."); }
    finally { setLoading(false); }
  }, [client, currentSource, selected, status]);
  useEffect(() => { loadEpisodes(); }, [loadEpisodes]);
  useEffect(() => { setPage(1); setSelectedVideos(new Set()); }, [query, filter, sourceKey, selected]);
  const visibleSeries = useMemo(() => series.filter((item) => (!sourceKey || (item.sources || []).some((source) => source.key === sourceKey)) && (!query.trim() || `${item.name} ${item.source_label}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))), [series, sourceKey, query]);
  const localFiles = useMemo(() => createLocalFileIndex(downloads, outputs), [downloads, outputs]);
  const localVideos = useMemo(() => videos.map((video) => withLocalFiles(video, localFiles)), [videos, localFiles]);
  const filteredVideos = useMemo(() => localVideos.filter((video) => (!query.trim() || `${video.title} ${video.video_id} ${video.episode_number || ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && (!filter || (filter === "downloaded" ? video.downloaded : filter === "not-downloaded" ? !video.downloaded : filter === "subtitle" ? video.has_subtitle_result : filter === "voiceover" ? video.has_voice_result : video.processing))), [localVideos, query, filter]);
  const setBusyId = (id, value) => setBusy((previous) => { const next = new Set(previous); if (value) next.add(id); else next.delete(id); return next; });
  const toggleFavorite = async (video) => {
    setBusyId(video.video_id, true); setError(null);
    try { const result = await client.json("/api/library/favorites/toggle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(videoBody(video)) }); setVideos((previous) => previous.map((item) => item.video_id === video.video_id ? { ...item, favorite: result.favorite } : item)); }
    catch (requestError) { setError(requestError.message || "Không thể cập nhật yêu thích."); }
    finally { setBusyId(video.video_id, false); }
  };
  const download = async (video, sourceFile) => {
    setBusyId(video.video_id, true); setError(null);
    try {
      if (sourceFile) await client.downloadFile(sourcePath(sourceFile), `${video.video_id}-source.mp4`);
      else {
        const response = await client.request("/api/download?local_only=true", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ video_id: video.video_id, url: video.url }) });
        if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.detail || `Không thể tải video (HTTP ${response.status}).`); }
        try { await response.body?.cancel(); } catch (_) { /* The source is already stored by the Local Engine. */ }
        const files = await client.json("/api/library/downloads"); setDownloads(files.videos || []); await loadEpisodes(); setNotice("Đã tải video về máy.");
      }
    } catch (requestError) { setError(requestError.message || "Không thể tải video."); throw requestError; }
    finally { setBusyId(video.video_id, false); }
  };
  const downloadSelection = async () => {
    setSaving(true);
    try { for (const video of localVideos.filter((item) => selectedVideos.has(item.video_id) && !item.downloaded && item.url)) await download(video, null); setNotice("Đã tải các tập được chọn về máy."); }
    catch (_) { /* The failed request is displayed by download; remaining downloads stop. */ }
    finally { setSaving(false); }
  };
  const addSelection = async () => {
    if (!targetCollection) return;
    setSaving(true); setError(null);
    try {
      const selectedItems = videos.filter((item) => selectedVideos.has(item.video_id));
      await addVideosToCollection(client, targetCollection, selectedItems);
      setNotice("Đã thêm các tập vào Collection."); setSelectedVideos(new Set());
    } catch (requestError) { setError(requestError.message || "Không thể thêm tập vào Collection."); }
    finally { setSaving(false); }
  };
  if (status !== "connected") return <EngineGate status={status} connect={connect} check={check} title="Series" />;
  return <>
    <ErrorMessage error={error} retry={selected ? loadEpisodes : loadSeries} /><Notice>{notice}</Notice>
    <section className="panel"><div className="panel-head"><div><h2>{selected?.name || "Series tự nhận diện"}</h2><p>{selected ? `${videos.length} tập${currentSource ? ` · ${currentSource.name}` : ""}` : `${series.length} Series trong thư viện · nhóm có từ 2 tập.`}</p></div><div className="library-actions">{selected && <button className="btn secondary" onClick={() => { setSelected(null); setVideos([]); setQuery(""); setFilter(""); }}>Tất cả Series</button>}<button className="btn secondary" disabled={loading} onClick={selected ? loadEpisodes : loadSeries}><Icon name="refresh" size={16} />Làm mới</button></div></div>
      <div className="control-bar" style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 18 }}><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Tìm Series hoặc tập" placeholder={selected ? "Tìm tập, tên video hoặc ID..." : "Tìm tên Series..."} style={{ flex: "1 1 220px" }} /><select aria-label="Lọc nguồn" value={sourceKey} onChange={(event) => setSourceKey(event.target.value)}><option value="">Tất cả nguồn</option>{(selected?.sources || sources).map((source) => <option key={source.key} value={source.key}>{source.name} · {source.platform}</option>)}</select>{selected && <select aria-label="Lọc trạng thái tập" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">Tất cả trạng thái</option><option value="downloaded">Đã tải</option><option value="not-downloaded">Chưa tải</option><option value="subtitle">Có Vietsub</option><option value="voiceover">Có Voice</option><option value="processing">Đang xử lý</option></select>}</div>
      {loading && <Loading label={selected ? "Đang đọc danh sách tập" : "Đang đọc Series trên máy"} />}
      {!loading && !selected && !visibleSeries.length && <div className="empty-state">{series.length ? "Không có Series phù hợp bộ lọc." : "Chưa có Series. Đồng bộ video từ một nguồn để hệ thống nhận diện các tập."}</div>}
      {!loading && !selected && visibleSeries.length > 0 && <div className="library-grid">{visibleSeries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((item) => <article className="library-card" key={item.series_key}><div className="library-body"><div className="card-header-row"><h3 style={{ height: "auto", marginBottom: 10 }}><Icon name="folder" size={18} /> {item.name}</h3><span className="status">{item.count} tập</span></div><div className="library-meta"><span>{item.source_label || "Nguồn local"}</span>{item.episodes?.length > 0 && <span>Tập {item.episodes[0]}–{item.episodes[item.episodes.length - 1]}</span>}</div><button className="btn primary" onClick={() => { setSelected(item); setVideos([]); setQuery(""); }}>Xem các tập</button></div></article>)}</div>}
      {!loading && !selected && <Pager page={page} total={visibleSeries.length} pageSize={PAGE_SIZE} onChange={setPage} />}
      {selected && !loading && filteredVideos.length > 0 && <><div className="library-actions" style={{ marginBottom: 18 }}><button className="btn secondary" onClick={() => setSelectedVideos(selectedVideos.size === filteredVideos.length ? new Set() : new Set(filteredVideos.map((video) => video.video_id)))}>{selectedVideos.size === filteredVideos.length ? "Bỏ chọn" : "Chọn tất cả"}</button><span className="status">{selectedVideos.size} đã chọn</span><button className="btn primary" disabled={saving || !localVideos.some((video) => selectedVideos.has(video.video_id) && !video.downloaded && video.url)} onClick={downloadSelection}><Icon name="download" size={15} />{saving ? "Đang thực hiện…" : "Tải các tập đã chọn"}</button><select value={targetCollection} onChange={(event) => setTargetCollection(event.target.value)} aria-label="Thêm tập vào Collection"><option value="">Chọn Collection</option>{collections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="btn secondary" disabled={!targetCollection || !selectedVideos.size || saving} onClick={addSelection}>Thêm vào Collection</button></div><div className="library-grid">{filteredVideos.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((video) => <LibraryVideoCard key={video.video_id} client={client} video={video} selected={selectedVideos.has(video.video_id)} onSelect={(id) => setSelectedVideos((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onFavorite={toggleFavorite} onDownload={(item, source) => { download(item, source).catch(() => {}); }} onPreview={setPreview} busy={busy.has(video.video_id)} sourceFile={localFiles.sources.get(video.video_id || video.platform_video_id)} />)}</div><Pager page={page} total={filteredVideos.length} pageSize={PAGE_SIZE} onChange={setPage} /></>}
      {selected && !loading && !filteredVideos.length && <div className="empty-state">Không có tập phù hợp bộ lọc hiện tại.</div>}
    </section>
    {preview && <PreviewDialog client={client} item={preview} onClose={() => setPreview(null)} onError={setError} />}
  </>;
}
