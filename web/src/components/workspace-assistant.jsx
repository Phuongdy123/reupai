"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon";

const CHAT_STORAGE_KEY = "reupai:assistant-chat-v1";
export const PENDING_SOURCE_KEY = "reupai:assistant-pending-source";
const VIDEO_HOSTS = new Set(["bilibili.com", "www.bilibili.com", "m.bilibili.com", "space.bilibili.com", "b23.tv", "douyin.com", "www.douyin.com", "v.douyin.com"]);
const PROMPTS = ["Tạo Vietsub từ link", "Gợi ý cấu hình video", "Hỏi về lỗi xử lý"];

function sourceFromMessage(message) {
  const match = String(message).match(/(?:https?:\/\/)?(?:www\.|m\.|space\.)?(?:bilibili\.com|b23\.tv|douyin\.com|v\.douyin\.com)\/[^\s<>"']+/i);
  if (!match) return null;
  try {
    const candidate = match[0].replace(/[),.;!?]+$/, "");
    const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    if (!VIDEO_HOSTS.has(url.hostname.toLowerCase())) return null;
    const host = url.hostname.toLowerCase();
    const platform = host.endsWith("douyin.com") ? "Douyin" : "Bilibili";
    const isChannel = host === "space.bilibili.com" || /\/user\//i.test(url.pathname);
    const isVideo = host === "b23.tv" || host === "v.douyin.com" || /\/(?:video|share\/video)\//i.test(url.pathname);
    return { url: url.href, platform, kind: isChannel ? "channel" : isVideo ? "video" : "unknown" };
  } catch { return null; }
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Không đọc được ảnh."));
    reader.readAsDataURL(file);
  });
}

function conversationRequest(messages, current) {
  const budget = 2000 - current.length - 80;
  if (budget < 100) return current;
  const recent = messages.filter((item) => !item.error).slice(-8);
  const selected = [];
  let used = 0;
  for (const item of recent.reverse()) {
    const line = `${item.role === "user" ? "Người dùng" : "Trợ lý"}: ${item.text.slice(0, 220)}`;
    if (used + line.length > budget) break;
    selected.unshift(line);
    used += line.length + 1;
  }
  return selected.length ? `Hội thoại trước:\n${selected.join("\n")}\n\nCâu hỏi hiện tại: ${current}` : current;
}

function newMessage(role, text, extras = {}) {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role, text, ...extras };
}

export function WorkspaceAssistant({ client, connected, check }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [imageData, setImageData] = useState("");
  const [imageName, setImageName] = useState("");
  const [messages, setMessages] = useState([]);
  const [threadOpen, setThreadOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  const [inputError, setInputError] = useState("");
  const textareaRef = useRef(null);
  const threadRef = useRef(null);
  const requestRef = useRef(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(CHAT_STORAGE_KEY) || "[]");
      if (Array.isArray(saved)) setMessages(saved.slice(-30).filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.text === "string"));
    } catch { /* A damaged session never prevents opening the dashboard. */ }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { window.sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-30))); } catch { /* Private browsing can disable storage. */ }
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, loaded, threadOpen]);
  useEffect(() => () => requestRef.current?.abort(), []);

  async function attach(file) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 4 * 1024 * 1024) {
      setInputError("Chọn ảnh PNG, JPEG hoặc WebP dưới 4 MB.");
      return;
    }
    try {
      setImageData(await fileAsDataUrl(file));
      setImageName(file.name);
      setInputError("");
    } catch (error) { setInputError(error.message); }
  }

  async function captureScreen() {
    if (!navigator.mediaDevices?.getDisplayMedia) { setInputError("Trình duyệt này chưa hỗ trợ chụp màn hình. Hãy đính kèm ảnh."); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
      const scale = Math.min(1, 1600 / video.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      setImageData(canvas.toDataURL("image/jpeg", 0.78));
      setImageName("Ảnh chụp màn hình");
      setInputError("");
    } catch { setInputError("Chưa chụp được màn hình. Bạn có thể đính kèm ảnh từ máy."); }
    finally { stream?.getTracks().forEach((track) => track.stop()); }
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const text = message.trim();
    if (!text) { setInputError("Nhập câu hỏi hoặc dán link video."); textareaRef.current?.focus(); return; }
    const context = conversationRequest(messages, text);
    const attachedImage = imageData;
    const attachedName = imageName;
    setThreadOpen(true);
    setMessages((previous) => [...previous, newMessage("user", text, attachedName ? { imageName: attachedName } : {})]);
    setMessage(""); setImageData(""); setImageName(""); setInputError("");
    const reply = (answer, extras = {}) => setMessages((previous) => [...previous, newMessage("assistant", answer, extras)]);
    const detected = sourceFromMessage(text);
    if (/local engine offline|failed to fetch|không kết nối được local engine/i.test(text)) {
      reply("Local Engine chưa phản hồi. Mở ReupAI trên máy, rồi bấm Kiểm tra lại.", { fixType: "engine" }); return;
    }
    if (/GeminiSetupError|No API key was provided|phiên Google.*hết hạn|chưa kết nối Google cho Gemini|generativelanguage\.googleapis\.com/i.test(text)) {
      reply("Mở Cài đặt để kiểm tra project, quyền Gemini hoặc kết nối lại Google. Sau đó thử lại.", { fixType: "gemini" }); return;
    }
    if (/yt-dlp|download that bai|bilibili.*chặn/i.test(text)) {
      reply("Tải video thất bại. Hãy mở link trực tiếp trong trình duyệt để kiểm tra video còn xem được, rồi xem chi tiết nhật ký tải. Nếu bạn dán link video, mình có thể mở lại cấu hình.", { source: detected?.kind === "video" ? detected : null }); return;
    }
    if (detected) {
      reply(detected.kind === "video"
        ? `Mình nhận ra link video ${detected.platform}. Bạn muốn làm Vietsub hay Vietsub + Voice? Mình sẽ mở cấu hình để bạn kiểm tra trước khi chạy.`
        : detected.kind === "channel"
          ? `Đây là link kênh ${detected.platform}. Vào Nguồn video và chọn “Cả kênh” để đồng bộ.`
          : `Mình nhận ra ${detected.platform}, nhưng cần link video trực tiếp để xử lý.`, { source: detected });
      return;
    }
    if (!connected) { reply("Local Engine chưa kết nối. Mở ứng dụng trên máy rồi bấm Kiểm tra lại để hỏi Gemini.", { fixType: "engine" }); return; }
    setBusy(true);
    setWaitingSeconds(0);
    cancelledRef.current = false;
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 65000);
    const ticker = window.setInterval(() => setWaitingSeconds((seconds) => seconds + 1), 1000);
    try {
      const result = await client.json("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: context, kind: "question", image_data: attachedImage || null }),
        signal: controller.signal,
      });
      reply(result.answer || "Gemini chưa có câu trả lời.");
    } catch (error) {
      const answer = error.name === "AbortError"
        ? cancelledRef.current ? "Đã dừng yêu cầu. Bạn có thể gửi lại khi sẵn sàng." : "Gemini phản hồi quá lâu. Kiểm tra kết nối rồi thử lại."
        : error.status === 404 ? "Local Engine chưa có phiên bản Trợ lý AI. Hãy cập nhật ứng dụng trên máy."
          : error.message || "Chưa thể hỏi Gemini lúc này.";
      reply(answer, { error: true, retryText: text, fixType: /Gemini|Google|project|quota|quyền/i.test(answer) && error.name !== "AbortError" ? "gemini" : "" });
    } finally {
      window.clearTimeout(timeout);
      window.clearInterval(ticker);
      requestRef.current = null;
      setBusy(false);
    }
  }

  function openConfig(source, mode) {
    if (!connected) { setInputError("Mở Local Engine và kết nối lại trước khi xử lý video."); return; }
    try { window.sessionStorage.setItem(PENDING_SOURCE_KEY, JSON.stringify({ url: source.url, mode, createdAt: Date.now() })); }
    catch { setInputError("Trình duyệt không lưu được yêu cầu. Hãy dán link trực tiếp tại trang Nguồn video."); return; }
    router.push("/sources");
  }

  return <section className="workspace-assistant assistant-home" aria-label="Trợ lý AI ReupAI">
    <div className="assistant-hero">
      <div><span className="assistant-eyebrow"><Icon name="spark" size={14} /> REUPAI ASSISTANT</span>
        <h2>{threadOpen && messages.length ? <>Tiếp tục cùng <em>ReupAI</em></> : <>Bạn muốn làm gì <em>hôm nay?</em></>}</h2>
        <p>Dán link video, mô tả ý tưởng hoặc hỏi trợ lý cách thực hiện.</p>
      </div>
      <button type="button" className="assistant-new-chat" disabled={busy} onClick={() => { setMessages([]); setThreadOpen(false); setMessage(""); setInputError(""); textareaRef.current?.focus(); }}>+ Chat mới</button>
    </div>
    {!threadOpen && <div className="assistant-starters">{PROMPTS.map((prompt) => <button type="button" key={prompt} onClick={() => { setMessage(prompt); textareaRef.current?.focus(); }}><Icon name="spark" size={15} />{prompt}</button>)}</div>}
    <form className="assistant-composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="workspaceAssistantMessage">Nhắn cho Trợ lý ReupAI</label>
      <textarea id="workspaceAssistantMessage" ref={textareaRef} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Bạn muốn xử lý video nào? Dán link hoặc hỏi Trợ lý ReupAI…" maxLength={2000} rows={2} />
      <div className="assistant-composer-footer"><div className="assistant-attachments">
        <label className="assistant-tool"><Icon name="plus" size={16} /> Đính kèm<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { void attach(event.target.files?.[0]); event.target.value = ""; }} /></label>
        <button type="button" className="assistant-tool" onClick={captureScreen}><Icon name="source" size={16} /> Chụp màn hình</button>
        {imageName && <button type="button" className="assistant-image-chip" onClick={() => { setImageData(""); setImageName(""); }} title="Bỏ ảnh đính kèm">{imageName} ×</button>}
      </div><button type="submit" className="assistant-send" disabled={busy}>{busy ? "Đang chờ AI" : "Gửi"} <Icon name="spark" size={15} /></button></div>
    </form>
    {inputError && <p className="assistant-input-error" role="alert">{inputError}</p>}
    {messages.length > 0 && <button type="button" className="assistant-history-toggle" aria-expanded={threadOpen} aria-controls="assistantChatHistory" onClick={() => setThreadOpen((value) => !value)}><Icon name="history" size={16} /> {threadOpen ? "Đóng lịch sử chat" : "Mở lịch sử chat"}<span>{messages.length} tin nhắn</span><span aria-hidden="true">{threadOpen ? "⌃" : "⌄"}</span></button>}
    {messages.length > 0 && threadOpen && <div id="assistantChatHistory" className="assistant-thread" ref={threadRef} role="log" aria-label="Cuộc trò chuyện với trợ lý">{messages.map((item) => <article className={`assistant-message is-${item.role}${item.error ? " is-error" : ""}`} key={item.id}>
      <span className="assistant-message-avatar">{item.role === "user" ? "B" : <Icon name="spark" size={16} />}</span>
      <div className="assistant-message-body"><strong>{item.role === "user" ? "Bạn" : "Trợ lý ReupAI"}</strong><p>{item.text}</p>
        {item.imageName && <small>Ảnh đính kèm: {item.imageName}</small>}
        {item.source?.kind === "video" && <div className="assistant-message-actions"><button type="button" onClick={() => openConfig(item.source, "subtitle")}>Tạo Vietsub</button><button type="button" onClick={() => openConfig(item.source, "voiceover")}>Vietsub + Voice</button></div>}
        {item.source?.kind === "channel" && <Link className="assistant-message-link" href="/sources">Mở Nguồn video →</Link>}
        {item.fixType === "engine" && <button type="button" className="assistant-message-link" onClick={check}>Kiểm tra lại Local Engine</button>}
        {item.fixType === "gemini" && <Link className="assistant-message-link" href="/settings#diagnostics">Mở Cài đặt Gemini →</Link>}
        {item.retryText && <button type="button" className="assistant-message-link" onClick={() => { setMessage(item.retryText); textareaRef.current?.focus(); }}>Thử lại câu hỏi</button>}
      </div></article>)}</div>}
    {busy && <div className="assistant-typing" role="status"><span className="assistant-typing-dots" aria-hidden="true"><i /><i /><i /></span><span>Đang hỏi Gemini · {waitingSeconds}s</span><button type="button" onClick={() => { cancelledRef.current = true; requestRef.current?.abort(); }}>Hủy</button></div>}
    <p className="assistant-note">Enter để gửi · Shift+Enter xuống dòng. Nội dung và ảnh bạn gửi được xử lý bởi Gemini qua project của bạn.</p>
  </section>;
}
