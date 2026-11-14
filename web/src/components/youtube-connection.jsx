"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useEngine } from "./engine-provider";
import { googleConsentUrl, youtubeRequest } from "../lib/youtube-client";
import { Icon } from "./icon";

export function useYoutubeConnection(enabled = true) {
  const { status, client, capabilities } = useEngine();
  const supported = status === "connected" && Boolean(capabilities?.youtube_publishing || client.health?.capabilities?.youtube_publishing);
  const [connection, setConnection] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const popup = useRef(null);
  const popupOpened = useRef(false);
  const refresh = useCallback(async () => {
    if (!enabled || !supported) return null;
    try {
      const result = await youtubeRequest(client, "connection");
      if (active.current) { setConnection(result); setError(""); }
      return result;
    } catch (requestError) { if (active.current) setError(requestError.message); return null; }
  }, [client, enabled, supported]);
  useEffect(() => {
    active.current = true;
    refresh();
    return () => { active.current = false; };
  }, [refresh]);
  useEffect(() => {
    if (!enabled || !supported || !connection?.connecting) return;
    let timer; let live = true;
    const poll = async () => {
      const next = await refresh();
      if (!live) return;
      const url = googleConsentUrl(next?.authorization_url);
      if (url && popup.current && !popup.current.closed && !popupOpened.current) {
        popupOpened.current = true;
        popup.current.location.href = url;
      }
      if (next?.connecting) timer = setTimeout(poll, 2000);
      else if (next?.connected) { try { popup.current?.close(); } catch {} }
      else if (next == null) timer = setTimeout(poll, 4000);
    };
    timer = setTimeout(poll, 500);
    return () => { live = false; clearTimeout(timer); };
  }, [connection?.connecting, enabled, supported, refresh]);
  const connect = async () => {
    if (!supported || busy) return;
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    popup.current = tab;
    popupOpened.current = false;
    setBusy(true); setError("");
    try {
      const result = await youtubeRequest(client, "connect", { method: "POST" });
      if (!active.current) return;
      setConnection(result);
      const url = googleConsentUrl(result.authorization_url);
      if (url && tab && !tab.closed) { popupOpened.current = true; tab.location.href = url; }
    } catch (requestError) { tab?.close(); if (active.current) setError(requestError.message); }
    finally { if (active.current) setBusy(false); }
  };
  const disconnect = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try { await youtubeRequest(client, "connection", { method: "DELETE" }); await refresh(); }
    catch (requestError) { if (active.current) setError(requestError.message); }
    finally { if (active.current) setBusy(false); }
  };
  return { connection, error: error || connection?.error, busy, supported, engineStatus: status, client, refresh, connect, disconnect };
}

export function YoutubeConnection() {
  const youtube = useYoutubeConnection();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const url = googleConsentUrl(youtube.connection?.authorization_url);
  return <section className="panel youtube-connection" id="channels">
    <div className="panel-head"><div><h3>Kênh đã kết nối</h3><p>Kết nối tùy chọn. Bạn chọn video và xác nhận trước khi đăng.</p></div></div>
    <div className="youtube-channel-row"><span className="youtube-channel-icon"><Icon name="video" size={22} /></span><div><strong>YouTube</strong><p>{youtube.connection?.channel?.title || "Chưa kết nối kênh"}</p></div><span className="status">{youtube.connection?.connecting ? "Đang chờ Google" : youtube.connection?.connected ? "Đã kết nối" : "Chưa kết nối"}</span></div>
    {!youtube.supported ? <p className="muted">{youtube.engineStatus !== "connected" ? "Mở và kết nối Local Engine để quản lý kênh." : "Local Engine này chưa hỗ trợ đăng YouTube. Cần bản cập nhật có tính năng YouTube."} <Link href="/settings">Mở Cài đặt</Link></p> : <div className="library-actions">
      <button type="button" className="btn primary" onClick={youtube.connect} disabled={youtube.busy || youtube.connection?.connecting}>{youtube.connection?.connected ? "Kết nối lại / Đổi kênh" : "Kết nối YouTube"}</button>
      {youtube.connection?.connected && !confirmDisconnect && <button type="button" className="btn secondary" disabled={youtube.busy} onClick={() => setConfirmDisconnect(true)}>Ngắt kết nối</button>}
      {confirmDisconnect && <><span>Ngắt kênh khỏi ReupAI trên máy này?</span><button type="button" className="btn secondary" disabled={youtube.busy} onClick={async () => { await youtube.disconnect(); setConfirmDisconnect(false); }}>Xác nhận ngắt</button><button type="button" className="btn secondary" onClick={() => setConfirmDisconnect(false)}>Giữ kết nối</button></>}
      {youtube.connection?.connecting && <button type="button" className="btn secondary" onClick={youtube.disconnect} disabled={youtube.busy}>Hủy kết nối</button>}
      {url && <a className="btn secondary" href={url} target="_blank" rel="noopener noreferrer">Mở Google để cấp quyền</a>}
      <button type="button" className="btn secondary" onClick={youtube.refresh} disabled={youtube.busy}>Kiểm tra lại</button>
    </div>}
    {youtube.error && <p className="youtube-error" role="alert">{youtube.error}</p>}
    <small>Quyền YouTube được cấp riêng với Gemini và lưu mã hóa trên máy Windows này.</small>
  </section>;
}
