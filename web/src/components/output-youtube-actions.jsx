"use client";

import { useState } from "react";
import { useYoutubeConnection } from "./youtube-connection";
import { YoutubePublishDialog } from "./youtube-publish-dialog";
import { googleConsentUrl } from "../lib/youtube-client";

export function OutputYoutubeActions({ item, hasChanges = false }) {
  const youtube = useYoutubeConnection();
  const [publishing, setPublishing] = useState(false);
  const url = googleConsentUrl(youtube.connection?.authorization_url);
  return <section className="output-youtube-actions">
    <div><strong>YouTube</strong><p>{youtube.connection?.channel?.title || "Kết nối kênh để đăng thành phẩm"}</p><span className="status">{youtube.connection?.connecting ? "Đang chờ cấp quyền" : youtube.connection?.connected ? "Đã kết nối" : "Chưa kết nối"}</span></div>
    <div className="library-actions">{youtube.supported && <>
      <button type="button" className="btn secondary" onClick={youtube.connect} disabled={youtube.busy || youtube.connection?.connecting}>{youtube.connection?.connecting ? "Đang chờ Google…" : youtube.connection?.connected ? "Đổi kênh" : "Kết nối YouTube"}</button>
      {url && <a className="btn secondary" href={url} target="_blank" rel="noopener noreferrer">Mở Google</a>}
      {youtube.connection?.connecting && <button type="button" className="btn secondary" onClick={youtube.disconnect} disabled={youtube.busy}>Hủy kết nối</button>}
      <button type="button" className="btn secondary" onClick={youtube.refresh} disabled={youtube.busy}>Kiểm tra lại</button>
      {youtube.connection?.connected && <button type="button" className="btn primary" disabled={hasChanges} onClick={() => setPublishing(true)}>Đăng YouTube</button>}
    </>}</div>
    {hasChanges && <small>Xuất lại video để áp dụng chỉnh sửa trước khi đăng.</small>}
    {!youtube.supported && <small>Mở Local Engine có hỗ trợ YouTube để kết nối kênh.</small>}
    {youtube.error && <p role="alert" className="youtube-error">{youtube.error}</p>}
    {publishing && youtube.connection?.connected && <YoutubePublishDialog client={youtube.client} item={item} connection={youtube.connection} onClose={() => setPublishing(false)} />}
  </section>;
}
