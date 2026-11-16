"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "../lib/supabase/client";
import { YoutubePublishDialog } from "./youtube-publish-dialog";
import { SocialPublishDialog } from "./social-publish-dialog";

export const PLATFORM_ORDER = ["youtube", "facebook", "tiktok"];

export const PLATFORM_META = {
  youtube: { key: "youtube", label: "YouTube", fullLabel: "YouTube" },
  facebook: { key: "facebook", label: "Facebook", fullLabel: "Facebook Page" },
  tiktok: { key: "tiktok", label: "TikTok", fullLabel: "TikTok" },
};

const SOCIAL_STORAGE_PREFIX = "reupai:social-saved:";
const SOCIAL_EVENT = "reupai:social-updated";

export function readSavedSocial(provider) {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.localStorage.getItem(`${SOCIAL_STORAGE_PREFIX}${provider}`) || "null");
  } catch {
    return null;
  }
}

export function writeSavedSocial(provider, value) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(`${SOCIAL_STORAGE_PREFIX}${provider}`, JSON.stringify(value));
    else window.localStorage.removeItem(`${SOCIAL_STORAGE_PREFIX}${provider}`);
  } catch {}
  window.dispatchEvent(new CustomEvent(SOCIAL_EVENT, { detail: { provider } }));
}

export function PlatformLogoIcon({ platform, size = 16, className = "" }) {
  const cls = `platform-logo-svg is-${platform}${className ? ` ${className}` : ""}`;
  if (platform === "youtube") {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className={cls} aria-hidden="true">
        <rect x="2" y="4.5" width="20" height="15" rx="4.2" fill="#FF0000" />
        <path d="M10 8.8l6 3.2-6 3.2V8.8z" fill="#FFFFFF" />
      </svg>
    );
  }
  if (platform === "facebook") {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className={cls} aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="#1877F2" />
        <path
          d="M13.55 19.8v-6.9h2.3l.35-2.7h-2.65V8.48c0-.78.22-1.32 1.35-1.32h1.43V4.75c-.25-.03-1.1-.1-2.08-.1-2.06 0-3.47 1.26-3.47 3.57V10.2H8.45v2.7h2.33v6.9h2.77z"
          fill="#FFFFFF"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={cls} aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#111827" />
      <path
        d="M15.65 6.45a4.2 4.2 0 0 0 2.7 1.02v2.2a6.3 6.3 0 0 1-2.7-.64v4.77a4.65 4.65 0 1 1-4.65-4.65c.26 0 .51.02.75.07v2.3a2.35 2.35 0 1 0 1.65 2.24V5.2h2.25v1.25z"
        fill="#25F4EE"
        transform="translate(-0.55 -0.35)"
      />
      <path
        d="M15.65 6.45a4.2 4.2 0 0 0 2.7 1.02v2.2a6.3 6.3 0 0 1-2.7-.64v4.77a4.65 4.65 0 1 1-4.65-4.65c.26 0 .51.02.75.07v2.3a2.35 2.35 0 1 0 1.65 2.24V5.2h2.25v1.25z"
        fill="#FE2C55"
        transform="translate(0.55 0.35)"
      />
      <path
        d="M15.65 6.45a4.2 4.2 0 0 0 2.7 1.02v2.2a6.3 6.3 0 0 1-2.7-.64v4.77a4.65 4.65 0 1 1-4.65-4.65c.26 0 .51.02.75.07v2.3a2.35 2.35 0 1 0 1.65 2.24V5.2h2.25v1.25z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

export function ThreePlatformIcons({ size = 14, className = "" }) {
  return (
    <span className={`three-platform-icons${className ? ` ${className}` : ""}`} aria-hidden="true">
      {PLATFORM_ORDER.map((platform) => (
        <PlatformLogoIcon key={platform} platform={platform} size={size} />
      ))}
    </span>
  );
}

export function useSocialConnections(enabled = true) {
  const [saved, setSaved] = useState({ facebook: null, tiktok: null });
  const [oauth, setOauth] = useState({ facebook: false, tiktok: false, redirectUri: "" });
  const [error, setError] = useState("");

  const syncFromStorage = useCallback(() => {
    setSaved({
      facebook: readSavedSocial("facebook"),
      tiktok: readSavedSocial("tiktok"),
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    syncFromStorage();
    const onSync = () => syncFromStorage();
    window.addEventListener(SOCIAL_EVENT, onSync);
    window.addEventListener("storage", onSync);
    return () => {
      window.removeEventListener(SOCIAL_EVENT, onSync);
      window.removeEventListener("storage", onSync);
    };
  }, [enabled, syncFromStorage]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetch("/api/social/oauth/config", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data && active) setOauth(data); })
      .catch(() => {});
    return () => { active = false; };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onMessage = async (event) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== "reupai:social-oauth") return;
      if (data.error) { setError(data.error); return; }
      try {
        const { data: sessionData } = await createClient().auth.getSession();
        const accountId = sessionData.session?.user?.id;
        if (!accountId) { setError("Hãy đăng nhập ReupAI trước khi liên kết MXH."); return; }
        if (data.provider === "facebook" && Array.isArray(data.pages) && data.pages.length) {
          const first = data.pages[0];
          const nextTarget = { id: first.id, name: first.name, accountId };
          writeSavedSocial("facebook", { token: first.token, target: nextTarget, pages: data.pages });
          setError("");
        } else if (data.provider === "tiktok" && data.token && data.target) {
          const nextTarget = { ...data.target, accountId };
          writeSavedSocial("tiktok", { token: data.token, target: nextTarget });
          setError("");
        }
      } catch (err) {
        setError(err?.message || "Chưa lưu được kết nối MXH.");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [enabled]);

  const connect = useCallback((provider) => {
    setError("");
    if (oauth[provider]) {
      window.open(`/api/social/oauth/start?provider=${provider}`, "reupai_social_oauth", "width=560,height=700");
      return true;
    }
    setError(`${PLATFORM_META[provider]?.fullLabel || provider} chưa cấu hình OAuth 1 chạm trên server.`);
    return false;
  }, [oauth]);

  const disconnect = useCallback((provider) => {
    writeSavedSocial(provider, null);
    setError("");
  }, []);

  const selectFacebookPage = useCallback((page) => {
    const current = readSavedSocial("facebook");
    if (!current || !page?.token) return;
    writeSavedSocial("facebook", {
      ...current,
      token: page.token,
      target: { id: page.id, name: page.name, accountId: current.target?.accountId },
    });
  }, []);

  return {
    facebook: {
      connected: Boolean(saved.facebook?.token),
      token: saved.facebook?.token || "",
      target: saved.facebook?.target || null,
      pages: saved.facebook?.pages || [],
    },
    tiktok: {
      connected: Boolean(saved.tiktok?.token),
      token: saved.tiktok?.token || "",
      target: saved.tiktok?.target || null,
    },
    oauth,
    error,
    setError,
    connect,
    disconnect,
    selectFacebookPage,
  };
}

export function MxhConnectionCompact({ youtube, social, onSelectPlatform, title = "Kết nối MXH", className = "" }) {
  const [selected, setSelected] = useState(null);
  const statusMap = {
    youtube: {
      connected: Boolean(youtube?.connection?.connected),
      name: youtube?.connection?.channel?.title || "",
    },
    facebook: {
      connected: Boolean(social?.facebook?.connected),
      name: social?.facebook?.target?.name || "",
    },
    tiktok: {
      connected: Boolean(social?.tiktok?.connected),
      name: social?.tiktok?.target?.display_name || social?.tiktok?.target?.name || "",
    },
  };
  const linkedCount = PLATFORM_ORDER.filter((p) => statusMap[p].connected).length;
  const activeDetail = selected ? statusMap[selected] : null;

  const handleLogoClick = (platform) => {
    if (onSelectPlatform) onSelectPlatform(platform);
    setSelected((prev) => (prev === platform ? null : platform));
  };

  return (
    <section className={`mxh-connect-bar${linkedCount > 0 ? " has-linked" : ""}${className ? ` ${className}` : ""}`} aria-label={title}>
      <div className="mxh-connect-main">
        <div className="mxh-connect-info">
          <div className="mxh-connect-title">
            <strong>{title}</strong>
            <span className={`mxh-count-badge${linkedCount > 0 ? " is-ready" : ""}`}>
              <span className="mxh-badge-pulse" aria-hidden="true" />
              {linkedCount > 0 ? `${linkedCount}/3 đã liên kết` : "Chưa liên kết"}
            </span>
          </div>
          <p className="mxh-connect-sub">
            {linkedCount === 3
              ? "Tất cả nền tảng đã sẵn sàng · Nhấn vào logo để kiểm tra hoặc đổi tài khoản"
              : "Nhấn vào từng logo để liên kết hoặc quản lý kênh đăng"}
          </p>
        </div>
        <div className="mxh-logo-group">
          {PLATFORM_ORDER.map((platform) => {
            const st = statusMap[platform];
            const meta = PLATFORM_META[platform];
            const tip = st.connected
              ? `${meta.fullLabel}: ${st.name || "Đã liên kết"}`
              : `Kết nối ${meta.fullLabel}`;
            return (
              <button
                key={platform}
                type="button"
                className={`mxh-logo-btn is-${platform}${st.connected ? " is-connected" : ""}${selected === platform ? " is-selected" : ""}`}
                title={tip}
                aria-label={tip}
                aria-pressed={selected === platform}
                onClick={() => handleLogoClick(platform)}
              >
                <PlatformLogoIcon platform={platform} size={20} />
                <span className="mxh-logo-name">{meta.label}</span>
                <span className={`mxh-logo-dot${st.connected ? " is-connected" : ""}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>

      {selected && activeDetail && (
        <div className="mxh-connect-detail">
          <span className="mxh-detail-label">
            <PlatformLogoIcon platform={selected} size={14} />
            <strong>{PLATFORM_META[selected].fullLabel}:</strong>
            <span>{activeDetail.connected ? (activeDetail.name || "Đã liên kết") : "Chưa kết nối"}</span>
          </span>
          <div className="mxh-detail-actions">
            {selected === "youtube" ? (
              youtube?.connection?.connected ? (
                <>
                  <button type="button" className="btn secondary" onClick={youtube.refresh} disabled={youtube.busy}>
                    {youtube.busy ? "Đang kiểm tra…" : "Kiểm tra"}
                  </button>
                  <button type="button" className="btn secondary" onClick={youtube.disconnect} disabled={youtube.busy}>
                    Ngắt kết nối
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn primary"
                  onClick={youtube?.connect}
                  disabled={!youtube?.supported || youtube?.busy || youtube?.connection?.connecting}
                >
                  {youtube?.connection?.connecting ? "Đang chờ Google…" : "Kết nối YouTube"}
                </button>
              )
            ) : activeDetail.connected ? (
              <>
                {selected === "facebook" && social.facebook.pages.length > 1 && (
                  <select
                    aria-label="Chọn Fanpage"
                    value={social.facebook.target?.id || ""}
                    onChange={(e) => {
                      const chosen = social.facebook.pages.find((p) => p.id === e.target.value);
                      if (chosen) social.selectFacebookPage(chosen);
                    }}
                  >
                    {social.facebook.pages.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                )}
                <button type="button" className="btn secondary" onClick={() => social.connect(selected)}>
                  Kết nối lại
                </button>
                <button type="button" className="btn secondary" onClick={() => social.disconnect(selected)}>
                  Ngắt kết nối
                </button>
              </>
            ) : (
              <button type="button" className="btn primary" onClick={() => social?.connect(selected)}>
                {`Kết nối ${PLATFORM_META[selected].label}`}
              </button>
            )}
          </div>
        </div>
      )}

      {(youtube?.error || social?.error) && (
        <p role="alert" className="mxh-connect-error">{youtube?.error || social?.error}</p>
      )}
    </section>
  );
}

function YoutubeConnectPromptDialog({ item, youtube, platformTabs, onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    dialog.current?.showModal();
    return () => prev?.focus?.({ preventScroll: true });
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog ref={dialog} className="youtube-publish-dialog" aria-labelledby="unified-yt-connect-title" onCancel={onClose}>
      <div className="youtube-publish-form">
        <header>
          <div>
            <h2 id="unified-yt-connect-title">Đăng lên nền tảng liên kết</h2>
            <p>{item.title || item.video_id}</p>
          </div>
          <button type="button" className="btn secondary" onClick={onClose}>Đóng</button>
        </header>
        <div className="youtube-publish-body">
          {platformTabs}
          <section className="youtube-ai-draft" style={{ marginTop: 12 }}>
            <strong>Kênh YouTube chưa được liên kết</strong>
            <p className="muted">
              Kết nối kênh YouTube để đăng video trực tiếp, hoặc chuyển sang tab Facebook / TikTok ở trên để đăng ngay.
            </p>
            {youtube?.error && <p role="alert" className="youtube-error">{youtube.error}</p>}
            <div className="library-actions" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn primary"
                onClick={youtube?.connect}
                disabled={!youtube?.supported || youtube?.busy || youtube?.connection?.connecting}
              >
                {youtube?.connection?.connecting ? "Đang chờ Google…" : "Kết nối kênh YouTube"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </dialog>,
    document.body
  );
}

export function UnifiedPublishModal({ client, item, youtube, social, initialPlatform, onClose }) {
  const pickInitial = () => {
    if (initialPlatform && PLATFORM_ORDER.includes(initialPlatform)) return initialPlatform;
    if (youtube?.connection?.connected) return "youtube";
    if (social?.facebook?.connected) return "facebook";
    if (social?.tiktok?.connected) return "tiktok";
    return "youtube";
  };
  const [platform, setPlatform] = useState(pickInitial);

  const isConnected = {
    youtube: Boolean(youtube?.connection?.connected),
    facebook: Boolean(social?.facebook?.connected),
    tiktok: Boolean(social?.tiktok?.connected),
  };

  const platformTabs = (
    <div className="unified-platform-tabs" role="tablist" aria-label="Chọn nền tảng đăng">
      {PLATFORM_ORDER.map((p) => {
        const meta = PLATFORM_META[p];
        const active = platform === p;
        return (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={active}
            className={`unified-platform-tab${active ? " is-active" : ""}${isConnected[p] ? " is-connected" : ""}`}
            onClick={() => setPlatform(p)}
          >
            <PlatformLogoIcon platform={p} size={16} />
            <span>{meta.label}</span>
            <span className={`mxh-logo-dot${isConnected[p] ? " is-connected" : ""}`} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );

  if (platform === "youtube") {
    if (youtube?.connection?.connected) {
      return (
        <YoutubePublishDialog
          client={client}
          item={item}
          connection={youtube.connection}
          platformTabs={platformTabs}
          onClose={onClose}
        />
      );
    }
    return (
      <YoutubeConnectPromptDialog
        item={item}
        youtube={youtube}
        platformTabs={platformTabs}
        onClose={onClose}
      />
    );
  }

  return (
    <SocialPublishDialog
      client={client}
      item={item}
      initialProvider={platform}
      onProviderChange={setPlatform}
      platformTabs={platformTabs}
      onClose={onClose}
    />
  );
}
