"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icon";
import { useEngine } from "./engine-provider";
import { sendFeedback } from "./feedback-provider";

const DEFAULTS = { refresh_interval: 5 };
const REFRESH_INTERVALS = [3, 5, 10, 15, 30, 60];
const CONNECTION_LABELS = {
  checking: "Đang kiểm tra", connected: "Đã kết nối", disconnected: "Local Engine offline",
  authorization_required: "Cần cấp quyền", authorizing: "Đang cấp quyền",
  permission_denied: "Quyền truy cập bị từ chối", error: "Lỗi kết nối",
};

function formatSpace(bytes) {
  const number = Number(bytes);
  if (!Number.isFinite(number) || number < 0) return "—";
  return `${(number / 1024 ** 3).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} GB`;
}

export function SettingsPage() {
  const { status, client, connect, check, revoke } = useEngine();
  const [settings, setSettings] = useState(DEFAULTS);
  const [engineInfo, setEngineInfo] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);
  const connected = status === "connected";
  const busyConnection = status === "checking" || status === "authorizing";

  const load = useCallback(async () => {
    if (status !== "connected") return;
    const sequence = ++requestSequence.current;
    setLoading(true); setError("");
    try {
      const [state, info, runtime] = await Promise.all([
        client.json("/api/library/ui-state/next-settings", { cache: "no-store" }),
        client.json("/api/status", { cache: "no-store" }),
        client.json("/api/diagnostics", { cache: "no-store" }),
      ]);
      if (sequence !== requestSequence.current) return;
      const value = state.value && typeof state.value === "object" && !Array.isArray(state.value) ? state.value : {};
      const interval = Number(value.refresh_interval);
      setSettings({ ...value, refresh_interval: REFRESH_INTERVALS.includes(interval) ? interval : DEFAULTS.refresh_interval });
      setEngineInfo(info); setDiagnostics(runtime); setLoaded(true);
    } catch (requestError) {
      if (sequence === requestSequence.current) setError(requestError.message || "Không thể đọc cài đặt trên máy. Hãy thử lại.");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [client, status]);

  useEffect(() => {
    if (connected) load();
    else {
      requestSequence.current += 1;
      setEngineInfo(null); setDiagnostics(null); setLoaded(false); setLoading(false); setSaved(false);
    }
    return () => { requestSequence.current += 1; };
  }, [connected, load]);
  useEffect(() => { if (error) sendFeedback("error", error); }, [error]);

  const save = async (event) => {
    event.preventDefault();
    if (!connected || !loaded || loading || saving) return;
    setSaving(true); setSaved(false); setError("");
    try {
      await client.json("/api/library/ui-state/next-settings", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: settings }),
      });
      setSaved(true);
    } catch (requestError) { setError(requestError.message || "Không thể lưu cài đặt trên máy. Hãy thử lại."); }
    finally { setSaving(false); }
  };

  const revokeAccess = async () => {
    if (revoking) return;
    setRevoking(true); setError("");
    try { await revoke(); }
    catch (requestError) { setError(requestError.message || "Không thể xác nhận thu hồi quyền trên Local Engine."); }
    finally { setRevoking(false); }
  };

  return <div className="settings-page">
    {error && <div className="error-banner" role="alert"><span><Icon name="alert" size={16} />{error}</span>{connected && <button className="btn" onClick={load} disabled={loading || saving}>Thử lại</button>}</div>}
    {saved && <div className="notice-banner" role="status"><Icon name="check" size={16} />Đã lưu cài đặt trên máy này.</div>}
    <div className="settings-grid">
      <section className="panel translation-settings" id="translation">
        <div className="panel-head"><div><h2>Dịch Trung → Việt</h2><p>Chức năng Vietsub trên từng video sử dụng luồng xử lý hiện tại.</p></div><span className="setting-status">{connected ? "Sẵn sàng" : "Chờ kết nối"}</span></div>
        <div className="setting-row"><span>Ngôn ngữ nguồn</span><strong>中文 / Trung</strong></div>
        <div className="setting-row"><span>Ngôn ngữ đích</span><strong>Tiếng Việt</strong></div>
        <div className="setting-row"><span>Xử lý video</span><strong>Trên máy của bạn</strong></div>
        <Link className="btn primary translation-action" href="/sources"><Icon name="source" size={16} />Mở nguồn video để dịch</Link>
      </section>

      <section className="panel">
        <div className="panel-head"><div><h2>Kết nối Local Engine</h2><p>Cấp quyền để trang web truy cập dữ liệu trên máy này.</p></div><span className={connected ? "setting-status" : "status-chip"} role="status">{CONNECTION_LABELS[status] || "Chưa kết nối"}</span></div>
        <div className="setting-row"><span>Địa chỉ Engine</span><code>{client.baseUrl}</code></div>
        <div className="setting-row"><span>Quyền trên trình duyệt này</span><strong>{client.hasPersistentGrant ? "Đã cấp quyền" : "Chưa cấp quyền"}</strong></div>
        <div className="setting-row"><span>Phiên bản</span><strong>{engineInfo?.version || "—"}</strong></div>
        {!connected && <p className="muted">{status === "authorization_required" || status === "permission_denied" ? "Bấm Kết nối ReupAI và chọn Cho phép trên trang Local Engine." : "Khởi động ReupAI Local Engine trên máy này rồi kiểm tra lại."}</p>}
        <div className="settings-actions">
          {(status === "authorization_required" || status === "permission_denied") && <button className="btn primary" onClick={connect}>Kết nối ReupAI</button>}
          <button className="btn" onClick={check} disabled={busyConnection || revoking}><Icon name="refresh" size={16} />{busyConnection ? CONNECTION_LABELS[status] : "Kiểm tra kết nối"}</button>
          {connected && <button className="btn danger" onClick={revokeAccess} disabled={revoking}>{revoking ? "Đang thu hồi…" : "Thu hồi quyền"}</button>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><div><h2>Giao diện làm việc</h2><p>Cài đặt lưu trên Local Engine và được dùng khi mở lại Dashboard.</p></div>{loading && <span className="setting-status" role="status">Đang tải…</span>}</div>
        <form className="settings-form" onSubmit={save}>
          <label htmlFor="settings-refresh"><span>Chu kỳ cập nhật Dashboard</span><select id="settings-refresh" value={settings.refresh_interval} onChange={(event) => { setSettings((previous) => ({ ...previous, refresh_interval: Number(event.target.value) })); setSaved(false); }} disabled={!connected || !loaded || loading || saving}>{REFRESH_INTERVALS.map((interval) => <option key={interval} value={interval}>{interval} giây</option>)}</select></label>
          <button className="btn primary" disabled={!connected || !loaded || loading || saving} type="submit">{saving ? "Đang lưu…" : "Lưu cài đặt"}</button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-head"><div><h2>Dữ liệu trên máy</h2><p>Video, dự án, lịch sử và thành phẩm được lưu cục bộ.</p></div></div>
        <div className="setting-row"><span>Dung lượng trống</span><strong>{formatSpace(engineInfo?.storage?.free_space)}</strong></div>
        <div className="setting-row"><span>Job đang chạy</span><strong>{engineInfo ? Number(engineInfo.active_jobs || 0) : "—"}</strong></div>
        <div className="setting-row"><span>Thư mục dữ liệu</span><code style={{ overflowWrap: "anywhere", textAlign: "right" }}>{engineInfo?.storage?.root || "—"}</code></div>
        <div className="setting-row"><span>Video đã tải</span><code style={{ overflowWrap: "anywhere", textAlign: "right" }}>{engineInfo?.storage?.downloads || "—"}</code></div>
        <div className="setting-row"><span>Thành phẩm</span><code style={{ overflowWrap: "anywhere", textAlign: "right" }}>{engineInfo?.storage?.output || "—"}</code></div>
      </section>

      <section className="panel">
        <div className="panel-head"><div><h2>Chẩn đoán xử lý</h2><p>Kiểm tra nhanh môi trường chạy pipeline trên máy này.</p></div><span className="setting-status">{diagnostics?.tools?.ffmpeg && diagnostics?.tools?.ffprobe ? "Sẵn sàng" : "Cần kiểm tra"}</span></div>
        <div className="setting-row"><span>FFmpeg</span><strong>{diagnostics ? (diagnostics.tools?.ffmpeg ? "Đã cài" : "Không tìm thấy") : "—"}</strong></div>
        <div className="setting-row"><span>FFprobe</span><strong>{diagnostics ? (diagnostics.tools?.ffprobe ? "Đã cài" : "Không tìm thấy") : "—"}</strong></div>
        <div className="setting-row"><span>Python</span><strong>{diagnostics?.python || "—"}</strong></div>
        <div className="setting-row"><span>CPU logic</span><strong>{diagnostics?.cpu_count || "—"}</strong></div>
        <div className="setting-row"><span>Chế độ dữ liệu</span><strong>{diagnostics?.runtime_mode === "production" ? "Production" : diagnostics?.runtime_mode === "development" ? "Development" : "—"}</strong></div>
      </section>
    </div>
  </div>;
}
