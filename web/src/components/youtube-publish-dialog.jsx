"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { youtubeRequest } from "../lib/youtube-client";
import { Icon } from "./icon";
import { recordChannelActivity } from "../lib/channel-activity";
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
  const [referenceMode, setReferenceMode] = useState(false);
  const closeDesigner = () => { setDesignerSource(""); setReferenceMode(false); };
  const selectThumbnail = source => { setThumbnail(source); closeDesigner(); setConfirmed(false); };
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
  useEffect(() => {
    if (job?.state === "completed") recordChannelActivity(connection.account_id, "youtube", connection.channel, job.id);
  }, [connection.account_id, connection.channel, job?.id, job?.state]);
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

  const fetchThumbnailFrames = async () => {
    const result = await youtubeRequest(client, "thumbnails", { method: "POST", body: JSON.stringify(identity), timeoutMs: 100000 });
    return result.images || [];
  };
  const loadImages = async () => {
    setBusy("images"); setError("");
    try {
      const frames = await fetchThumbnailFrames();
      if (live.current) { setImages(frames); if (!frames.length) setError("Chưa lấy được khung hình. Bạn có thể chọn ảnh bìa trên máy."); }
    } catch (requestError) { if (live.current) setError(requestError.message); }
    finally { if (live.current) setBusy(""); }
  };
  const startThumbnailDesign = async () => {
    setConfirmed(false);
    setError("");
    setDesignerSource("");
    setReferenceMode(true);
    if (!images.length) await loadImages();
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
  const translateThumbnailTitle = async () => {
    setConfirmed(false);
    if (!/[\p{Script=Han}]/u.test(title)) return title;
    setBusy("thumbnail-title"); setError("");
    try {
      const result = await youtubeRequest(client, "suggest", { method: "POST", body: JSON.stringify({ ...identity, title, images: [], instructions: "Dịch tiêu đề nguồn sang tiếng Việt tự nhiên, ngắn gọn để làm ảnh bìa. Chỉ dùng tiếng Việt cho title, giữ đúng nội dung, không thêm tình tiết. Không dùng chữ Hán." }), timeoutMs: 100000 });
      if (!live.current) return;
      const translated = String(result.title || "").trim().slice(0, 100);
      if (!translated || /[\p{Script=Han}]/u.test(translated)) throw new Error("Chưa dịch được tiêu đề sang tiếng Việt. Bấm AI gợi ý nội dung hoặc nhập tiêu đề tiếng Việt rồi thử lại.");
      setTitle(translated);
      return translated;
    } catch (requestError) { if (live.current) setError(requestError.message || "Chưa dịch được tiêu đề ảnh bìa."); }
    finally { if (live.current) setBusy(""); }
  };
  const generateThumbnailCaption = async instructions => {
    setBusy("thumbnail-caption");
    setError("");
    try {
      const result = await youtubeRequest(client, "suggest", {
        method: "POST",
        body: JSON.stringify({ ...identity, title, images: [], instructions: `Viết chữ bìa bằng tiếng Việt, tối đa 9 từ, dựa trên nội dung video. Trả câu này trong trường title. Yêu cầu: ${instructions}` }),
        timeoutMs: 100000,
      });
      return result.title;
    } finally { if (live.current) setBusy(""); }
  };
  const chooseImage = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 2 * 1024 * 1024) { setError("Chọn ảnh JPEG hoặc PNG dưới 2 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (!live.current) return;
      const source = String(reader.result);
      if (referenceMode) setDesignerSource(source);
      else selectThumbnail(source);
    };
    reader.onerror = () => { if (live.current) setError("Không đọc được ảnh bìa."); };
    reader.readAsDataURL(file);
  };
  const submit = async (event) => {
    event.preventDefault();
    if (locked || !confirmed || !audience || designerSource || referenceMode) return;
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
          <section className="youtube-thumbnails">
            <div className="library-actions">
              <strong>Ảnh bìa</strong>
              {referenceMode ? <button type="button" className="btn secondary" onClick={closeDesigner}>Thoát tạo ảnh mới</button> : <button type="button" className="btn primary" onClick={startThumbnailDesign}>Tạo ảnh mới bằng AI</button>}
              <button type="button" className="btn secondary" onClick={loadImages}>{busy === "images" ? "Đang lấy khung hình…" : "Lấy ảnh từ video"}</button>
              <label className="btn secondary youtube-file-label">{referenceMode ? "Tải ảnh tham chiếu" : "Chọn ảnh trên máy"}<input key={String(referenceMode)} type="file" accept="image/jpeg,image/png" onChange={chooseImage} /></label>
            </div>
            {referenceMode && <small>Chọn khung hình tham chiếu để Gemini dựng một cảnh mới. Ảnh bìa chỉ đổi khi bạn áp dụng kết quả.</small>}
            {images.length > 0 && <div className="youtube-thumbnail-grid">{images.map((src, index) => {
              const selected = (referenceMode ? designerSource : thumbnail) === src;
              return <button key={index} type="button" className={selected ? "selected" : ""} aria-label={`${referenceMode ? "Chọn ảnh tham chiếu" : "Chọn ảnh bìa"} ${index + 1}`} aria-pressed={selected} onClick={() => referenceMode ? setDesignerSource(src) : selectThumbnail(src)}><img src={src} alt={`Khung hình ${index + 1}`} /></button>;
            })}</div>}
            {thumbnail && !referenceMode && <div className="youtube-chosen-thumbnail"><img src={thumbnail} alt="Ảnh bìa đã chọn" /><div className="library-actions"><button type="button" className="btn secondary" onClick={() => setDesignerSource(thumbnail)}>Chỉnh ảnh đã chọn</button><button type="button" className="btn secondary" onClick={() => selectThumbnail("")}>Bỏ ảnh bìa</button></div></div>}
            {designerSource && <ThumbnailDesigner key={designerSource} source={designerSource} artworkOnly={referenceMode} title={title} accountId={connection.account_id} channelId={connection.channel.id} onTranslateTitle={translateThumbnailTitle} onGenerateCaption={generateThumbnailCaption} onGenerateArtwork={client.health?.capabilities?.gemini_thumbnail_artwork ? (reference, prompt, signal) => youtubeRequest(client, "thumbnail-artwork", { method: "POST", body: JSON.stringify({ ...identity, reference, prompt }), timeoutMs: 125000, signal }) : undefined} onClose={closeDesigner} onApply={selectThumbnail} />}
          </section>
          <div className="youtube-publish-grid"><label>Chế độ hiển thị<select disabled={scheduleMode === "scheduled"} value={scheduleMode === "scheduled" ? "private" : privacy} onChange={e => { setPrivacy(e.target.value); setConfirmed(false); }}><option value="private">Riêng tư · Nên dùng khi thử</option><option value="unlisted">Không công khai</option><option value="public">Công khai</option></select></label><label>Video có dành cho trẻ em không?<select required value={audience} onChange={e => { setAudience(e.target.value); setConfirmed(false); }}><option value="">Bạn cần chọn</option><option value="no">Không dành riêng cho trẻ em</option><option value="yes">Có, dành cho trẻ em</option></select></label></div>
          <section className="youtube-schedule"><div><strong>Thời điểm đăng</strong><p>Chọn đăng ngay hoặc đặt lịch công khai.</p></div><div className="youtube-schedule-toggle"><button type="button" aria-pressed={scheduleMode === "now"} className={`btn ${scheduleMode === "now" ? "primary" : "secondary"}`} onClick={() => { setScheduleMode("now"); setConfirmed(false); }}>Đăng ngay</button><button type="button" aria-pressed={scheduleMode === "scheduled"} className={`btn ${scheduleMode === "scheduled" ? "primary" : "secondary"}`} onClick={() => { setScheduleMode("scheduled"); setConfirmed(false); }}>Hẹn giờ đăng</button></div>{scheduleMode === "scheduled" && <><div className="youtube-publish-grid"><label>Ngày đăng<input type="date" required value={scheduleDate} onChange={e => { setScheduleDate(e.target.value); setConfirmed(false); }} /></label><label>Giờ đăng<input type="time" required value={scheduleTime} onChange={e => { setScheduleTime(e.target.value); setConfirmed(false); }} /></label></div><div className="library-actions"><button type="button" className="btn secondary" onClick={()=>chooseSchedule(1)}>Sau 1 giờ</button><button type="button" className="btn secondary" onClick={()=>chooseSchedule(24)}>Ngày mai, giờ này</button></div><small>Múi giờ: {timezone}. Video được tải lên riêng tư trước và công khai theo lịch.</small>{!scheduleValid && <p className="youtube-schedule-warning" role="status">Chọn lịch đăng cách hiện tại ít nhất 1 phút.</p>}{scheduleValid && <p className="youtube-schedule-summary">Dự kiến công khai: {new Date(publishAt).toLocaleString("vi-VN")}</p>}</>}</section>
          <label className="youtube-publish-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Tôi đã xem lại video và nội dung, đồng ý đăng lên kênh {connection.channel.title}.</label>
        </fieldset>
      </div></div>
      <footer><button type="button" className="btn secondary" onClick={onClose}>Đóng</button><button type="submit" className="btn primary" disabled={locked || !confirmed || !audience || !scheduleValid || Boolean(designerSource) || referenceMode}>{busy === "upload" ? "Đang bắt đầu…" : scheduleMode === "scheduled" ? "Xác nhận hẹn đăng" : privacy === "private" ? "Đăng thử riêng tư" : "Xác nhận đăng YouTube"}</button></footer>
    </form>
  </dialog>, document.body);
}
