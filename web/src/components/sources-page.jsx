"use client";

import { useEffect, useRef, useState } from "react";
import { useEngine } from "./engine-provider";
import { mountProductRuntime } from "../lib/product-runtime";
import { sourcesMarkup } from "../legacy/sources-markup";
import { startSourcesRuntime } from "../legacy/sources-runtime";

export function SourcesPage() {
  const { status, client, connect, check } = useEngine();
  const host = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (status !== "connected" || !host.current) return;
    const element = host.current;
    let active = true;
    let dispose;
    setReady(false);
    setError(null);
    element.innerHTML = sourcesMarkup;
    const onError = (event) => { if (active) setError(event.detail?.message || "Không thể hoàn tất thao tác trên Local Engine."); };
    element.addEventListener("product-runtime:error", onError);
    mountProductRuntime(element, client, startSourcesRuntime).then((cleanup) => {
      if (!active) cleanup();
      else { dispose = cleanup; setReady(true); }
    }).catch((requestError) => { if (active) setError(requestError.message || "Không đọc được dữ liệu local."); });
    return () => {
      active = false;
      element.removeEventListener("product-runtime:error", onError);
      dispose?.();
      element.innerHTML = "";
    };
  }, [client, status, retry]);

  if (status !== "connected") {
    const needsPermission = status === "authorization_required" || status === "permission_denied";
    const waiting = status === "checking" || status === "authorizing";
    return <section className="panel state-panel"><h2>{waiting ? "Đang kết nối Local Engine…" : needsPermission ? "Cần cấp quyền Local Engine" : "Local Engine offline"}</h2><p>Kết nối Local Engine để xem nguồn, tải video và xử lý Vietsub / Voice trên máy của bạn.</p><button className="btn primary" disabled={waiting} onClick={needsPermission ? connect : check}>{needsPermission ? "Kết nối ReupAI" : "Kiểm tra lại"}</button></section>;
  }

  return <div className="native-sources-product">
    <style>{`
      .source-runtime-host #processConfigDialog .process-config-preview {
        width: fit-content; max-width: 100%; margin: 18px auto;
      }
      .source-runtime-host #processConfigDialog .process-config-preview video {
        max-height: min(58vh, 560px); max-width: 100%; width: auto; height: auto;
      }
      .source-runtime-host #processConfigPreviewEmpty {
        line-height: 1.6;
      }
    `}</style>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button className="btn secondary" onClick={() => setRetry((value) => value + 1)}>Thử lại</button></div>}
    {!ready && !error && <p className="info-line" aria-live="polite">Đang đọc thư viện local…</p>}
    <div ref={host} className="source-runtime-host" data-product-runtime="sources" />
  </div>;
}
