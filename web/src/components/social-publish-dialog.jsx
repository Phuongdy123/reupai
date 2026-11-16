"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { youtubeRequest } from "../lib/youtube-client";
import { createClient } from "../lib/supabase/client";
import { recordChannelActivity } from "../lib/channel-activity";
import { Icon } from "./icon";

const labels = { facebook: "Facebook Page", tiktok: "TikTok" };
const videoIdentity = (item) => ({
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

export function SocialPublishDialog({
  client,
  item,
  initialProvider = "facebook",
  onProviderChange,
  platformTabs,
  onClose,
}) {
  const dialog = useRef(null);
  const live = useRef(false);
  const requestId = useRef(null);
  const [provider, setProvider] = useState(initialProvider === "tiktok" ? "tiktok" : "facebook");
  const [token, setToken] = useState("");
  const [target, setTarget] = useState(null);
  const [fbPages, setFbPages] = useState([]);
  const [message, setMessage] = useState(item.title || "");
  const [instructions, setInstructions] = useState("");
  const [includeVideo, setIncludeVideo] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState("");
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showConnectionEdit, setShowConnectionEdit] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [oauthConfig, setOauthConfig] = useState({ facebook: false, tiktok: false, redirectUri: "" });

  const working = Boolean(busy) || job?.state === "uploading";
  const supported = Boolean(client.health?.capabilities?.social_publish);
  const label = labels[provider];
  const endpoint = `social/${provider}`;
  const hasSavedAuth = Boolean(token && target);

  useEffect(() => {
    let active = true;
    const vid = item.video_id || item.platform_video_id;
    client
      .mediaUrl(`/api/stream/${encodeURIComponent(vid)}?channel=${encodeURIComponent(item.channel || item.channel_key || "default")}&mode=${encodeURIComponent(item.mode || "subtitle")}`)
      .then((url) => { if (active) setPreviewUrl(url); })
      .catch(() => {});
    return () => { active = false; };
  }, [client, item.channel, item.channel_key, item.mode, item.platform_video_id, item.video_id]);

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
      setShowConnectionEdit(false);
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
        setShowConnectionEdit(false);
      } else {
        setToken("");
        setTarget(null);
        setFbPages([]);
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
          setShowConnectionEdit(false);
          setError("");
          try {
            window.localStorage.setItem("reupai:social-saved:facebook", JSON.stringify({ token: first.token, target: nextTarget, pages: data.pages }));
            window.dispatchEvent(new CustomEvent("reupai:social-updated", { detail: { provider: "facebook" } }));
          } catch {}
        } else if (data.provider === "tiktok" && data.token && data.target) {
          const nextTarget = { ...data.target, accountId };
          setToken(data.token);
          setTarget(nextTarget);
          setShowConnectionEdit(false);
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
    setBusy("check"); setError(""); setConfirmed(false); setTarget(null);
    try {
      const accountId = await signedInAccount();
      const result = await youtubeRequest(client, `${endpoint}/destination`, { method: "POST", body: JSON.stringify({ token: token.trim() }) });
      if (live.current) {
        const nextTarget = { ...result, accountId };
        setTarget(nextTarget);
        setShowConnectionEdit(false);
        try {
          window.localStorage.setItem(`reupai:social-saved:${provider}`, JSON.stringify({ token: token.trim(), target: nextTarget, pages: fbPages }));
          window.dispatchEvent(new CustomEvent("reupai:social-updated", { detail: { provider } }));
        } catch {}
        recordChannelActivity(accountId, provider, result);
      }
    } catch (failure) { if (live.current) setError(failure.message); }
    finally { if (live.current) setBusy(""); }
  };

  const suggestCaption = async () => {
    setBusy("ai"); setError(""); setConfirmed(false);
    try {
      const account_id = await signedInAccount();
      const basePrompt = provider === "facebook"
        ? "Viết bài đăng Facebook Page tự nhiên bằng tiếng Việt trong description. Mở đầu thu hút, bám sát video, tối đa 3 hashtag."
        : "Viết caption ngắn gọn cho video TikTok bằng tiếng Việt trong description, kèm 3-5 hashtag phù hợp.";
      const promptText = instructions.trim() ? `${basePrompt} Yêu cầu thêm: ${instructions.trim()}` : basePrompt;
      const result = await youtubeRequest(client, "suggest", {
        method: "POST",
        timeoutMs: 100000,
        body: JSON.stringify({
          ...videoIdentity(item),
          account_id,
          title: item.title,
          instructions: promptText,
        }),
      });
      if (live.current && result.description) setMessage(result.description);
    } catch (failure) { if (live.current) setError(failure.message); }
    finally { if (live.current) setBusy(""); }
  };

  const publish = async (event) => {
    event.preventDefault();
    if (working || !confirmed || !token.trim() || !target?.id) return;
    requestId.current ||= crypto.randomUUID();
    setBusy("upload"); setError("");
    try {
      const accountId = await signedInAccount();
      if (target.accountId && target.accountId !== accountId) throw new Error("Tài khoản ReupAI đã đổi. Hãy mở lại cửa sổ đăng.");
      const result = await youtubeRequest(client, `${endpoint}/publish`, {
        method: "POST",
        body: JSON.stringify({
          token: token.trim(),
          target_id: target.id,
          request_id: requestId.current,
          confirmed: true,
          account_id: accountId,
          ...videoIdentity(item),
          include_video: provider === "tiktok" || includeVideo,
          message,
        }),
      });
      if (live.current) setJob(result);
    } catch (failure) {
      if (live.current) setError(failure.message);
      try {
        const result = await youtubeRequest(client, `${endpoint}/publish/${requestId.current}`);
        if (live.current) { setJob(result); setError(""); }
      } catch {}
    } finally { if (live.current) setBusy(""); }
  };

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message || "");
      setCopied(true);
      setTimeout(() => { if (live.current) setCopied(false); }, 1800);
    } catch {}
  };

  if (typeof document === "undefined") return null;

  const targetName = target?.name || target?.display_name || "Chưa chọn kênh đích";

  return createPortal(
    <dialog
      ref={dialog}
      className="youtube-publish-dialog social-publish-dialog"
      aria-labelledby="social-publish-title"
      onCancel={(event) => { if (working) event.preventDefault(); else onClose(); }}
    >
      <form onSubmit={publish}>
        <header>
          <div>
            <small>ĐĂNG THÀNH PHẨM</small>
            <h2 id="social-publish-title">{platformTabs ? "Đăng lên nền tảng liên kết" : `Đăng lên ${label}`}</h2>
            <p>
              {target ? <>Đích đăng: <strong>{targetName}</strong></> : (item.title || item.video_id)}
            </p>
          </div>
          <button type="button" className="modern-icon-btn" onClick={onClose} disabled={working} aria-label="Đóng">×</button>
        </header>

        <div className="youtube-publish-workspace">
          <aside className="youtube-publish-preview">
            <small>VIDEO SẮP ĐĂNG</small>
            <div className="youtube-publish-stage">
              {previewUrl
                ? <video crossOrigin="anonymous" src={previewUrl} controls playsInline />
                : <p>Chưa mở được bản xem trước. Bạn vẫn có thể chuẩn bị nội dung đăng.</p>}
            </div>
            <strong>{item.title || item.video_id}</strong>
            <div className="youtube-publish-target">
              <span>{provider === "facebook" ? "ĐĂNG LÊN FANPAGE" : "GỬI TỚI TIKTOK"}</span>
              <strong>{targetName}</strong>
              <p>
                {provider === "facebook"
                  ? (includeVideo ? "Đăng video thành phẩm lên Facebook Page" : "Chỉ đăng nội dung bài viết (không kèm video)")
                  : "Gửi video vào hộp thư TikTok để bạn duyệt và bấm đăng"}
              </p>
            </div>
          </aside>

          <div className="youtube-publish-body">
            {platformTabs}
            {!supported ? (
              <p>Cần <a href="/api/engine/download">Local Engine 0.2.53</a> trở lên để gửi video lên TikTok hoặc đăng Facebook Page.</p>
            ) : (
              <>
                <p className="muted">AI hỗ trợ soạn caption. Bạn kiểm tra và xác nhận trước khi gửi lên {label}.</p>
                {error && <p role="alert" className="youtube-error">{error}</p>}

                {job ? (
                  <section className="youtube-upload-status" role="status">
                    <strong>
                      {job.state === "uploading"
                        ? `Đang gửi tới ${label}`
                        : job.state === "sent"
                          ? "TikTok đã nhận video"
                          : job.state === "complete"
                            ? "Facebook đã nhận bài"
                            : "Chưa hoàn tất"}
                    </strong>
                    {job.state === "uploading" && <progress aria-label="Tiến độ gửi" value={job.percent || undefined} max="100" />}
                    {job.state === "sent" && <p>Mở thông báo / hộp thư TikTok để dán caption (nếu cần) và bấm Đăng video.</p>}
                    {job.error && <p>{job.error}</p>}
                    {job.url && <a href={job.url} target="_blank" rel="noopener noreferrer">Mở bài trên Facebook ↗</a>}
                  </section>
                ) : (
                  <fieldset disabled={working} className="youtube-publish-fields">
                    {!platformTabs && (
                      <div className="library-actions" aria-label="Nền tảng đăng">
                        {Object.entries(labels).map(([key, name]) => (
                          <button
                            type="button"
                            key={key}
                            aria-pressed={key === provider}
                            className={`btn ${key === provider ? "primary" : "secondary"}`}
                            onClick={() => {
                              if (key !== provider) {
                                setProvider(key);
                                resetTarget();
                                onProviderChange?.(key);
                              }
                            }}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Connected channel summary or connection setup */}
                    {hasSavedAuth && !showConnectionEdit ? (
                      <div className="social-connected-strip">
                        <div className="social-connected-meta">
                          <span className="social-connected-badge">Đã liên kết {label}</span>
                          <strong>{targetName}</strong>
                        </div>
                        <div className="library-actions">
                          {provider === "facebook" && fbPages.length > 1 && (
                            <select
                              aria-label="Chọn Fanpage"
                              value={target?.id || ""}
                              onChange={async (e) => {
                                const picked = fbPages.find((p) => p.id === e.target.value);
                                if (!picked) return;
                                const accountId = await signedInAccount().catch(() => target?.accountId || "");
                                const nextTarget = { id: picked.id, name: picked.name, accountId };
                                setToken(picked.token);
                                setTarget(nextTarget);
                                setConfirmed(false);
                                try {
                                  window.localStorage.setItem("reupai:social-saved:facebook", JSON.stringify({ token: picked.token, target: nextTarget, pages: fbPages }));
                                  window.dispatchEvent(new CustomEvent("reupai:social-updated", { detail: { provider: "facebook" } }));
                                } catch {}
                              }}
                            >
                              {fbPages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          )}
                          <button type="button" className="btn secondary" onClick={() => setShowConnectionEdit(true)}>
                            Đổi kết nối
                          </button>
                        </div>
                      </div>
                    ) : (
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
                            {oauthConfig[provider] ? `Kết nối ${label}` : `Liên kết ${label} (cần cấu hình App)`}
                          </button>
                          <div className="library-actions">
                            {hasSavedAuth && (
                              <button type="button" className="btn secondary" onClick={() => setShowConnectionEdit(false)}>
                                Quay lại đăng bài
                              </button>
                            )}
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
                        </div>
                        {!oauthConfig[provider] && (
                          <small>
                            Cấu hình <code>{provider === "facebook" ? "META_APP_ID & META_APP_SECRET" : "TIKTOK_CLIENT_KEY & TIKTOK_CLIENT_SECRET"}</code> để bật OAuth 1 chạm, hoặc dán token thủ công bên dưới:
                          </small>
                        )}
                        <label>
                          {provider === "facebook" ? "Page access token" : "TikTok access token"}
                          <input
                            type="password"
                            autoComplete="off"
                            spellCheck={false}
                            value={token}
                            maxLength={4096}
                            onChange={(event) => { setToken(event.target.value); resetTarget(); }}
                          />
                        </label>
                        <button type="button" className="btn secondary" disabled={!token.trim() || busy === "check"} onClick={checkDestination}>
                          {busy === "check" ? "Đang kiểm tra…" : "Kiểm tra & lưu kênh"}
                        </button>
                      </section>
                    )}

                    {/* AI caption / draft section - unified with YouTube style */}
                    <section className="youtube-ai-draft">
                      <label>
                        Yêu cầu cho AI (tùy chọn)
                        <input
                          value={instructions}
                          onChange={(e) => setInstructions(e.target.value)}
                          placeholder={provider === "facebook" ? "Ví dụ: Viết caption cuốn hút, thêm 3 hashtag" : "Ví dụ: Caption ngắn 1-2 dòng + hashtag xu hướng"}
                          maxLength={1000}
                        />
                      </label>
                      <div className="library-actions">
                        <button type="button" className="btn secondary" onClick={suggestCaption} disabled={busy === "ai"}>
                          <Icon name="sparkles" size={16} />
                          {busy === "ai" ? "AI đang soạn…" : `AI gợi ý nội dung ${label}`}
                        </button>
                        {provider === "tiktok" && message.trim() && (
                          <button type="button" className="btn secondary" onClick={copyMessage}>
                            {copied ? "Đã sao chép ✓" : "Sao chép caption"}
                          </button>
                        )}
                      </div>
                    </section>

                    {provider === "facebook" ? (
                      <>
                        <label>
                          Nội dung bài viết &amp; hashtag <small>{message.length}/5000</small>
                          <textarea
                            rows={6}
                            value={message}
                            maxLength={5000}
                            onChange={(event) => { setMessage(event.target.value); setConfirmed(false); }}
                            placeholder="Nhập nội dung bài đăng Facebook Page..."
                          />
                        </label>
                        <label className="youtube-publish-confirm">
                          <input
                            type="checkbox"
                            checked={includeVideo}
                            onChange={(event) => { setIncludeVideo(event.target.checked); setConfirmed(false); }}
                          />
                          Đính kèm video thành phẩm khi đăng lên Fanpage
                        </label>
                      </>
                    ) : (
                      <>
                        <label>
                          Caption gợi ý (TikTok nhận file vào Hộp thư để bạn bấm Đăng) <small>{message.length}/2200</small>
                          <textarea
                            rows={4}
                            value={message}
                            maxLength={2200}
                            onChange={(event) => setMessage(event.target.value)}
                            placeholder="Dùng AI gợi ý hoặc nhập sẵn caption để copy nhanh khi mở ứng dụng TikTok..."
                          />
                        </label>
                      </>
                    )}

                    {target && (
                      <label className="youtube-publish-confirm">
                        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                        {provider === "facebook"
                          ? `Tôi đã kiểm tra video và nội dung, đồng ý đăng lên Fanpage ${targetName}.`
                          : `Tôi đã kiểm tra video, đồng ý gửi bản nháp tới tài khoản TikTok ${targetName}.`}
                      </label>
                    )}
                  </fieldset>
                )}
              </>
            )}
          </div>
        </div>

        <footer>
          <button type="button" className="btn secondary" onClick={onClose} disabled={working}>Đóng</button>
          {supported && !job && (
            <button
              type="submit"
              className="btn primary"
              disabled={working || !confirmed || !target || (provider === "facebook" && !includeVideo && !message.trim())}
            >
              {busy === "upload"
                ? "Đang gửi…"
                : provider === "facebook"
                  ? "Xác nhận đăng Facebook"
                  : "Gửi video lên TikTok"}
            </button>
          )}
        </footer>
      </form>
    </dialog>,
    document.body
  );
}
