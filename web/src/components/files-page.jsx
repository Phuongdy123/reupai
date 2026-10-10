"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "./icon";
import { useEngine } from "./engine-provider";
import { EngineGate, ErrorMessage, Loading, Notice, Pager, PreviewDialog, VideoCover, dateText, outputPath, sourceHref, sourcePath } from "./library-ui";

const PAGE_SIZE = 12;
export function FilesPage({ kind }) {
  const { status, client, connect, check } = useEngine();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("");
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(null);
  const isOutputs = kind === "outputs";
  const title = isOutputs ? "Thành phẩm" : "Video đã tải";
  const load = useCallback(async () => {
    if (status !== "connected") return;
    setLoading(true); setError(null);
    try { const data = await client.json(isOutputs ? "/api/library/outputs" : "/api/library/downloads", { cache: "no-store" }); setItems(isOutputs ? data.outputs || [] : data.videos || []); }
    catch (requestError) { setError(requestError.message || `Không thể tải ${title.toLowerCase()}.`); }
    finally { setLoading(false); }
  }, [client, isOutputs, status, title]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [mode, query]);
  const filtered = useMemo(() => items.filter((item) => (!mode || item.mode === mode) && (!query.trim() || `${item.title || ""} ${item.video_id || ""} ${item.channel || ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))), [items, mode, query]);
  const normalized = (item) => ({ ...item, file_path: isOutputs ? outputPath(item) : sourcePath(item), mode_label: isOutputs ? item.mode_label : "Video gốc" });
  const download = async (item) => {
    const value = normalized(item);
    if (!value.file_path) { setError("Không tìm thấy đường dẫn file video. Làm mới thư viện rồi thử lại."); return; }
    setBusy(`${item.video_id}-${item.mode || "source"}`); setError(null);
    try { await client.downloadFile(value.file_path, `${item.video_id}-${item.mode || "source"}.mp4`); setNotice("Đã gửi file tới trình duyệt để tải về."); }
    catch (requestError) { setError(requestError.message || "Không thể tải file local."); }
    finally { setBusy(null); }
  };
  const openPreview = (item) => { const value = normalized(item); if (!value.file_path) setError("Không tìm thấy file local để xem trước."); else setPreview(value); };
  if (status !== "connected") return <EngineGate status={status} connect={connect} check={check} title={title} />;
  return <>
    <ErrorMessage error={error} retry={load} /><Notice>{notice}</Notice>
    <section className="panel"><div className="panel-head"><div><h2>{isOutputs ? "Thành phẩm" : "Thư viện video đã tải"}</h2><p>{items.length} {isOutputs ? "file final hiện có." : "video nguồn đang có trên máy."}</p></div><div className="library-actions"><button className="btn secondary" onClick={load} disabled={loading}><Icon name="refresh" size={16} />Làm mới</button>{!isOutputs && <Link className="btn primary" href="/sources">Lấy thêm video</Link>}</div></div>
      <div className="control-bar" style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 20 }}><input aria-label={`Tìm ${title.toLowerCase()}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm theo tên hoặc ID video..." style={{ flex: "1 1 220px" }} />{isOutputs && <select aria-label="Lọc chế độ" value={mode} onChange={(event) => setMode(event.target.value)}><option value="">Tất cả thành phẩm</option><option value="subtitle">Vietsub</option><option value="voiceover">Vietsub + Voice</option></select>}</div>
      {loading && <Loading label="Đang đọc thư viện trên máy" />}
      {!loading && !items.length && <div className="empty-state">{isOutputs ? <>Chưa tìm thấy thành phẩm. Chạy Vietsub hoặc Voice từ <Link className="text-link" href="/sources">Nguồn video</Link> để tạo video hoàn tất.</> : <>Chưa có video tải về. Vào <Link className="text-link" href="/sources">Nguồn video</Link> để tải video đầu tiên.</>}</div>}
      {!loading && items.length > 0 && !filtered.length && <div className="empty-state">Không có video phù hợp bộ lọc. <button className="text-link" onClick={() => { setQuery(""); setMode(""); }}>Xóa bộ lọc</button></div>}
      {!loading && filtered.length > 0 && <div className="library-grid">{filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((item) => <article className="library-card" key={`${item.video_id}-${item.mode || "source"}`}><VideoCover client={client} video={item} previewPath={normalized(item).file_path}>{isOutputs && <span className="mode-badge">{item.mode_label || (item.mode === "voiceover" ? "Vietsub + Voice" : "Vietsub")}</span>}</VideoCover><div className="library-body"><h3>{item.title || item.video_id}</h3><div className="library-meta"><span>{item.video_id}</span>{item.channel && <span>{item.channel}</span>}{item.size_text && <span>{item.size_text}</span>}{item.updated_at && <span>{dateText(item.updated_at)}</span>}</div><div className="library-actions"><button className="btn primary" onClick={() => openPreview(item)}><Icon name="play" size={16} />Xem</button><button className="btn secondary" disabled={busy === `${item.video_id}-${item.mode || "source"}`} onClick={() => download(item)}><Icon name="download" size={16} />{busy === `${item.video_id}-${item.mode || "source"}` ? "Đang tải…" : "Tải"}</button>{!isOutputs && <Link className="btn secondary" href={sourceHref(item)}><Icon name="spark" size={16} />Xử lý AI</Link>}</div></div></article>)}</div>}
      {!loading && <Pager page={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />}
    </section>
    {preview && <PreviewDialog client={client} item={preview} onClose={() => setPreview(null)} onError={setError} />}
  </>;
}
