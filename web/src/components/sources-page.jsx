"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useEngine } from "./engine-provider";
import { mountProductRuntime } from "../lib/product-runtime";
import { sendFeedback } from "./feedback-provider";
import { useFeedback } from "./feedback-provider";
import { PENDING_SOURCE_KEY } from "./workspace-assistant";
import { OutputEditor } from "./output-editor";

import { useYoutubeConnection } from "./youtube-connection";
import { MxhConnectionCompact, UnifiedPublishModal, useSocialConnections } from "./social-platforms";

export function SourcesPage() {
  const { status, error: connectionError, client, connect, check } = useEngine();
  const youtube = useYoutubeConnection();
  const social = useSocialConnections();
  const [diagnostics, setDiagnostics] = useState(null);
  const loadDiagnostics = () => {
    if (status !== "connected") return;
    client.json("/api/diagnostics", { cache: "no-store" })
      .then(result => setDiagnostics(result))
      .catch(() => {});
  };
  useEffect(() => {
    loadDiagnostics();
    const onVisible = () => { if (document.visibilityState === "visible") loadDiagnostics(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [client, status]);
  const googleOAuth = diagnostics?.configuration?.gemini_oauth;
  const apiKeyConfigured = Boolean(diagnostics?.configuration?.gemini_api_key_configured);
  const geminiReady = apiKeyConfigured || Boolean(diagnostics?.readiness?.translation) || (Boolean(googleOAuth?.connected) && Boolean(googleOAuth?.project_id) && !googleOAuth?.needs_reauthorization);
  const geminiNeedsProject = Boolean(googleOAuth?.connected) && !googleOAuth?.project_id && !apiKeyConfigured;
  const [publishTarget, setPublishTarget] = useState(null);
  useEffect(() => {
    const open = event => { if (event.detail?.video_id) setPublishTarget({ item: event.detail, platform: "facebook" }); };
    window.addEventListener("reupai:social-output", open);
    return () => window.removeEventListener("reupai:social-output", open);
  }, []);
  const host = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);
  const [editor, setEditor] = useState(null);
  useEffect(() => {
    const open = event => { if (event.detail?.video_id) setEditor(event.detail); };
    window.addEventListener("reupai:edit-output", open);
    return () => window.removeEventListener("reupai:edit-output", open);
  }, []);
  useEffect(() => {
    const publish = event => {
      if (!event.detail?.video_id) return;
      setPublishTarget({ item: event.detail });
    };
    window.addEventListener('reupai:publish-output', publish);
    return () => window.removeEventListener('reupai:publish-output', publish);
  }, []);
  const { beginWaiting, endWaiting } = useFeedback();

  useEffect(() => {
    if (status !== "connected" || !host.current) return;
    const element = host.current;
    let active = true;
    let dispose;
    const waitId = beginWaiting("Đang chuẩn bị thư viện video trên máy của bạn.");
    const finishWaiting = () => endWaiting(waitId);
    setReady(false);
    setError(null);
    const onError = (event) => { const message = event.detail?.message || "Không thể hoàn tất thao tác trên Local Engine."; if (active) setError(message); sendFeedback("error", message); };
    const onReady = () => { if (active) { finishWaiting(); setReady(true); } };
    element.addEventListener("product-runtime:error", onError);
    element.addEventListener("product-runtime:ready", onReady);
    Promise.all([
      import("../legacy/sources-markup"),
      import("../legacy/sources-runtime"),
    ]).then(([markupModule, runtimeModule]) => {
      if (!active) return;
      element.innerHTML = markupModule.sourcesMarkup;
      return mountProductRuntime(element, client, runtimeModule.startSourcesRuntime);
    }).then((cleanup) => {
      if (!cleanup) return;
      if (!active) cleanup();
      else { dispose = cleanup; }
    }).catch((requestError) => { const message = requestError.message || "Không đọc được dữ liệu local."; finishWaiting(); if (active) setError(message); sendFeedback("error", message); });
    return () => {
      active = false;
      finishWaiting();
      element.removeEventListener("product-runtime:error", onError);
      element.removeEventListener("product-runtime:ready", onReady);
      dispose?.();
      element.innerHTML = "";
    };
  }, [client, status, retry]);

  useEffect(() => {
    if (status !== "connected" || !ready) return;
    try {
      const draft = JSON.parse(window.sessionStorage.getItem("reupai:guest-source-draft") || "null");
      if (draft) {
        const input = host.current?.querySelector("#sourceUrl");
        const mode = host.current?.querySelector("#sourceInputMode");
        if (input && typeof draft.url === "string" && draft.url.length < 4000 && Date.now() - draft.createdAt < 30 * 60 * 1000) {
          input.value = draft.url;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          if (mode && ["video", "channel"].includes(draft.mode)) mode.value = draft.mode;
        }
        window.sessionStorage.removeItem("reupai:guest-source-draft");
      }
    } catch { window.sessionStorage.removeItem("reupai:guest-source-draft"); }
    let request;
    try { request = JSON.parse(window.sessionStorage.getItem(PENDING_SOURCE_KEY) || "null"); }
    catch { window.sessionStorage.removeItem(PENDING_SOURCE_KEY); return; }
    if (!request) return;
    window.sessionStorage.removeItem(PENDING_SOURCE_KEY);
    if (Date.now() - request.createdAt > 5 * 60 * 1000 || !["subtitle", "voiceover"].includes(request.mode)) return;
    document.dispatchEvent(new CustomEvent("reupai:assistant-source", { detail: {
      url: request.url, mode: request.mode,
      complete: (result) => { if (!result?.ok) setError(result?.message || "Chưa mở được cấu hình video."); },
    } }));
  }, [status, ready]);

  if (status !== "connected") {
    const needsPermission = status === "authorization_required" || status === "permission_denied";
    const waiting = status === "checking" || status === "authorizing";
    const updateRequired = status === "update_required";
    const title = waiting ? "Đang tìm Local Engine trên máy" : updateRequired ? "Cần cập nhật Local Engine" : needsPermission ? "Cần kết nối với Local Engine" : "Chưa kết nối được Local Engine";
    const description = waiting
      ? "ReupAI đang tự kiểm tra phần mềm và quyền truy cập."
      : updateRequired
        ? "Phiên bản đang chạy chưa hỗ trợ kết nối tự động với website."
        : needsPermission
          ? "Phần mềm đã phản hồi. Hãy kết nối để mở thư viện và xử lý video."
          : "Hãy mở ReupAI Local Engine trên máy này. Nếu phần mềm đã chạy, thử kiểm tra lại hoặc cấp quyền truy cập mạng cục bộ cho trình duyệt.";
    return <section className="engine-connection-card" role="status" aria-live="polite">
      <div className="engine-connection-icon" aria-hidden="true">{waiting ? "◌" : "↗"}</div>
      <div className="engine-connection-content">
        <span className="engine-connection-kicker">KẾT NỐI TRÊN MÁY CỦA BẠN</span>
        <h2>{title}</h2>
        <p>{description}</p>
        {connectionError && !waiting && status !== "disconnected" && <small className="engine-connection-detail">{connectionError.message}</small>}
        <div className="engine-connection-actions">
          <button className="btn primary" type="button" disabled={waiting} onClick={needsPermission ? connect : check}>{waiting ? "Đang kiểm tra…" : needsPermission ? "Kết nối ngay" : "Kiểm tra lại"}</button>
          <Link className="engine-connection-link" href="/local-engine">{updateRequired ? "Tải bản mới" : "Tải phần mềm / Xem hướng dẫn"} <span aria-hidden="true">→</span></Link>
        </div>
      </div>
    </section>;
  }

  return <div className="native-sources-product">
    <style>{`
      .source-runtime-host #processConfigDialog .process-config-preview {
        width: 100%; max-width: 100%; margin: 0;
      }
      .source-runtime-host #processConfigDialog .process-config-preview video {
        max-height: min(46vh, 520px); max-width: 100%; width: auto; height: auto; object-fit: contain;
      }
      .source-runtime-host #processConfigPreviewEmpty {
        line-height: 1.6;
      }
    `}</style>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button className="btn secondary" onClick={() => setRetry((value) => value + 1)}>Thử lại</button></div>}
    {!ready && !error && <p className="info-line" aria-live="polite">Đang đọc thư viện local…</p>}
    <div className="source-status-strip">
      {status === "connected" && diagnostics && !geminiReady && (
        <section className="source-youtube-banner is-gemini" aria-label="Kích hoạt AI Gemini">
          <div>
            <small>TRÍ TUỆ NHÂN TẠO AI</small>
            <strong>{geminiNeedsProject ? "AI Gemini · Cần chọn Project" : "AI Gemini · Dịch & Lồng tiếng"}</strong>
            <p>{geminiNeedsProject ? "Đã đăng nhập Google. Chọn hoặc tạo Project ID để kích hoạt quota Gemini." : "Kết nối Google để dùng AI dịch phụ đề, Vietsub và lồng tiếng bằng quota của bạn."}</p>
          </div>
          <Link
            href={geminiNeedsProject ? "/settings#diagnostics" : "/settings?reconnect=1#diagnostics"}
            className="btn primary"
          >
            {geminiNeedsProject ? "Chọn Project Gemini" : "Kết nối Google cho Gemini"}
          </Link>
        </section>
      )}
      <MxhConnectionCompact youtube={youtube} social={social} />
    </div>
    <div ref={host} className="source-runtime-host" data-product-runtime="sources" />
    {publishTarget && <UnifiedPublishModal client={client} item={publishTarget.item} youtube={youtube} social={social} initialPlatform={publishTarget.platform} onClose={() => setPublishTarget(null)} />}
    {editor && <OutputEditor client={client} item={editor} onClose={() => setEditor(null)} onError={setError} onQueued={() => { setEditor(null); sendFeedback("success", "Đã vào hàng đợi xuất lại. Theo dõi ở Lịch sử hoặc Thành phẩm."); }} />}
  </div>;
}
