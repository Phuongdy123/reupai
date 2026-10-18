"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const title = kind === "favorites" ? "Video yêu thích" : kind === "collections" ? "Collections" : "Lịch sử job";

  useEffect(() => { selectedCollectionRef.current = selectedCollection; }, [selectedCollection]);
  const load = useCallback(async (collectionId = undefined, { silent = false } = {}) => {
    if (status !== "connected") return;
    if (!silent) { setLoading(true); setError(null); }
    try {
      if (kind === "history") {
        const data = await client.json("/api/library/history?limit=200", { cache: "no-store" });
        setItems(data.history || []);
      } else {
        const [listData, downloaded, rendered] = await Promise.all([client.json("/api/library/collections"), client.json("/api/library/downloads"), client.json("/api/library/outputs")]);
        const list = listData.collections || [];
        setCollections(list); setDownloads(downloaded.videos || []); setOutputs(rendered.outputs || []);
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
    try { await client.json(`/api/jobs/${encodeURIComponent(id)}/stop?${new URLSearchParams({ channel: job.channel_key || "2d_animation", mode: job.mode || "subtitle" })}`, { method: "POST" }); await load(); }
    catch (requestError) { setError(requestError.message || "Không thể dừng job."); }
    finally { setBusyId(id, false); }
  };
  if (status !== "connected") return <EngineGate status={status} connect={connect} check={check} title={title} />;
  const activeCollection = collections.find((item) => String(item.id) === selectedCollection);
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return <>
    <ErrorMessage error={error} retry={() => load()} /><Notice>{notice}</Notice>
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
