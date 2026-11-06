"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icon";
import { useEngine } from "./engine-provider";
import { sendFeedback } from "./feedback-provider";
import { createClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { GEMINI_ONBOARDING_KEY, hasMatchingGoogleGrant } from "../lib/gemini-onboarding";
import { googleConsentLabel } from "../lib/google-consent";
import { GoogleConsentPrompt } from "./google-consent-prompt";
import { GeminiProjectPicker } from "./gemini-project-picker";
import { geminiSetupActionUrl, settleGeminiEnablement } from "../lib/gemini-enablement";
import { newerVersion } from "../lib/engine-version";

const DEFAULTS = { refresh_interval: 5 };
const REFRESH_INTERVALS = [3, 5, 10, 15, 30, 60];
const CONNECTION_LABELS = {
  checking: "Đang kiểm tra", connected: "Đã kết nối", disconnected: "Local Engine offline",
  authorization_required: "Cần cấp quyền", authorizing: "Đang cấp quyền",
  permission_denied: "Quyền truy cập bị từ chối", update_required: "Cần cập nhật Local Engine", error: "Lỗi kết nối",
};

async function requestGeminiRepair(client) {
  try {
    return await client.json("/api/gemini/oauth/repair", { method: "POST" });
  } catch (error) {
    // Engine <= 0.2.28 only exposes the older enable endpoint. Keep the web
    // usable while customers install the auto-repair release.
    if (error?.status === 404) return client.json("/api/gemini/oauth/enable", { method: "POST" });
    throw error;
  }
}

function formatSpace(bytes) {
  const number = Number(bytes);
  if (!Number.isFinite(number) || number < 0) return "—";
  return `${(number / 1024 ** 3).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} GB`;
}

export function SettingsPage() {
  const { status, client, connect, check, capabilities } = useEngine();
  const [settings, setSettings] = useState(DEFAULTS);
  const [engineInfo, setEngineInfo] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [oauthStarting, setOauthStarting] = useState(false);
  const [oauthDisconnecting, setOauthDisconnecting] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [projectSaving, setProjectSaving] = useState(false);
  const [projectSaved, setProjectSaved] = useState(false);
  const [projectDetecting, setProjectDetecting] = useState(false);
  const [geminiAccess, setGeminiAccess] = useState(null);
  const [whisperCheck, setWhisperCheck] = useState(null);
  const [whisperChecking, setWhisperChecking] = useState(false);
  const [error, setError] = useState("");
  const [webAccountEmail, setWebAccountEmail] = useState("");
  const [geminiRepairing, setGeminiRepairing] = useState(false);
  const requestSequence = useRef(0);
  const geminiCheckSequence = useRef(0);
  const geminiAutoEnableAttempted = useRef(false);
  const geminiEnablePending = useRef(null);
  const geminiCheckInFlight = useRef(null);
  const projectIdDirty = useRef(false);
  const reconnectIntentHandled = useRef(false);
  const connected = status === "connected";
  const busyConnection = status === "checking" || status === "authorizing";
  const mediaReady = Boolean(diagnostics?.readiness?.media);
  const apiKeyConfigured = Boolean(diagnostics?.configuration?.gemini_api_key_configured);
  const storageReady = Boolean(diagnostics?.readiness?.storage);
  const whisperModules = diagnostics?.components?.whisper_modules === true;
  const diagnosticProblem = Boolean(diagnostics) && (
    !mediaReady || !storageReady || !diagnostics.components?.ocr ||
    !diagnostics.components?.vietnamese_tts || !whisperModules || whisperCheck?.ready === false
  );
  const googleOAuth = diagnostics?.configuration?.gemini_oauth;
  const oauthNeedsReconnect = Boolean(googleOAuth?.needs_reauthorization);
  const googleNeedsReconnect = oauthNeedsReconnect || geminiAccess?.state === "reauthorization_required";
  const googleTemporaryError = Boolean(googleOAuth?.temporary_error) || geminiAccess?.state === "temporary_error";
  const geminiReady = apiKeyConfigured || Boolean(geminiAccess?.ready);
  const geminiActionUrl = geminiSetupActionUrl(geminiAccess?.action, googleOAuth?.project_id);
  const googleAccountMismatch = Boolean(
    webAccountEmail && googleOAuth?.google_email &&
    webAccountEmail.toLowerCase() !== googleOAuth.google_email.toLowerCase()
  );

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    createClient().auth.getUser().then(({ data }) => setWebAccountEmail(data?.user?.email || "")).catch(() => {});
  }, []);

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
      if (!projectIdDirty.current) setProjectId(runtime?.configuration?.gemini_oauth?.project_id || "");
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
      geminiCheckSequence.current += 1;
      geminiCheckInFlight.current = null; geminiEnablePending.current = null;
      setEngineInfo(null); setDiagnostics(null); setLoaded(false); setLoading(false); setSaved(false);
      setWhisperCheck(null); setWhisperChecking(false);
      setGeminiAccess(null); geminiAutoEnableAttempted.current = false;
      setProjectId(""); setProjectSaved(false); projectIdDirty.current = false;
    }
    return () => { requestSequence.current += 1; geminiCheckSequence.current += 1; };
  }, [connected, load]);
  useEffect(() => { if (error) sendFeedback("error", error); }, [error]);
  useEffect(() => {
    if (!googleOAuth?.connecting || !connected) return undefined;
    const timer = window.setInterval(() => load(), 2500);
    return () => window.clearInterval(timer);
  }, [connected, googleOAuth?.connecting, load]);

  const applyGeminiAccess = useCallback((result) => {
    const key = `${googleOAuth?.google_subject || googleOAuth?.google_email || ''}|${googleOAuth?.project_id || ''}`;
    const settled = settleGeminiEnablement(result, geminiEnablePending.current, key);
    geminiEnablePending.current = settled.pending;
    setGeminiAccess(settled.result);
  }, [googleOAuth?.google_subject, googleOAuth?.google_email, googleOAuth?.project_id]);

  const checkGeminiAccess = useCallback(async () => {
    const key = `${googleOAuth?.google_subject || googleOAuth?.google_email || ''}|${googleOAuth?.project_id || ''}`;
    if (geminiCheckInFlight.current?.key === key) return;
    const sequence = ++geminiCheckSequence.current;
    if (!connected || !googleOAuth?.connected || oauthNeedsReconnect) {
      setGeminiAccess(null);
      return;
    }
    const entry = { key }; geminiCheckInFlight.current = entry;
    try {
      const result = await client.json("/api/gemini/oauth/verify", { cache: "no-store" });
      if (sequence !== geminiCheckSequence.current) return;
      if (result.state === "disabled" && !geminiAutoEnableAttempted.current) {
        geminiAutoEnableAttempted.current = true;
        const setup = await requestGeminiRepair(client);
        if (sequence === geminiCheckSequence.current) applyGeminiAccess(setup);
        return;
      }
      applyGeminiAccess(result);
    } catch (requestError) {
      if (sequence === geminiCheckSequence.current) applyGeminiAccess({ state: "temporary_error", ready: false, message: requestError.message || "Chưa thể kiểm tra Gemini." });
    } finally {
      if (geminiCheckInFlight.current === entry) geminiCheckInFlight.current = null;
    }
  }, [client, connected, oauthNeedsReconnect, googleOAuth?.connected, googleOAuth?.project_id, googleOAuth?.google_subject, googleOAuth?.google_email, applyGeminiAccess]);

  const applyProjectSelection = useCallback(async (selected) => {
    const unchanged = selected === googleOAuth?.project_id;
    geminiCheckSequence.current += 1;
    geminiCheckInFlight.current = null; geminiEnablePending.current = null;
    projectIdDirty.current = false;
    setProjectId(selected); setGeminiAccess(null); geminiAutoEnableAttempted.current = false;
    await load();
    if (unchanged) await checkGeminiAccess();
    setProjectSaved(true);
  }, [load, checkGeminiAccess, googleOAuth?.project_id]);

  const repairGemini = async () => {
    if (!connected || geminiRepairing) return;
    if (["reauthorize", "not_connected"].includes(geminiAccess?.action || geminiAccess?.state)) {
      await connectGoogle();
      return;
    }
    setGeminiRepairing(true); setError("");
    try {
      const result = await requestGeminiRepair(client);
      applyGeminiAccess(result);
      await load();
    } catch (requestError) {
      setError(requestError.message || "Chưa thể tự sửa kết nối Gemini.");
    } finally { setGeminiRepairing(false); }
  };

  useEffect(() => { checkGeminiAccess(); }, [checkGeminiAccess]);
  useEffect(() => {
    if (!connected || geminiAccess?.state !== "enabling") return undefined;
    const timer = window.setInterval(() => checkGeminiAccess(), 5000);
    return () => window.clearInterval(timer);
  }, [checkGeminiAccess, connected, geminiAccess?.state]);

  const connectGoogle = async () => {
    if (!connected || oauthStarting) return;
    setOauthStarting(true); setError(""); geminiAutoEnableAttempted.current = false;
    try {
      await client.json("/api/gemini/oauth/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ browser: "web", return_to: `${window.location.origin}/settings#diagnostics` }) });
      await load();
    } catch (requestError) {
      setError(requestError.message || "Không thể bắt đầu đăng nhập Google.");
    } finally { setOauthStarting(false); }
  };

  // The processing-error link carries an explicit reconnect intent. Opening
  // Settings through that link starts the Google consent flow in one step.
  useEffect(() => {
    if (!connected || !diagnostics || reconnectIntentHandled.current || googleOAuth?.connecting) return;
    const url = new URL(window.location.href);
    const onboarding = url.searchParams.get("onboarding") === "1";
    if (url.searchParams.get("reconnect") !== "1" && !onboarding) return;
    if (onboarding && !webAccountEmail) return;
    reconnectIntentHandled.current = true;
    url.searchParams.delete("reconnect");
    url.searchParams.delete("onboarding");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    if (onboarding) {
      window.localStorage.removeItem(GEMINI_ONBOARDING_KEY);
      if (hasMatchingGoogleGrant(webAccountEmail, googleOAuth)) return;
    }
    void connectGoogle();
  }, [connected, diagnostics, googleOAuth?.connecting, googleOAuth?.connected, googleOAuth?.needs_reauthorization, webAccountEmail]);

  const disconnectGoogle = async () => {
    if (!connected || oauthDisconnecting) return;
    setOauthDisconnecting(true); setError("");
    try {
      await client.json("/api/gemini/oauth", { method: "DELETE" });
      geminiAutoEnableAttempted.current = false;
      await load();
    } catch (requestError) {
      setError(requestError.message || "Không thể đăng xuất Google trên máy này.");
    } finally { setOauthDisconnecting(false); }
  };

  const saveProject = async (event) => {
    event.preventDefault();
    if (!connected || projectSaving) return;
    const selected = projectId.trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(selected)) {
      setError("Project ID phải dài 6–30 ký tự, bắt đầu bằng chữ thường và chỉ gồm chữ thường, số hoặc dấu gạch ngang.");
      return;
    }
    setProjectSaving(true); setProjectSaved(false); setError("");
    try {
      await client.json("/api/gemini/project", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: selected }),
      });
      await applyProjectSelection(selected);
    } catch (requestError) {
      setError(requestError.message || "Không thể lưu Google Cloud project trên máy này.");
    } finally { setProjectSaving(false); }
  };

  const checkWhisper = async () => {
    if (!connected || !whisperModules || whisperChecking) return;
    setWhisperChecking(true);
    setWhisperCheck(null);
    try {
      setWhisperCheck(await client.json("/api/diagnostics/whisper", { method: "POST" }));
    } catch (requestError) {
      setWhisperCheck({ ready: false, message: requestError.message || "Không thể kiểm tra Whisper." });
    } finally {
      setWhisperChecking(false);
    }
  };

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
        {!connected && <p className="muted">{status === "authorization_required" || status === "permission_denied" ? "Bấm Kết nối ReupAI để cấp quyền ngay trên trang này." : status === "update_required" ? "Cập nhật Local Engine để dùng kết nối một chạm." : "Khởi động ReupAI Local Engine trên máy này rồi kiểm tra lại."}</p>}
        <div className="settings-actions">
          {(status === "authorization_required" || status === "permission_denied") && <button className="btn primary" onClick={connect}>Kết nối ReupAI</button>}
          <button className="btn" onClick={check} disabled={busyConnection}><Icon name="refresh" size={16} />{busyConnection ? CONNECTION_LABELS[status] : "Kiểm tra kết nối"}</button>
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

      <section className="panel" id="diagnostics">
        <div className="panel-head"><div><h2>Chẩn đoán xử lý</h2><p>Kiểm tra trước các điều kiện dễ làm job dừng giữa chừng.</p></div><span className="setting-status">{diagnosticProblem ? "Cần xử lý" : diagnostics ? whisperCheck?.ready && geminiReady ? "Sẵn sàng" : "Cần kiểm tra" : "Đang kiểm tra"}</span></div>
        <div className="setting-row"><span>FFmpeg</span><strong>{diagnostics ? (diagnostics.tools?.ffmpeg ? "Đã cài" : "Không tìm thấy") : "—"}</strong></div>
        <div className="setting-row"><span>FFprobe</span><strong>{diagnostics ? (diagnostics.tools?.ffprobe ? "Đã cài" : "Không tìm thấy") : "—"}</strong></div>
        <div className="setting-row"><span>Trình tải video</span><strong>{diagnostics ? (diagnostics.dependencies?.yt_dlp ? "Sẵn sàng" : "Cần cài lại Engine") : "—"}</strong></div>
        <div className="setting-row"><span>Trình duyệt nguồn</span><strong>{diagnostics ? (diagnostics.dependencies?.playwright ? "Sẵn sàng" : "Cần cài lại Engine") : "—"}</strong></div>
        <div className="setting-row"><span>Quét chữ phụ đề gốc (OCR)</span><strong>{diagnostics ? (diagnostics.components?.ocr ? "Sẵn sàng" : "Cần cài lại Engine") : "—"}</strong></div>
        <div className="setting-row"><span>Nhận diện lời thoại (Whisper)</span><strong>{diagnostics ? !whisperModules ? "Cần bản Engine mới" : whisperChecking ? "Đang kiểm tra" : whisperCheck ? whisperCheck.ready ? "Sẵn sàng" : "Cần xử lý" : "Chưa kiểm tra DLL" : "—"}</strong></div>
        {diagnostics && <div className="settings-actions"><button className="btn" onClick={checkWhisper} disabled={!connected || !whisperModules || whisperChecking}>{whisperChecking ? "Đang kiểm tra Whisper…" : "Kiểm tra Whisper"}</button></div>}
        {whisperCheck?.message && <p className="muted">{whisperCheck.message}</p>}
        <div className="setting-row"><span>Giọng đọc tiếng Việt</span><strong>{diagnostics ? (diagnostics.components?.vietnamese_tts ? "Sẵn sàng" : "Cần cài lại Engine") : "—"}</strong></div>
        <div className="setting-row"><span>Gemini / Google</span><strong>{diagnostics ? (apiKeyConfigured ? "Đã cấu hình API key" : googleOAuth?.connecting ? googleConsentLabel(googleOAuth) : geminiReady ? "Sẵn sàng" : googleNeedsReconnect ? "Cần kết nối lại Google" : googleTemporaryError ? "Tạm gián đoạn" : !googleOAuth?.connected ? "Chưa kết nối" : !googleOAuth?.project_id ? "Cần chọn project" : geminiAccess?.state === "quota_permission_required" ? "Thiếu quyền dùng quota" : geminiAccess?.state === "permission_denied" ? "Thiếu quyền Gemini" : geminiAccess?.state === "enabling" ? "Đang bật Gemini API" : "Đang kiểm tra Gemini API") : "—"}</strong></div>
        {googleOAuth?.google_email && <div className="setting-row"><span>Tài khoản Google đang cấp Gemini</span><strong>{googleOAuth.google_email}</strong></div>}
        <GoogleConsentPrompt oauth={googleOAuth} />
        {!apiKeyConfigured && <GeminiProjectPicker client={client} supported={connected && Boolean(capabilities?.gemini_project_discovery)} canCreate={connected && Boolean(capabilities?.gemini_project_creation)} canReplace={newerVersion(engineInfo?.version, "0.2.38")} oauth={googleOAuth} access={geminiAccess} onSelected={applyProjectSelection} onBusyChange={setProjectDetecting} onReconnect={connectGoogle} />}
        {!apiKeyConfigured && diagnostics && <form className="settings-form" onSubmit={saveProject}>
          <label htmlFor="gemini-project-id"><span>Project ID (tự điền hoặc nhập thủ công)</span><input id="gemini-project-id" value={projectId} onChange={(event) => { projectIdDirty.current = true; setProjectId(event.target.value); setProjectSaved(false); }} placeholder="vi-du: du-an-video-123" autoComplete="off" spellCheck={false} disabled={!connected || projectSaving || projectDetecting || googleOAuth?.connecting} /></label>
          <div className="settings-actions"><button className="btn primary" type="submit" disabled={!connected || projectSaving || projectDetecting || googleOAuth?.connecting}>{projectSaving ? "Đang lưu…" : "Lưu và kiểm tra Gemini"}</button><a className="btn" href="https://console.cloud.google.com/cloud-resource-manager" target="_blank" rel="noreferrer">Xem project của bạn</a></div>
          <p className="muted">Mỗi khách dùng quota và project Google Cloud của mình. Project cần bật Gemini API; tài khoản Google đăng nhập cần quyền dùng quota trên project đó.</p>
          {projectSaved && <p className="muted" role="status">Đã lưu Project ID trên máy này. Đang kiểm tra Gemini API.</p>}
        </form>}
        {!apiKeyConfigured && diagnostics && <div className="settings-actions">
          {(!googleOAuth?.connected && !googleTemporaryError || googleNeedsReconnect) && <button className="btn primary" onClick={connectGoogle} disabled={!connected || oauthStarting || googleOAuth?.connecting}>{oauthStarting || googleOAuth?.connecting ? "Đang chờ Google…" : googleNeedsReconnect ? "Kết nối lại Google" : "Kết nối Google"}</button>}
          {googleTemporaryError && <button className="btn" onClick={() => { load(); checkGeminiAccess(); }} disabled={!connected || loading}>Kiểm tra lại</button>}
          {googleOAuth?.connected && geminiAccess && !geminiAccess.ready && !["project_required", "enabling"].includes(geminiAccess.state) && (geminiActionUrl
            ? <><a className="btn primary" href={geminiActionUrl} target="_blank" rel="noreferrer">{geminiAccess.action_label || "Mở Google Cloud"}</a><button className="btn" onClick={checkGeminiAccess} disabled={!connected || loading}>Đã xử lý · Kiểm tra lại</button></>
            : geminiAccess.action === "select_project"
              ? <button className="btn primary" onClick={() => document.getElementById("gemini-project-id")?.focus()}>Chọn project khác</button>
              : <button className="btn primary" onClick={repairGemini} disabled={!connected || geminiRepairing || oauthStarting}>{geminiRepairing ? "Đang thiết lập…" : geminiAccess.action === "enable_api" ? "Thiết lập Gemini tự động" : geminiAccess.action_label || "Sửa nhanh Gemini"}</button>)}
          {googleOAuth?.connecting && <button className="btn" onClick={disconnectGoogle} disabled={!connected || oauthDisconnecting}>{oauthDisconnecting ? "Đang dừng…" : "Dừng chờ"}</button>}
          {googleOAuth?.connected && <button className="btn" onClick={disconnectGoogle} disabled={!connected || oauthDisconnecting}>{oauthDisconnecting ? "Đang đăng xuất…" : "Đăng xuất Google"}</button>}
          {!googleOAuth?.connected && !googleNeedsReconnect && <p className="muted">Google sẽ mở trong trình duyệt để cấp quyền cho Gemini. ReupAI chỉ lưu token đã mã hóa trên máy này.</p>}
          {googleNeedsReconnect && <p className="muted">Phiên Google đã hết hạn hoặc cần cấp quyền mới. Bấm Kết nối lại Google; video và dự án trên máy vẫn được giữ nguyên.</p>}
          {googleOAuth?.temporary_error && <p className="muted">Tạm thời không thể làm mới phiên Google. Kiểm tra Internet rồi bấm Kiểm tra lại; chưa cần đăng nhập lại.</p>}
          {googleAccountMismatch && <p className="muted" role="alert">Tài khoản web là {webAccountEmail}, còn Gemini đang dùng {googleOAuth.google_email}. Nếu đây không phải project bạn muốn dùng, hãy bấm Đăng xuất Google rồi kết nối đúng tài khoản.</p>}
          {geminiAccess?.message && <p className="muted">{geminiAccess.message}</p>}
          {googleOAuth?.project_id && ["disabled", "administrator_required"].includes(geminiAccess?.state) && <a className="btn" href={`https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com?project=${encodeURIComponent(googleOAuth.project_id)}`} target="_blank" rel="noreferrer">Mở trang bật Gemini API</a>}
        </div>}
        {googleOAuth?.error && <p className="muted">Google chưa hoàn tất: {googleOAuth.error}</p>}
        <div className="setting-row"><span>Dung lượng an toàn</span><strong>{diagnostics ? (storageReady ? "Đủ để chạy" : `Cần tối thiểu ${formatSpace(diagnostics.storage?.minimum_free_bytes)}`) : "—"}</strong></div>
        <div className="setting-row"><span>Python</span><strong>{diagnostics?.python || "—"}</strong></div>
        <div className="setting-row"><span>CPU logic</span><strong>{diagnostics?.cpu_count || "—"}</strong></div>
        <div className="setting-row"><span>Chế độ dữ liệu</span><strong>{diagnostics?.runtime_mode === "production" ? "Production" : diagnostics?.runtime_mode === "development" ? "Development" : "—"}</strong></div>
      </section>
    </div>
  </div>;
}
