"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "./icon";
import { useEngine } from "./engine-provider";
import { EngineGate, ErrorMessage, HistoryTable, LibraryVideoCard, Loading, Notice, Pager, PreviewDialog, addVideosToCollection, createLocalFileIndex, jobVideoId, sourcePath, videoBody, withLocalFiles } from "./library-ui";

const PAGE_SIZE = 12;
export function LibraryPage({ kind }) {
  const { status, client, connect, check } = useEngine();
  const [items, setItems] = useState([]);
  const [collections, setCollections] = useState([]);
  const [downloads, setDownloads] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState("");
  const selectedCollectionRef = useRef("");
  const [newName, setNewName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());
  const [targetCollection, setTargetCollection] = useState("");
  const [busy, setBusy] = useState(new Set());
  const [preview, setPreview] = useState(null);
  const [picker, setPicker] = useState(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerSelected, setPickerSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [savedSeries, setSavedSeries] = useState([]);
  const [seriesBusy, setSeriesBusy] = useState(false);
  const title = kind === "favorites" ? "Video yêu thích" : kind === "collections" ? "Collections & Tiến độ Series" : "Lịch sử job";

  useEffect(() => { selectedCollectionRef.current = selectedCollection; }, [selectedCollection]);
  const load = useCallback(async (collectionId = undefined, { silent = false } = {}) => {
    if (status !== "connected") return;
    if (!silent) { setLoading(true); setError(null); }
    try {
      if (kind === "history") {
        const data = await client.json("/api/library/history?limit=200", { cache: "no-store" });
        setItems(data.history || []);
      } else {
        const [listData, downloaded, rendered, savedSeriesRes, uiSavedRes] = await Promise.all([
          client.json("/api/library/collections"),
          client.json("/api/library/downloads"),
          client.json("/api/library/outputs"),
          kind === "collections" ? client.json("/api/library/series/saved").catch(() => ({ series: [] })) : Promise.resolve({ series: [] }),
          kind === "collections" ? client.json("/api/library/ui-state/saved_series_v1").catch(() => ({ value: { series: [] } })) : Promise.resolve({ value: { series: [] } }),
        ]);
        const list = listData.collections || [];
        setCollections(list); setDownloads(downloaded.videos || []); setOutputs(rendered.outputs || []);
        if (kind === "collections") {
          const byKey = new Map();
          const mergeItem = (item, fromServer = false) => {
            if (!item?.series_key) return;
            const prev = byKey.get(item.series_key) || {};
            const total = fromServer ? (item.total_count ?? (item.video_ids?.length || 0)) : Math.max(Number(item.total_count ?? (item.video_ids?.length || 0)), Number(prev.total_count || 0));
            byKey.set(item.series_key, {
              ...prev,
              ...item,
              total_count: total,
              processed_count: item.processed_count ?? prev.processed_count ?? 0,
              pending_count: item.pending_count ?? prev.pending_count ?? total,
              processing_count: item.processing_count ?? prev.processing_count ?? 0,
            });
          };
          try {
            const localRaw = JSON.parse(window.localStorage.getItem("reupai:saved-series-v1") || "[]");
            for (const item of (Array.isArray(localRaw) ? localRaw : [])) mergeItem(item, false);
          } catch {}
          for (const item of (uiSavedRes?.value?.series || [])) mergeItem(item, false);
          for (const item of (savedSeriesRes.series || [])) mergeItem(item, true);
          setSavedSeries(Array.from(byKey.values()));
        }
        if (kind === "collections") {
          const requestedId = collectionId === undefined ? selectedCollectionRef.current : collectionId;
          const activeId = list.some((item) => String(item.id) === String(requestedId)) ? String(requestedId) : list[0] ? String(list[0].id) : "";
          setSelectedCollection(activeId);
          if (!activeId) { setItems([]); return; }
          const result = await client.json(`/api/library/videos?collection_id=${encodeURIComponent(activeId)}&limit=2000`);
          setItems(result.videos || []);
        } else {
          const result = await client.json("/api/library/favorites?limit=2000");
          setItems(result.videos || []);
        }
      }
    } catch (requestError) { setError(requestError.message || "Không thể tải dữ liệu local."); }
    finally { if (!silent) setLoading(false); }
  }, [client, kind, status]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); setSelected(new Set()); }, [kind, selectedCollection, query, filter]);
  useEffect(() => {
    if (kind !== "history" || status !== "connected") return undefined;
    const refresh = () => { if (document.visibilityState === "visible") load(undefined, { silent: true }); };
    const timer = window.setInterval(refresh, 10000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [kind, load, status]);
  const localFiles = useMemo(() => createLocalFileIndex(downloads, outputs), [downloads, outputs]);
  const localItems = useMemo(() => kind === "history" ? items : items.map((video) => withLocalFiles(video, localFiles)), [items, localFiles, kind]);
  const filtered = useMemo(() => localItems.filter((item) => {
    const text = `${item.title || ""} ${item.video_id || item.platform_video_id || ""} ${item.source_name || item.channel_key || ""}`.toLocaleLowerCase();
    if (query.trim() && !text.includes(query.trim().toLocaleLowerCase())) return false;
    if (!filter) return true;
    if (kind === "history") return item.status === filter;
    return filter === "downloaded" ? item.downloaded : filter === "not-downloaded" ? !item.downloaded : filter === "subtitle" ? item.has_subtitle_result : filter === "voiceover" ? item.has_voice_result : item.processing;
  }), [localItems, query, filter, kind]);
  const setBusyId = (id, value) => setBusy((previous) => { const next = new Set(previous); if (value) next.add(id); else next.delete(id); return next; });
  const toggleSelection = (id) => setSelected((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const createCollection = async (event) => {
    event.preventDefault();
    if (!newName.trim()) return;
    setSaving(true); setError(null);
    try {
      const result = await client.json("/api/library/collections", { method: "POST", body: JSON.stringify({ name: newName.trim(), description: description.trim() }), headers: { "Content-Type": "application/json" } });
      setNewName(""); setDescription(""); setNotice("Đã tạo Collection trên máy.");
      await load(String(result.collection.id));
    } catch (requestError) { setError(requestError.message || "Không thể tạo Collection."); }
    finally { setSaving(false); }
  };
  const deleteCollection = async () => {
    const item = collections.find((value) => String(value.id) === selectedCollection);
    if (!item || !window.confirm(`Xóa Collection “${item.name}”? Video trên máy sẽ được giữ lại.`)) return;
    setSaving(true); setError(null);
    try { await client.json(`/api/library/collections/${selectedCollection}`, { method: "DELETE" }); setNotice("Đã xóa Collection."); await load(""); }
    catch (requestError) { setError(requestError.message || "Không thể xóa Collection."); }
    finally { setSaving(false); }
  };
  const toggleFavorite = async (video) => {
    setBusyId(video.video_id, true); setError(null);
    try { const result = await client.json("/api/library/favorites/toggle", { method: "POST", body: JSON.stringify(videoBody(video)), headers: { "Content-Type": "application/json" } }); setNotice(result.favorite ? "Đã thêm vào yêu thích." : "Đã bỏ yêu thích."); await load(); }
    catch (requestError) { setError(requestError.message || "Không thể cập nhật yêu thích."); }
    finally { setBusyId(video.video_id, false); }
  };
  const removeVideo = async (video) => {
    setBusyId(video.video_id, true); setError(null);
    try { await client.json(`/api/library/collections/${selectedCollection}/videos/${encodeURIComponent(video.video_id)}`, { method: "DELETE" }); setNotice("Đã bỏ video khỏi Collection."); await load(); }
    catch (requestError) { setError(requestError.message || "Không thể bỏ video khỏi Collection."); }
    finally { setBusyId(video.video_id, false); }
  };
  const addVideos = async (list, collectionId) => {
    if (!collectionId || !list.length) return;
    setSaving(true); setError(null);
    try {
      await addVideosToCollection(client, collectionId, list);
      setNotice(`Đã thêm ${list.length} video vào Collection.`); setPicker(null); setPickerSelected(new Set()); setSelected(new Set()); await load();
    } catch (requestError) { setError(requestError.message || "Không thể thêm video vào Collection."); }
    finally { setSaving(false); }
  };
  const openPicker = async () => {
    setSaving(true); setError(null); setPickerQuery(""); setPickerSelected(new Set());
    try { const result = await client.json("/api/library/videos?limit=2000"); const existingIds = new Set(items.map((item) => item.video_id)); setPicker((result.videos || []).filter((video) => !existingIds.has(video.video_id))); }
    catch (requestError) { setError(requestError.message || "Không thể đọc danh sách video."); }
    finally { setSaving(false); }
  };
  const download = async (video, sourceFile) => {
    setBusyId(video.video_id, true); setError(null);
    try {
      if (sourceFile) await client.downloadFile(sourcePath(sourceFile), `${video.video_id}-source.mp4`);
      else {
        const response = await client.request("/api/download?local_only=true", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ video_id: video.video_id, url: video.url }) });
        if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.detail || `Không thể tải video (HTTP ${response.status}).`); }
        try { await response.body?.cancel(); } catch (_) { /* The source is already stored by the Local Engine. */ }
        setNotice("Đã tải video về máy."); await load();
      }
    } catch (requestError) { setError(requestError.message || "Không thể tải video."); }
    finally { setBusyId(video.video_id, false); }
  };
  const stopJob = async (job) => {
    const id = jobVideoId(job); setBusyId(id, true); setError(null);
    try { await client.json(`/api/jobs/${encodeURIComponent(id)}/stop?${new URLSearchParams({ channel: job.channel_key || "default", mode: job.mode || "subtitle" })}`, { method: "POST" }); await load(); }
    catch (requestError) { setError(requestError.message || "Không thể dừng job."); }
    finally { setBusyId(id, false); }
  };
  useEffect(() => {
    if (kind !== "collections" || status !== "connected") return undefined;
    if (!savedSeries.some((item) => (item.processing_count || 0) > 0)) return undefined;
    const timer = setInterval(() => { load(undefined, { silent: true }); }, 5000);
    return () => clearInterval(timer);
  }, [kind, status, savedSeries, load]);

  const resumeSavedSeries = async (item) => {
    setSeriesBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ series: item.series_key, limit: "2000" });
      const data = await client.json(`/api/library/videos?${params}`);
      let rawVideos = data.videos || [];
      if (!rawVideos.length && Array.isArray(item.video_ids) && item.video_ids.length) {
        const allData = await client.json("/api/library/videos?limit=2000");
        const idSet = new Set(item.video_ids.map(String));
        rawVideos = (allData.videos || []).filter((v) => idSet.has(String(v.video_id)));
      }
      const list = [...rawVideos].sort((a, b) => {
        if (item.sort_mode === "oldest_first") {
          const pa = String(a.published_at || "9999-99-99");
          const pb = String(b.published_at || "9999-99-99");
          if (pa !== pb) return pa.localeCompare(pb);
        }
        const ea = a.episode_number != null ? Number(a.episode_number) : 999999;
        const eb = b.episode_number != null ? Number(b.episode_number) : 999999;
        return ea - eb;
      });
      const remaining = list.filter((v) => !v.has_subtitle_result && !v.has_voice_result && !(v.output_files || []).length && !v.processing);
      if (!remaining.length) {
        setNotice(`Series "${item.name}" đã xử lý xong toàn bộ (${item.processed_count}/${item.total_count}).`);
        return;
      }
      const cfg = item.config || {};
      const apiMode = cfg.mode === "subtitle" ? "subtitle" : "voiceover";
      const aspectRatio = cfg.aspect_ratio && cfg.aspect_ratio !== "auto" ? cfg.aspect_ratio : null;
      let queued = 0;
      for (const video of remaining) {
        try {
          await client.json("/api/process", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              video_id: video.video_id,
              channel: video.channel_key || "default",
              url: video.url || "",
              mode: apiMode,
              voice: cfg.voice || "Trúc Ly",
              tts_speed: Number(cfg.voice_speed || 1.0),
              source_language: cfg.source_lang || "auto",
              transcript_source: cfg.transcript_source || "audio",
              aspect_ratio: aspectRatio,
              boost_gpu: Boolean(cfg.boost_gpu),
              ocr_use_gpu: Boolean(cfg.boost_gpu),
              ocr_parallelism: cfg.boost_gpu ? 4 : 2,
              stability_mode: true,
            }),
          });
          queued += 1;
        } catch {
          // ignore already running
        }
      }
      await load(undefined, { silent: true });
      setNotice(`Đã đẩy ${queued} tập còn lại của "${item.name}" vào hàng chờ.`);
    } catch (requestError) {
      setError(requestError.message || "Không thể xử lý tiếp Series.");
    } finally {
      setSeriesBusy(false);
    }
  };

  const deleteSavedSeriesItem = async (seriesKey) => {
    setError(null);
    try {
      try {
        await client.json(`/api/library/series/saved/${encodeURIComponent(seriesKey)}`, { method: "DELETE" });
      } catch (err) {
        if (!/not found|404/i.test(String(err?.message || ""))) throw err;
      }
      let nextLocal = [];
      try {
        const localRaw = JSON.parse(window.localStorage.getItem("reupai:saved-series-v1") || "[]");
        if (Array.isArray(localRaw)) {
          nextLocal = localRaw.filter((item) => item?.series_key !== seriesKey);
          window.localStorage.setItem("reupai:saved-series-v1", JSON.stringify(nextLocal));
        }
      } catch {}
      try {
        await client.json("/api/library/ui-state/saved_series_v1", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: { series: nextLocal } }),
        });
      } catch {}
      setSavedSeries((prev) => prev.filter((item) => item.series_key !== seriesKey));
      setNotice("Đã xóa Series khỏi danh mục tiến độ.");
    } catch (requestError) {
      setError(requestError.message || "Không thể xóa Series.");
    }
  };

  if (status !== "connected") return <EngineGate status={status} connect={connect} check={check} title={title} />;
  const activeCollection = collections.find((item) => String(item.id) === selectedCollection);
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return <>
    {kind === "collections" && (
      <div className="panel" style={{ marginBottom: 16, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/series" className="btn secondary">Bộ Series đã lưu</Link>
          <Link href="/collections" className="btn primary">Kênh nguồn &amp; Danh mục</Link>
        </div>
        <small className="muted">Series quản lý bộ tập theo thứ tự · Collections quản lý kênh nguồn &amp; nhóm video</small>
      </div>
    )}
    <ErrorMessage error={error} retry={() => load()} /><Notice>{notice}</Notice>
    {kind === "collections" && (
      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-head">
          <div>
            <h2>Series đã lưu &amp; Tiến độ xử lý</h2>
            <p>Theo dõi số tập đã hoàn thành (vd 3/7), hàng chờ và xử lý tiếp các tập còn lại.</p>
          </div>
          <Link className="btn secondary" href="/series">Mở trang Series</Link>
        </div>
        {!savedSeries.length ? (
          <div className="empty-state">
            Chưa có Series nào được lưu. Vào <Link href="/series">Series</Link> chọn tập &amp; cấu hình rồi bấm <strong>Lưu Series</strong> hoặc <strong>Xử lý hàng loạt</strong> để theo dõi tiến độ tại đây.
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
                      <h3 style={{ height: "auto", marginBottom: 6 }}><Icon name="folder" size={18} /> {item.name}</h3>
                      <span className="status is-active">Đã xử lý {done}/{total}</span>
                    </div>
                    <div style={{ height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 4, overflow: "hidden", marginBottom: 10 }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: "#ef4444", transition: "width 200ms ease" }} />
                    </div>
                    <div className="library-meta">
                      <span>{item.source_label || "Nguồn local"}</span>
                      <span>{item.sort_mode === "oldest_first" ? "Ngày đăng cũ → mới" : "Từ tập 1 → cuối"}</span>
                      {item.processing_count > 0 && <span>Đang chạy: {item.processing_count}</span>}
                    </div>
                    <div className="library-actions">
                      <button className="btn primary" disabled={seriesBusy || item.pending_count === 0} onClick={() => resumeSavedSeries(item)}>
                        <Icon name="play" size={15} />
                        {item.pending_count === 0 ? "Đã xong hết" : `Xử lý tiếp (${item.pending_count} tập)`}
                      </button>
                      <Link className="btn secondary" href="/series">Chi tiết</Link>
                      <button className="btn secondary" onClick={() => deleteSavedSeriesItem(item.series_key)}>Xóa</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    )}
    {kind === "collections" && <section className="panel"><div className="panel-head"><div><h2>Collections</h2><p>Tạo và quản lý các nhóm video trên máy.</p></div></div><form className="control-bar" onSubmit={createCollection} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><input aria-label="Tên Collection mới" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Tên Collection mới" required style={{ flex: "1 1 180px" }} /><input aria-label="Mô tả Collection" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Mô tả (không bắt buộc)" style={{ flex: "1 1 180px" }} /><button className="btn primary" disabled={saving} type="submit">Tạo Collection</button></form><div className="control-bar" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}><select aria-label="Chọn Collection" value={selectedCollection} onChange={(event) => { const value = event.target.value; setSelectedCollection(value); load(value); }} style={{ flex: 1 }}><option value="">Chọn Collection</option>{collections.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.video_count || 0} video</option>)}</select><button className="btn secondary" disabled={!selectedCollection || saving} onClick={openPicker}>Thêm video</button><button className="btn danger" disabled={!selectedCollection || saving} onClick={deleteCollection}>Xóa Collection</button></div></section>}
    <section className="panel"><div className="panel-head"><div><h2>{kind === "collections" ? activeCollection?.name || "Video trong Collection" : title}</h2><p>{kind === "history" ? "Tối đa 200 job gần nhất trong SQLite." : `${items.length} video${activeCollection?.description ? ` · ${activeCollection.description}` : ""}`}</p></div><button className="btn secondary" disabled={loading} onClick={() => load()}><Icon name="refresh" size={16} />Làm mới</button></div>
      <div className="control-bar" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm video, ID hoặc tên nguồn..." aria-label="Tìm trong thư viện" style={{ flex: "1 1 220px" }} /><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Lọc trạng thái"><option value="">Tất cả trạng thái</option>{kind === "history" ? <><option value="completed">Hoàn tất</option><option value="failed">Lỗi</option><option value="interrupted">Bị gián đoạn</option><option value="cancelled">Đã dừng</option><option value="queued">Đang chờ</option><option value="processing">Đang xử lý</option></> : <><option value="downloaded">Đã tải</option><option value="not-downloaded">Chưa tải</option><option value="subtitle">Có Vietsub</option><option value="voiceover">Có Voice</option><option value="processing">Đang xử lý</option></>}</select></div>
      {kind !== "history" && filtered.length > 0 && <div className="library-actions" style={{ marginBottom: 18 }}><button className="btn secondary" onClick={() => setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((item) => item.video_id)))}>{selected.size === filtered.length ? "Bỏ chọn" : "Chọn tất cả"}</button><span className="status">{selected.size} đã chọn</span><select value={targetCollection} onChange={(event) => setTargetCollection(event.target.value)} aria-label="Collection để thêm video"><option value="">Thêm vào Collection</option>{collections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="btn secondary" disabled={!targetCollection || !selected.size || saving} onClick={() => addVideos(items.filter((item) => selected.has(item.video_id)), targetCollection)}>Thêm đã chọn</button></div>}
      {loading && <Loading />}
      {!loading && !filtered.length && <div className="empty-state">{items.length ? "Không có dữ liệu phù hợp bộ lọc." : kind === "favorites" ? "Chưa có video yêu thích. Đánh dấu trái tim ở Nguồn video để lưu vào đây." : kind === "history" ? "Chưa có job nào trong bảng jobs." : "Collection chưa có video. Bấm “Thêm video” để chọn từ thư viện."}</div>}
      {!loading && filtered.length > 0 && (kind === "history" ? <HistoryTable items={filtered} onStop={stopJob} stopping={[...busy][0]} /> : <div className="library-grid">{visible.map((video) => <LibraryVideoCard key={video.video_id} client={client} video={video} selected={selected.has(video.video_id)} onSelect={toggleSelection} onFavorite={toggleFavorite} onDownload={download} onPreview={setPreview} onRemove={kind === "collections" ? removeVideo : null} busy={busy.has(video.video_id)} sourceFile={localFiles.sources.get(video.video_id || video.platform_video_id)} />)}</div>)}
      {!loading && kind !== "history" && <Pager page={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />}
    </section>
    {picker && <div className="modal open" onClick={(event) => { if (event.target === event.currentTarget && !saving) setPicker(null); }}><section className="modal-box" role="dialog" aria-modal="true" aria-label="Thêm video vào Collection"><div className="modal-head"><strong>Thêm video vào {activeCollection?.name}</strong><button className="btn secondary" disabled={saving} onClick={() => setPicker(null)}>×</button></div><div className="library-body"><input value={pickerQuery} onChange={(event) => setPickerQuery(event.target.value)} placeholder="Tìm tên hoặc ID video" aria-label="Tìm video để thêm" /><div className="table-wrap" style={{ maxHeight: "50vh", overflow: "auto", marginBlock: 14 }}>{picker.length ? <table><thead><tr><th>Chọn</th><th>Video</th><th>ID</th></tr></thead><tbody>{picker.filter((video) => `${video.title} ${video.video_id}`.toLocaleLowerCase().includes(pickerQuery.toLocaleLowerCase())).map((video) => <tr key={video.video_id}><td><input type="checkbox" aria-label={`Thêm ${video.title || video.video_id}`} checked={pickerSelected.has(video.video_id)} onChange={() => setPickerSelected((previous) => { const next = new Set(previous); if (next.has(video.video_id)) next.delete(video.video_id); else next.add(video.video_id); return next; })} /></td><td>{video.title || video.video_id}</td><td>{video.video_id}</td></tr>)}</tbody></table> : <div className="empty-state">Chưa có video khác để thêm. Đồng bộ video từ Nguồn video trước.</div>}</div><button className="btn primary" disabled={!pickerSelected.size || saving} onClick={() => addVideos(picker.filter((video) => pickerSelected.has(video.video_id)), selectedCollection)}>{saving ? "Đang thêm…" : `Thêm ${pickerSelected.size} video`}</button></div></section></div>}
    {preview && <PreviewDialog client={client} item={preview} onClose={() => setPreview(null)} onError={setError} />}
  </>;
}
