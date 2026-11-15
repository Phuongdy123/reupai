"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { youtubeRequest } from "../lib/youtube-client";
import { createClient } from "../lib/supabase/client";
import { recordChannelActivity } from "../lib/channel-activity";

const labels = { facebook: "Facebook Page", tiktok: "TikTok" };
const videoIdentity = item => ({
  video_id: item.video_id || item.platform_video_id,
  channel: item.channel || item.channel_key || "2d_animation",
  mode: item.mode || "subtitle",
});

async function signedInAccount() {
  const { data } = await createClient().auth.getSession();
  const id = data.session?.user?.id;
  if (!id) throw new Error("Hãy đăng nhập ReupAI trước khi gửi bài.");
  return id;
}

export function SocialPublishDialog({ client, item, onClose }) {
  const dialog = useRef(null);
  const live = useRef(false);
  const requestId = useRef(null);
  const [provider, setProvider] = useState("facebook");
  const [token, setToken] = useState("");
  const [target, setTarget] = useState(null);
  const [message, setMessage] = useState(item.title || "");
  const [includeVideo, setIncludeVideo] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const working = busy || job?.state === "uploading";
  const supported = Boolean(client.health?.capabilities?.social_publish);
  const label = labels[provider];
  const endpoint = `social/${provider}`;

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
        setTarget({ ...result, accountId });
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
      <header><div><h2 id="social-publish-title">Đăng lên mạng xã hội</h2><p>{item.title || item.video_id}</p></div><button type="button" className="btn secondary" onClick={onClose} disabled={working}>Đóng</button></header>
      <div className="youtube-publish-body">
        {!supported ? <p>Cần <a href="/api/engine/download">Local Engine 0.2.53</a> để gửi video lên TikTok hoặc đăng Facebook Page.</p> : <>
          {error && <p role="alert" className="youtube-error">{error}</p>}
          {job ? <section className="youtube-upload-status" role="status">
            <strong>{job.state === "uploading" ? `Đang gửi tới ${label}` : job.state === "sent" ? "TikTok đã nhận video" : job.state === "complete" ? "Facebook đã nhận bài" : "Chưa hoàn tất"}</strong>
            {job.state === "uploading" && <progress aria-label="Tiến độ gửi" value={job.percent || undefined} max="100" />}
            {job.state === "sent" && <p>Mở thông báo/hộp thư TikTok để chỉnh và đăng video sau khi TikTok xử lý xong.</p>}
            {job.error && <p>{job.error}</p>}
            {job.url && <a href={job.url} target="_blank" rel="noopener noreferrer">Mở bài trên Facebook</a>}
          </section> : <fieldset disabled={working} className="youtube-publish-fields">
            <div className="library-actions" aria-label="Nền tảng đăng">{Object.entries(labels).map(([key, name]) => <button type="button" key={key} aria-pressed={key === provider} className={`btn ${key === provider ? "primary" : "secondary"}`} onClick={() => { if (key !== provider) { setProvider(key); setToken(""); resetTarget(); } }}>{name}</button>)}</div>
            <section className="youtube-ai-draft">
              <label>{provider === "facebook" ? "Page access token" : "TikTok access token"}<input type="password" autoComplete="off" spellCheck={false} value={token} maxLength={4096} onChange={event => { setToken(event.target.value); resetTarget(); }} /></label>
              <small>{provider === "facebook" ? "Dùng token của trang có quyền đăng bài." : "Dùng token được cấp quyền video.upload và user.info.basic."} Token dùng cho phiên hiện tại.</small>
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
