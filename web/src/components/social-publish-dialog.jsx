"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { youtubeRequest } from "../lib/youtube-client";
import { createClient } from "../lib/supabase/client";
import { recordChannelActivity } from "../lib/channel-activity";

const labels = { facebook: "Facebook Page", tiktok: "TikTok" };
const videoIdentity = item => ({
  video_id: item.video_id || item.platform_video_id,
  channel: item.channel || item.channel_key || "default",
  mode: item.mode || "subtitle",
});

async function signedInAccount() {
  const { data } = await createClient().auth.getSession();
  const id = data.session?.user?.id;
  if (!id) throw new Error("Hãy đăng nhập ReupAI trước khi gửi bài.");
  return id;
}

export function SocialPublishDialog({ client, item, initialProvider = "facebook", onProviderChange, platformTabs, onClose }) {
  const dialog = useRef(null);
  const live = useRef(false);
  const requestId = useRef(null);
  const [provider, setProvider] = useState(initialProvider === "tiktok" ? "tiktok" : "facebook");
  const [token, setToken] = useState("");
  const [target, setTarget] = useState(null);
  const [message, setMessage] = useState(item.title || "");
  const [includeVideo, setIncludeVideo] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [oauthConfig, setOauthConfig] = useState({ facebook: false, tiktok: false, redirectUri: "" });
  const [fbPages, setFbPages] = useState([]);
  const working = busy || job?.state === "uploading";
  const supported = Boolean(client.health?.capabilities?.social_publish);
  const label = labels[provider];
  const endpoint = `social/${provider}`;

  useEffect(() => {
    fetch("/api/social/oauth/config", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data && live.current) setOauthConfig(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (initialProvider !== "facebook" && initialProvider !== "tiktok") return;
    setProvider((prev) => {
      if (prev === initialProvider) return prev;
      setToken("");
      setFbPages([]);
      setTarget(null);
      setConfirmed(false);
      setJob(null);
      setError("");
      requestId.current = null;
      return initialProvider;
    });
  }, [initialProvider]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(`reupai:social-saved:${provider}`) || "null");
      if (saved?.token) {
        setToken(saved.token);
        if (saved.target?.id) setTarget(saved.target);
        if (Array.isArray(saved.pages)) setFbPages(saved.pages);
      }
    } catch {}
  }, [provider]);

  useEffect(() => {
    const onMessage = async (event) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== "reupai:social-oauth") return;
      if (data.error) { setError(data.error); return; }
      try {
        const accountId = await signedInAccount();
        if (data.provider === "facebook" && Array.isArray(data.pages) && data.pages.length) {
          const first = data.pages[0];
          const nextTarget = { id: first.id, name: first.name, accountId };
          setFbPages(data.pages);
          setToken(first.token);
          setTarget(nextTarget);
          setError("");
          try {
            window.localStorage.setItem("reupai:social-saved:facebook", JSON.stringify({ token: first.token, target: nextTarget, pages: data.pages }));
            window.dispatchEvent(new CustomEvent("reupai:social-updated", { detail: { provider: "facebook" } }));
          } catch {}
        } else if (data.provider === "tiktok" && data.token && data.target) {
          const nextTarget = { ...data.target, accountId };
          setToken(data.token);
          setTarget(nextTarget);
          setError("");
          try {
            window.localStorage.setItem("reupai:social-saved:tiktok", JSON.stringify({ token: data.token, target: nextTarget }));
            window.dispatchEvent(new CustomEvent("reupai:social-updated", { detail: { provider: "tiktok" } }));
          } catch {}
        }
      } catch (err) {
        setError(err?.message || "Chưa xác minh được tài khoản ReupAI.");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (target && (job?.state === "sent" || job?.state === "complete")) {
      recordChannelActivity(target.accountId, provider, target, job.id);
    }
  }, [job?.id, job?.state, provider, target]);

  useEffect(() => {
    live.current = true;
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => { live.current = false; element?.close(); previous?.focus?.({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    if (job?.state !== "uploading") return;
    let active = true;
    let timer;
    const poll = async () => {
      try {
        const result = await youtubeRequest(client, `${endpoint}/publish/${job.id}`);
        if (!active) return;
        setJob(result);
        setError("");
        if (result.state !== "uploading") return;
      } catch (failure) {
        if (!active) return;
        setError(failure.status === 404 ? "Engine đã khởi động lại. Hãy kiểm tra kết quả trên nền tảng trước khi gửi lại." : failure.message);
        if (failure.status === 404) { setJob({ state: "unknown", id: job.id }); return; }
      }
      timer = setTimeout(poll, 2500);
    };
    timer = setTimeout(poll, 1200);
    return () => { active = false; clearTimeout(timer); };
  }, [client, endpoint, job?.id, job?.state]);

  const resetTarget = () => {
    setTarget(null); setConfirmed(false); setJob(null); setError("");
    requestId.current = null;
  };
  const checkDestination = async () => {
    setBusy(true); setError(""); setConfirmed(false); setTarget(null);
    try {
      const accountId = await signedInAccount();
      const result = await youtubeRequest(client, `${endpoint}/destination`, { method: "POST", body: JSON.stringify({ token: token.trim() }) });
      if (live.current) {
        const nextTarget = { ...result, accountId };
        setTarget(nextTarget);
        try {
          window.localStorage.setItem(`reupai:social-saved:${provider}`, JSON.stringify({ token: token.trim(), target: nextTarget, pages: fbPages }));
          window.dispatchEvent(new CustomEvent("reupai:social-updated", { detail: { provider } }));
        } catch {}
        recordChannelActivity(accountId, provider, result);
      }
    } catch (failure) { if (live.current) setError(failure.message); }
    finally { if (live.current) setBusy(false); }
  };
  const suggestCaption = async () => {
    setBusy(true); setError(""); setConfirmed(false);
    try {
      const account_id = await signedInAccount();
      const result = await youtubeRequest(client, "suggest", { method: "POST", timeoutMs: 100000, body: JSON.stringify({
        ...videoIdentity(item), account_id, title: item.title, instructions: "Viết nội dung bài Facebook Page bằng tiếng Việt trong description. Mở đầu ngắn, bám sát video, tối đa ba hashtag có liên quan.",
      }) });
      if (live.current && result.description) setMessage(result.description);
    } catch (failure) { if (live.current) setError(failure.message); }
    finally { if (live.current) setBusy(false); }
  };
  const publish = async event => {
    event.preventDefault();
    if (!target || !confirmed || working || job) return;
    requestId.current ||= crypto.randomUUID();
    setBusy(true); setError("");
    try {
      const accountId = await signedInAccount();
      if (target.accountId !== accountId) throw new Error("Tài khoản ReupAI đã đổi. Hãy mở lại cửa sổ đăng.");
      const result = await youtubeRequest(client, `${endpoint}/publish`, {
        method: "POST", body: JSON.stringify({
          token: token.trim(), target_id: target.id, request_id: requestId.current, confirmed: true, account_id: accountId,
          ...videoIdentity(item), include_video: provider === "tiktok" || includeVideo, message,
        }),
      });
      if (live.current) { setJob(result); setToken(""); }
    } catch (failure) {
      if (live.current) setError(failure.message);
      try {
        const result = await youtubeRequest(client, `${endpoint}/publish/${requestId.current}`);
        if (live.current) { setJob(result); setToken(""); setError(""); }
      } catch { /* Keep the same request ID if the user retries. */ }
    } finally { if (live.current) setBusy(false); }
  };

  if (typeof document === "undefined") return null;
  return createPortal(<dialog ref={dialog} className="youtube-publish-dialog social-publish-dialog" aria-labelledby="social-publish-title" onCancel={event => { if (working) event.preventDefault(); else onClose(); }}>
    <form onSubmit={publish}>
      <header><div><h2 id="social-publish-title">{platformTabs ? "Đăng lên nền tảng liên kết" : "Đăng lên mạng xã hội"}</h2><p>{item.title || item.video_id}</p></div><button type="button" className="btn secondary" onClick={onClose} disabled={working}>Đóng</button></header>
      <div className="youtube-publish-body">
        {platformTabs}
        {!supported ? <p>Cần <a href="/api/engine/download">Local Engine 0.2.53</a> để gửi video lên TikTok hoặc đăng Facebook Page.</p> : <>
          {error && <p role="alert" className="youtube-error">{error}</p>}
          {job ? <section className="youtube-upload-status" role="status">
            <strong>{job.state === "uploading" ? `Đang gửi tới ${label}` : job.state === "sent" ? "TikTok đã nhận video" : job.state === "complete" ? "Facebook đã nhận bài" : "Chưa hoàn tất"}</strong>
            {job.state === "uploading" && <progress aria-label="Tiến độ gửi" value={job.percent || undefined} max="100" />}
            {job.state === "sent" && <p>Mở thông báo/hộp thư TikTok để chỉnh và đăng video sau khi TikTok xử lý xong.</p>}
            {job.error && <p>{job.error}</p>}
            {job.url && <a href={job.url} target="_blank" rel="noopener noreferrer">Mở bài trên Facebook</a>}
          </section> : <fieldset disabled={working} className="youtube-publish-fields">
            {!platformTabs && <div className="library-actions" aria-label="Nền tảng đăng">{Object.entries(labels).map(([key, name]) => <button type="button" key={key} aria-pressed={key === provider} className={`btn ${key === provider ? "primary" : "secondary"}`} onClick={() => { if (key !== provider) { setProvider(key); setToken(""); setFbPages([]); resetTarget(); onProviderChange?.(key); } }}>{name}</button>)}</div>}
            <section className="youtube-ai-draft">
              <div className="library-actions" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn primary"
                  disabled={!oauthConfig[provider]}
                  onClick={() => {
                    setError("");
                    window.open(`/api/social/oauth/start?provider=${provider}`, "reupai_social_oauth", "width=560,height=700");
                  }}
                >
                  {oauthConfig[provider] ? `Kết nối tự động ${label}` : `Tự liên kết ${label} (cần cấu hình App)`}
                </button>
                {token && (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => {
                      setToken("");
                      setFbPages([]);
                      resetTarget();
                      try {
                        window.localStorage.removeItem(`reupai:social-saved:${provider}`);
                        window.dispatchEvent(new CustomEvent("reupai:social-updated", { detail: { provider } }));
                      } catch {}
                    }}
                  >
                    Ngắt kết nối
                  </button>
                )}
              </div>
              {!oauthConfig[provider] && (
                <small>
                  Để bật kết nối 1 chạm, thêm <code>{provider === "facebook" ? "META_APP_ID & META_APP_SECRET" : "TIKTOK_CLIENT_KEY & TIKTOK_CLIENT_SECRET"}</code> trên server và gắn Redirect URI: <code>{oauthConfig.redirectUri || "/api/social/oauth/callback"}</code>. Hoặc dán token thủ công bên dưới (được lưu lại trên máy):
                </small>
              )}
              {provider === "facebook" && fbPages.length > 1 && (
                <label>Chọn Fanpage muốn đăng
                  <select
                    value={target?.id || ""}
                    onChange={async (e) => {
                      const picked = fbPages.find((p) => p.id === e.target.value);
                      if (!picked) return;
                      const accountId = await signedInAccount().catch(() => target?.accountId || "");
                      const nextTarget = { id: picked.id, name: picked.name, accountId };
                      setToken(picked.token);
                      setTarget(nextTarget);
                      setConfirmed(false);
                      try { window.localStorage.setItem("reupai:social-saved:facebook", JSON.stringify({ token: picked.token, target: nextTarget, pages: fbPages })); } catch {}
                    }}
                  >
                    {fbPages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              )}
              <label>{provider === "facebook" ? "Page access token" : "TikTok access token"}<input type="password" autoComplete="off" spellCheck={false} value={token} maxLength={4096} onChange={event => { setToken(event.target.value); resetTarget(); }} /></label>
              <small>{provider === "facebook" ? "Dùng token của trang có quyền đăng bài." : "Dùng token được cấp quyền video.upload và user.info.basic."}</small>
              <button type="button" className="btn secondary" disabled={!token.trim()} onClick={checkDestination}>Kiểm tra tài khoản đích</button>
            </section>
            {target && <div className="youtube-publish-target"><span>TÀI KHOẢN ĐÍCH</span><strong>{target.name}</strong></div>}
            {provider === "facebook" ? <><label>Nội dung bài<textarea rows={4} value={message} maxLength={5000} onChange={event => { setMessage(event.target.value); setConfirmed(false); }} /></label><div className="library-actions"><button type="button" className="btn secondary" onClick={suggestCaption}>AI gợi ý bài Facebook</button></div><label className="youtube-publish-confirm"><input type="checkbox" checked={includeVideo} onChange={event => { setIncludeVideo(event.target.checked); setConfirmed(false); }} />Đính kèm video thành phẩm</label></> : <p>Video được gửi vào TikTok để bạn hoàn tất bài đăng trong ứng dụng.</p>}
            {target && <label className="youtube-publish-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{provider === "facebook" ? `Tôi đồng ý đăng lên ${target.name}.` : `Tôi đồng ý gửi video tới ${target.name}.`}</label>}
          </fieldset>}
        </>}
      </div>
      {supported && !job && <footer><button type="submit" className="btn primary" disabled={working || !confirmed || !target || (provider === "facebook" && !includeVideo && !message.trim())}>{provider === "facebook" ? "Xác nhận đăng Facebook" : "Gửi bản nháp TikTok"}</button></footer>}
    </form>
  </dialog>, document.body);
}
