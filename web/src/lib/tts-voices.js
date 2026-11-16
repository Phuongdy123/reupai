export const VIETNAMESE_TTS_VOICES = [
  // VieNeu v3 Turbo — Offline 100% Free (25 giọng chuẩn Bắc · Trung · Nam)
  { value: "Trúc Ly", label: "⭐ Trúc Ly — Nữ · Bắc · Tự nhiên (Mặc định)" },
  { value: "Hải Đăng", label: "⭐ Hải Đăng — Nam · Bắc · Tự nhiên" },
  { value: "Adam bựa", label: "⭐ Adam bựa — Nam · Bắc · Tự nhiên hài hước" },
  { value: "Thiện Minh", label: "⭐ Thiện Minh — Nam · Bắc · Kể chuyện" },
  { value: "Mai Anh", label: "⭐ Mai Anh — Nữ · Bắc · Tin tức" },
  { value: "Thùy Dung", label: "⭐ Thùy Dung — Nữ · Nam · Tin tức" },
  { value: "Thiền Tâm Đức", label: "⭐ Thiền Tâm Đức — Nam · Bắc · Kể chuyện" },
  { value: "Ngọc Huyền", label: "⭐ Ngọc Huyền — Nữ · Bắc · Tự nhiên" },
  { value: "Quang Sơn", label: "⭐ Quang Sơn — Nam · Trung · Tự nhiên" },
  { value: "Ngọc Trân", label: "⭐ Ngọc Trân — Nữ · Trung · Tự nhiên" },
  { value: "Minh Đức", label: "Minh Đức — Nam · Bắc · Tin tức" },
  { value: "Phạm Tuyên", label: "Phạm Tuyên — Nam · Bắc · Tự nhiên" },
  { value: "Thái Sơn", label: "Thái Sơn — Nam · Nam · Kể chuyện" },
  { value: "Xuân Vĩnh", label: "Xuân Vĩnh — Nam · Bắc · Tự nhiên" },
  { value: "Thanh Bình", label: "Thanh Bình — Nam · Bắc · Kể chuyện" },
  { value: "Ngọc Linh", label: "Ngọc Linh — Nữ · Bắc · Kể chuyện" },
  { value: "Đoan Trang", label: "Đoan Trang — Nữ · Bắc · Tự nhiên" },
  { value: "Thục Đoan", label: "Thục Đoan — Nữ · Nam · Kể chuyện" },
  { value: "Minh Triết", label: "Minh Triết — Nam · Nam · Tin tức" },
  { value: "Mỹ Duyên", label: "Mỹ Duyên — Nữ · Nam · Đọc truyện" },
  { value: "Quỳnh Anh", label: "Quỳnh Anh — Nữ · Bắc · Đọc truyện" },
  { value: "Đức Trí", label: "Đức Trí — Nam · Nam · Đọc truyện" },
  { value: "Kim Thanh", label: "Kim Thanh — Nữ · Nam · Đọc truyện" },
  { value: "Adam", label: "Adam — Nam · Nam · Tự nhiên" },
  { value: "Quốc Tuấn", label: "Quốc Tuấn — Nam · Bắc · Tự nhiên" },
  // Edge-TTS — Online 100% Free
  { value: "vi-VN-HoaiMyNeural", label: "Hoài My — Nữ · Edge-TTS Free" },
  { value: "vi-VN-NamMinhNeural", label: "Nam Minh — Nam · Edge-TTS Free" },
  { value: "hoai_my_tram", label: "Hoài My · Trầm ấm (Review/Truyện)" },
  { value: "nam_minh_tram", label: "Nam Minh · Trầm ấm (Review/Tin tức)" },
  { value: "hoai_my_shorts", label: "Hoài My · Nhanh trẻ trung (Shorts)" },
  { value: "nam_minh_shorts", label: "Nam Minh · Nhanh cuốn hút (Shorts)" },
];

export function renderVoiceOptionsHtml() {
  return VIETNAMESE_TTS_VOICES.map(
    (v) => `<option value="${v.value}">${v.label}</option>`
  ).join("\n");
}
