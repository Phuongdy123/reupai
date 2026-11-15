"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { youtubeRequest } from "../lib/youtube-client";
import { Icon } from "./icon";
import { ThumbnailDesigner } from "./thumbnail-designer";

export function YoutubePublishDialog({ client, item, connection, onClose }) {
  const dialog = useRef(null);
  const live = useRef(false);
  const requestId = useRef(null);
  const [title, setTitle] = useState((item.title || item.video_id).slice(0, 100));
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [instructions, setInstructions] = useState("");
  const [images, setImages] = useState([]);
  const [thumbnail, setThumbnail] = useState("");
  const [designerSource, setDesignerSource] = useState("");
  const selectThumbnail = source => { setThumbnail(source); setDesignerSource(""); setConfirmed(false); };
  const [privacy, setPrivacy] = useState("private");
  const [audience, setAudience] = useState("");
  const [scheduleMode, setScheduleMode] = useState("now");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [previewUrl, setPreviewUrl] = useState(null);
  const publishAt = scheduleMode === "scheduled" && scheduleDate && scheduleTime ? `${scheduleDate}T${scheduleTime}` : "";
  const scheduleValid = scheduleMode === "now" || Boolean(publishAt && Number.isFinite(new Date(publishAt).getTime()) && new Date(publishAt).getTime() > Date.now() + 60000);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(() => {
    let active = true;
    client.mediaUrl(`/api/stream/${encodeURIComponent(item.video_id)}?channel=${encodeURIComponent(item.channel || "2d_animation")}&mode=${encodeURIComponent(item.mode || "subtitle")}`).then(url => { if (active) setPreviewUrl(url); }).catch(() => {});
    return () => { active = false; };
  }, [client, item.video_id, item.channel, item.mode]);
  const chooseSchedule = hours => {
    const date = new Date(Date.now() + hours * 3600000);
    const pad = n => String(n).padStart(2, "0");
    setScheduleDate(`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`);
    setScheduleTime(`${pad(date.getHours())}:${pad(date.getMinutes())}`);
    setScheduleMode("scheduled"); setConfirmed(false);
  };
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [job, setJob] = useState(null);
  const identity = { video_id: item.video_id, channel: item.channel || "2d_animation", mode: item.mode || "subtitle", account_id: connection.account_id, channel_id: connection.channel.id };
  const storageKey = `reupai:youtube-upload:${connection.account_id}:${connection.channel.id}:${item.video_id}:${item.mode}`;
  const uploading = job && ["queued", "uploading"].includes(job.state);
  const locked = Boolean(busy || uploading || job?.state === "completed");

  useEffect(() => {
    live.current = true;
    const previousFocus = document.activeElement;
    dialog.current?.showModal();
    const previous = sessionStorage.getItem(storageKey);
    requestId.current = previous || crypto.randomUUID();
    if (previous) youtubeRequest(client, `uploads/${encodeURIComponent(previous)}`).then(result => { if (live.current) setJob(result); }).catch(() => {});
    return () => { live.current = false; previousFocus?.focus?.({ preventScroll: true }); };
  }, [client, storageKey]);
  useEffect(() => {
    if (!uploading) return;
    let active = true; let timer;
    const poll = async () => {
      try {
        const result = await youtubeRequest(client, `uploads/${encodeURIComponent(job.id)}`);
        if (active) { setJob(result); setError(""); }
      } catch (requestError) { if (active) setError(requestError.message); }
      if (active) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 1000);
    return () => { active = false; clearTimeout(timer); };
  }, [client, uploading, job?.id]);

  const loadImages = async () => {
    setBusy("images"); setError("");
    try {
      const result = await youtubeRequest(client, "thumbnails", { method: "POST", body: JSON.stringify(identity), timeoutMs: 100000 });
      if (live.current) { setImages(result.images || []); if (!result.images?.length) setError("Chưa lấy được khung hình. Bạn có thể chọn ảnh bìa trên máy."); }
    } catch (requestError) { if (live.current) setError(requestError.message); }
    finally { if (live.current) setBusy(""); }
  };
  const suggest = async () => {
    setBusy("ai"); setError("");
    try {
      const result = await youtubeRequest(client, "suggest", { method: "POST", body: JSON.stringify({ ...identity, title: item.title, instructions, images }), timeoutMs: 100000 });
      if (live.current) {
        setTitle(result.title); setDescription(result.description); setTags(result.tags.join(", "));
        if (Number.isInteger(result.thumbnail_index) && images[result.thumbnail_index]) selectThumbnail(images[result.thumbnail_index]);
        setConfirmed(false);
      }
    } catch (requestError) { if (live.current) setError(requestError.message); }
    finally { if (live.current) setBusy(""); }
  };
  const openThumbnailDesigner = async () => {
    setConfirmed(false);
    if (!/[\p{Script=Han}]/u.test(title)) { setDesignerSource(thumbnail); return title; }
    setBusy("thumbnail-title"); setError("");
    try {
      const result = await youtubeRequest(client, "suggest", { method: "POST", body: JSON.stringify({ ...identity, title, images: [], instructions: "Dịch tiêu đề nguồn sang tiếng Việt tự nhiên, ngắn gọn để làm ảnh bìa. Chỉ dùng tiếng Việt cho title, giữ đúng nội dung, không thêm tình tiết. Không dùng chữ Hán." }), timeoutMs: 100000 });
      if (!live.current) return;
      const translated = String(result.title || "").trim().slice(0, 100);
      if (!translated || /[\p{Script=Han}]/u.test(translated)) throw new Error("Chưa dịch được tiêu đề sang tiếng Việt. Bấm AI gợi ý nội dung hoặc nhập tiêu đề tiếng Việt rồi thử lại.");
      setTitle(translated);
      setDesignerSource(thumbnail);
      return translated;
    } catch (requestError) { if (live.current) setError(requestError.message || "Chưa dịch được tiêu đề ảnh bìa."); }
    finally { if (live.current) setBusy(""); }
  };
  const chooseImage = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 2 * 1024 * 1024) { setError("Chọn ảnh JPEG hoặc PNG dưới 2 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => { if (live.current) { selectThumbnail(String(reader.result)); } };
    reader.onerror = () => { if (live.current) setError("Không đọc được ảnh bìa."); };
    reader.readAsDataURL(file);
  };
  const submit = async (event) => {
    event.preventDefault();
    if (locked || !confirmed || !audience || designerSource) return;
    if (!scheduleValid) { setError("Chọn ngày và giờ đăng cách hiện tại ít nhất 1 phút."); return; }
    setBusy("upload"); setError("");
    try {
      sessionStorage.setItem(storageKey, requestId.current);
      const result = await youtubeRequest(client, "uploads", { method: "POST", body: JSON.stringify({ ...identity,
        request_id: requestId.current, title, description, tags: tags.split(",").map(t => t.trim()).filter(Boolean),
        thumbnail: thumbnail || null, privacy, made_for_kids: audience === "yes", confirmed: true,
        publish_at: publishAt ? new Date(publishAt).toISOString() : null }) });
      if (live.current) setJob(result);
    } catch (requestError) {
      if (live.current) setError(requestError.message);
      // Recover the same request ID after a lost response; never insert a second video automatically.
      try { const existing = await youtubeRequest(client, `uploads/${encodeURIComponent(requestId.current)}`); if (live.current) setJob(existing); } catch {}
    } finally { if (live.current) setBusy(""); }
  };
  if (typeof document === "undefined") return null;
  return createPortal(<dialog ref={dialog} className="youtube-publish-dialog" onCancel={onClose}>
    <form onSubmit={submit}>
      <header><div><small>ĐĂNG THÀNH PHẨM</small><h2>Chuẩn bị đăng YouTube</h2><p>Kênh: <strong>{connection.channel.title}</strong></p></div><button type="button" className="modern-icon-btn" onClick={onClose} aria-label="Đóng">×</button></header>
      <div className="youtube-publish-workspace"><aside className="youtube-publish-preview"><small>VIDEO SẮP ĐĂNG</small><div className="youtube-publish-stage">{previewUrl ? <video crossOrigin="anonymous" src={previewUrl} controls playsInline /> : <p>Chưa mở được bản xem trước. Bạn vẫn có thể chuẩn bị nội dung đăng.</p>}</div><strong>{item.title || item.video_id}</strong><div className="youtube-publish-target"><span>ĐĂNG LÊN KÊNH</span><strong>{connection.channel.title}</strong><p>{scheduleMode === "scheduled" ? 'Hẹn giờ · Tải lên riêng tư trước' : privacy === "public" ? 'Công khai' : privacy === "unlisted" ? 'Không công khai' : 'Riêng tư'}</p>{publishAt && <p>{new Date(publishAt).toLocaleString("vi-VN")} · {timezone}</p>}</div></aside><div className="youtube-publish-body">
        <p className="muted">AI chỉ chuẩn bị nội dung. Bạn kiểm tra và xác nhận trước khi đăng.</p>
        {error && <p className="youtube-error" role="alert">{error}</p>}
        {job && <section className="youtube-upload-status" role="status"><strong>{job.state === "completed" ? "Đã tải lên YouTube" : job.state === "failed" ? "Chưa hoàn tất lượt đăng" : "Đang tải lên YouTube"}</strong><progress aria-label="Tiến độ tải lên YouTube" value={job.percent || 0} max="100" /><span>{job.percent || 0}%</span>{job.error && <p>{job.error}</p>}{job.warning && <p>{job.warning}</p>}{job.url && <a href={job.url} target="_blank" rel="noopener noreferrer">Mở video trên YouTube ↗</a>}{job.state === "completed" && <p>YouTube có thể cần thêm thời gian xử lý video. Chế độ: {job.privacy === "private" ? "Riêng tư" : job.privacy === "unlisted" ? "Không công khai" : job.privacy === "public" ? "Công khai" : "Chưa xác nhận; kiểm tra trong YouTube Studio"}.</p>}</section>}
        <fieldset disabled={locked} className="youtube-publish-fields">
          <section className="youtube-ai-draft"><label>Yêu cầu cho AI (tùy chọn)<input value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Ví dụ: Tiêu đề ngắn, mô tả tiếng Việt, nhấn vào tập 3" maxLength={2000} /></label><small>Khi dùng AI, tiêu đề, phụ đề và ảnh đã chọn được gửi tới Gemini bằng project của bạn.</small><button type="button" className="btn secondary" onClick={suggest}><Icon name="sparkles" size={16} />{busy === "ai" ? "AI đang chuẩn bị…" : "AI gợi ý nội dung"}</button></section>
          <label>Tiêu đề <small>{title.length}/100</small><input required maxLength={100} value={title} onChange={e => { setTitle(e.target.value); setConfirmed(false); }} /></label>
          <label>Mô tả và hashtag<textarea rows={6} value={description} onChange={e => { setDescription(e.target.value); setConfirmed(false); }} maxLength={5000} /></label>
          <label>Tag / từ khóa<input value={tags} onChange={e => { setTags(e.target.value); setConfirmed(false); }} placeholder="Các từ khóa, ngăn cách bằng dấu phẩy" /></label>
          <section className="youtube-thumbnails"><div className="library-actions"><strong>Ảnh bìa</strong><button type="button" className="btn secondary" onClick={loadImages}>{busy === "images" ? "Đang lấy khung hình…" : "Lấy ảnh từ video"}</button><label className="btn secondary youtube-file-label">Chọn ảnh trên máy<input type="file" accept="image/jpeg,image/png" onChange={chooseImage} /></label></div>{images.length > 0 && <div className="youtube-thumbnail-grid">{images.map((src, index) => <button key={index} type="button" className={thumbnail === src ? "selected" : ""} aria-label={`Chọn ảnh bìa ${index + 1}`} aria-pressed={thumbnail === src} onClick={() => { selectThumbnail(src); }}><img src={src} alt={`Khung hình ${index + 1}`} /></button>)}</div>}{thumbnail && <div className="youtube-chosen-thumbnail"><img src={thumbnail} alt="Ảnh bìa đã chọn" /><div className="library-actions"><button type="button" className="btn primary" onClick={openThumbnailDesigner}>{busy === "thumbnail-title" ? "Đang dịch tiêu đề…" : "Thiết kế ảnh bìa · Chữ & màu"}</button><button type="button" className="btn secondary" onClick={() => selectThumbnail("")}>Bỏ ảnh bìa</button></div></div>}{designerSource && <ThumbnailDesigner source={designerSource} title={title} onTranslateTitle={openThumbnailDesigner} onClose={() => setDesignerSource("")} onApply={selectThumbnail} />}<small>Chọn khung hình thật hoặc ảnh JPEG/PNG dưới 2 MB. Lấy ảnh từ video trước khi nhờ AI để AI có thể gợi ý ảnh bìa.</small></section>
          <div className="youtube-publish-grid"><label>Chế độ hiển thị<select disabled={scheduleMode === "scheduled"} value={scheduleMode === "scheduled" ? "private" : privacy} onChange={e => { setPrivacy(e.target.value); setConfirmed(false); }}><option value="private">Riêng tư · Nên dùng khi thử</option><option value="unlisted">Không công khai</option><option value="public">Công khai</option></select></label><label>Video có dành cho trẻ em không?<select required value={audience} onChange={e => { setAudience(e.target.value); setConfirmed(false); }}><option value="">Bạn cần chọn</option><option value="no">Không dành riêng cho trẻ em</option><option value="yes">Có, dành cho trẻ em</option></select></label></div>
          <section className="youtube-schedule"><div><strong>Thời điểm đăng</strong><p>Chọn đăng ngay hoặc đặt lịch công khai.</p></div><div className="youtube-schedule-toggle"><button type="button" aria-pressed={scheduleMode === "now"} className={`btn ${scheduleMode === "now" ? "primary" : "secondary"}`} onClick={() => { setScheduleMode("now"); setConfirmed(false); }}>Đăng ngay</button><button type="button" aria-pressed={scheduleMode === "scheduled"} className={`btn ${scheduleMode === "scheduled" ? "primary" : "secondary"}`} onClick={() => { setScheduleMode("scheduled"); setConfirmed(false); }}>Hẹn giờ đăng</button></div>{scheduleMode === "scheduled" && <><div className="youtube-publish-grid"><label>Ngày đăng<input type="date" required value={scheduleDate} onChange={e => { setScheduleDate(e.target.value); setConfirmed(false); }} /></label><label>Giờ đăng<input type="time" required value={scheduleTime} onChange={e => { setScheduleTime(e.target.value); setConfirmed(false); }} /></label></div><div className="library-actions"><button type="button" className="btn secondary" onClick={()=>chooseSchedule(1)}>Sau 1 giờ</button><button type="button" className="btn secondary" onClick={()=>chooseSchedule(24)}>Ngày mai, giờ này</button></div><small>Múi giờ: {timezone}. Video được tải lên riêng tư trước và công khai theo lịch.</small>{!scheduleValid && <p className="youtube-schedule-warning" role="status">Chọn lịch đăng cách hiện tại ít nhất 1 phút.</p>}{scheduleValid && <p className="youtube-schedule-summary">Dự kiến công khai: {new Date(publishAt).toLocaleString("vi-VN")}</p>}</>}</section>
          <label className="youtube-publish-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Tôi đã xem lại video và nội dung, đồng ý đăng lên kênh {connection.channel.title}.</label>
        </fieldset>
      </div></div>
      <footer><button type="button" className="btn secondary" onClick={onClose}>Đóng</button><button type="submit" className="btn primary" disabled={locked || !confirmed || !audience || !scheduleValid || Boolean(designerSource)}>{busy === "upload" ? "Đang bắt đầu…" : scheduleMode === "scheduled" ? "Xác nhận hẹn đăng" : privacy === "private" ? "Đăng thử riêng tư" : "Xác nhận đăng YouTube"}</button></footer>
    </form>
  </dialog>, document.body);
}
