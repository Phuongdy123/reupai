export const VIETNAMESE_TTS_VOICES = [
  { value: "Trúc Ly", slug: "truc_ly", label: "⭐ Trúc Ly — Nữ · Bắc · Tự nhiên (Mặc định)" },
  { value: "Hải Đăng", slug: "hai_dang", label: "⭐ Hải Đăng — Nam · Bắc · Tự nhiên" },
  { value: "Adam bựa", slug: "adam_bua", label: "⭐ Adam bựa — Nam · Bắc · Tự nhiên hài hước" },
  { value: "Thiện Minh", slug: "thien_minh", label: "⭐ Thiện Minh — Nam · Bắc · Kể chuyện" },
  { value: "Mai Anh", slug: "mai_anh", label: "⭐ Mai Anh — Nữ · Bắc · Tin tức" },
  { value: "Thùy Dung", slug: "thuy_dung", label: "⭐ Thùy Dung — Nữ · Nam · Tin tức" },
  { value: "Thiền Tâm Đức", slug: "thien_tam_duc", label: "⭐ Thiền Tâm Đức — Nam · Bắc · Kể chuyện" },
  { value: "Ngọc Huyền", slug: "ngoc_huyen", label: "⭐ Ngọc Huyền — Nữ · Bắc · Tự nhiên" },
  { value: "Quang Sơn", slug: "quang_son", label: "⭐ Quang Sơn — Nam · Trung · Tự nhiên" },
  { value: "Ngọc Trân", slug: "ngoc_tran", label: "⭐ Ngọc Trân — Nữ · Trung · Tự nhiên" },
  { value: "Minh Đức", slug: "minh_duc", label: "Minh Đức — Nam · Bắc · Tin tức" },
  { value: "Phạm Tuyên", slug: "pham_tuyen", label: "Phạm Tuyên — Nam · Bắc · Tự nhiên" },
  { value: "Thái Sơn", slug: "thai_son", label: "Thái Sơn — Nam · Nam · Kể chuyện" },
  { value: "Xuân Vĩnh", slug: "xuan_vinh", label: "Xuân Vĩnh — Nam · Bắc · Tự nhiên" },
  { value: "Thanh Bình", slug: "thanh_binh", label: "Thanh Bình — Nam · Bắc · Kể chuyện" },
  { value: "Ngọc Linh", slug: "ngoc_linh", label: "Ngọc Linh — Nữ · Bắc · Kể chuyện" },
  { value: "Đoan Trang", slug: "doan_trang", label: "Đoan Trang — Nữ · Bắc · Tự nhiên" },
  { value: "Thục Đoan", slug: "thuc_doan", label: "Thục Đoan — Nữ · Nam · Kể chuyện" },
  { value: "Minh Triết", slug: "minh_triet", label: "Minh Triết — Nam · Nam · Tin tức" },
  { value: "Mỹ Duyên", slug: "my_duyen", label: "Mỹ Duyên — Nữ · Nam · Đọc truyện" },
  { value: "Quỳnh Anh", slug: "quynh_anh", label: "Quỳnh Anh — Nữ · Bắc · Đọc truyện" },
  { value: "Đức Trí", slug: "duc_tri", label: "Đức Trí — Nam · Nam · Đọc truyện" },
  { value: "Kim Thanh", slug: "kim_thanh", label: "Kim Thanh — Nữ · Nam · Đọc truyện" },
  { value: "Adam", slug: "adam", label: "Adam — Nam · Nam · Tự nhiên" },
  { value: "Quốc Tuấn", slug: "quoc_tuan", label: "Quốc Tuấn — Nam · Bắc · Tự nhiên" },
];

export function renderVoiceOptionsHtml() {
  return VIETNAMESE_TTS_VOICES.map(
    (v) => `<option value="${v.value}">${v.label}</option>`
  ).join("\n");
}

export const DEFAULT_PREVIEW_TEXT = "1 2 3, xin chào! Tôi là bình luận viên AI của bạn.";

let _activePreviewAudio = null;
let _activePreviewUrl = "";

export function stopVoicePreview() {
  if (_activePreviewAudio) {
    try {
      _activePreviewAudio.pause();
      _activePreviewAudio.currentTime = 0;
    } catch {}
    _activePreviewAudio = null;
  }
  if (_activePreviewUrl) {
    try { URL.revokeObjectURL(_activePreviewUrl); } catch {}
    _activePreviewUrl = "";
  }
}

export async function playVoicePreview(voice, { button = null, text = DEFAULT_PREVIEW_TEXT, onError = null } = {}) {
  const previousHtml = button ? button.innerHTML : "";
  stopVoicePreview();
  if (button) {
    button.disabled = true;
    button.textContent = "Đang đọc…";
  }
  try {
    const chosen = VIETNAMESE_TTS_VOICES.find((v) => v.value === voice) || VIETNAMESE_TTS_VOICES[0];
    if (text === DEFAULT_PREVIEW_TEXT && chosen?.slug) {
      const audio = new Audio(`/audio/voice-previews/${chosen.slug}.mp3`);
      _activePreviewAudio = audio;
      audio.onended = () => stopVoicePreview();
      audio.onerror = () => stopVoicePreview();
      await audio.play();
      return;
    }
    const client = typeof window !== "undefined" ? window.reupEngineClient : null;
    if (!client || typeof client.request !== "function") {
      throw new Error("Hãy kết nối Local Engine để nghe thử nội dung tùy chỉnh.");
    }
    const res = await client.request("/api/tts/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice: chosen.value, text }),
    });
    if (!res.ok) throw new Error("Không thể tạo âm thanh nghe thử.");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    _activePreviewUrl = url;
    const audio = new Audio(url);
    _activePreviewAudio = audio;
    audio.onended = () => stopVoicePreview();
    audio.onerror = () => stopVoicePreview();
    await audio.play();
  } catch (err) {
    onError?.(err?.message || "Chưa phát được âm thanh nghe thử.");
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = previousHtml;
    }
  }
}
