"use client";

import { useState } from "react";
import { useYoutubeConnection } from "./youtube-connection";
import { googleConsentUrl } from "../lib/youtube-client";
import { MxhConnectionCompact, ThreePlatformIcons, UnifiedPublishModal, useSocialConnections } from "./social-platforms";

export function OutputYoutubeActions({ item, hasChanges = false }) {
  const youtube = useYoutubeConnection();
  const social = useSocialConnections();
  const [publishing, setPublishing] = useState(false);
  const url = googleConsentUrl(youtube.connection?.authorization_url);
  return (
    <section className="output-youtube-actions">
      <MxhConnectionCompact youtube={youtube} social={social} />
      <div className="library-actions" style={{ marginTop: 10 }}>
        {url && <a className="btn secondary" href={url} target="_blank" rel="noopener noreferrer">Mở Google</a>}
        <button type="button" className="btn primary" disabled={hasChanges} onClick={() => setPublishing(true)}>
          <ThreePlatformIcons size={14} />
          Đăng lên nền tảng liên kết
        </button>
      </div>
      {hasChanges && <small>Xuất lại video để áp dụng chỉnh sửa trước khi đăng.</small>}
      {publishing && (
        <UnifiedPublishModal
          client={youtube.client}
          item={item}
          youtube={youtube}
          social={social}
          onClose={() => setPublishing(false)}
        />
      )}
    </section>
  );
}
