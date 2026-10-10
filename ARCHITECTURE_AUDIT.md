# Reup AI — Architecture Audit

Ngày audit: 2026-10-09

Phạm vi: audit Phase 1 theo Master Implementation Plan. Chưa tách Local
Engine, chưa rewrite pipeline và chưa deploy cloud.

## 1. Kết luận hiện tại

Ứng dụng hiện là một FastAPI/Uvicorn monolith chạy local tại
`127.0.0.1:8000`. FastAPI vừa phục vụ HTML/Jinja, vừa cung cấp API, vừa gọi
pipeline xử lý video trong cùng process/host. Mô hình này phù hợp để phát
triển local và là nền tốt để tạo adapter Local Engine; frontend hiện tại chưa
phải Next.js và chưa thể đưa nguyên khối lên Vercel để chạy pipeline.

Luồng mong muốn có thể đạt được bằng cách giữ nguyên các service xử lý, tạo
entry point Local Engine riêng trên `127.0.0.1:17888`, sau đó thay phần fetch
local trong giao diện bằng một `LocalEngineClient`.

## 2. Entry points và lệnh chạy

- `app/main.py`: khởi động Uvicorn, import `web.server:app`, port hiện tại 8000.
- `app/web/server.py`: FastAPI app, middleware session/auth, trang HTML và API.
- `app/pipeline.py`: wrapper/entry point pipeline hiện tại.
- `app/core/pipeline.py`: pipeline chính, điều phối download, audio, Whisper,
  dịch, TTS, OCR/subtitle detector, blur và FFmpeg renderer.
- `app/cli/setup_v12.py`: migration schema V12 và tool tạo admin.
- `app/services/library_api.py`: router `/api/library/*` cho thư viện, nguồn,
  favorites, collection, series và UI state.

Lệnh phát triển hiện tại:

```powershell
.\venv\Scripts\python.exe -m app.main
```

## 3. Luồng UI và API hiện tại

Các trang chính: `/`, `/sources`, `/downloads`, `/outputs`, `/history`,
`/settings`, `/login`, `/register`, `/verify-email`, `/admin/users`.

Các API pipeline hiện tại:

- `POST /api/videos`, `POST /api/videos/page`: đồng bộ metadata nguồn.
- `POST /api/download`: tạo/download video nguồn.
- `POST /api/process`: tạo job Vietsub/Voice/processing.
- `POST /api/process/{job_id}/stop`: dừng job.
- `GET /api/process/{job_id}/status`: đọc tiến độ.
- `GET /api/result/{video_id}` và `GET /api/stream`: đọc kết quả local.
- `GET /api/jobs/active`: job đang chạy; user thường được lọc theo owner,
  admin xem được toàn bộ.
- `GET /api/cover`: proxy thumbnail.

Router thư viện tại `app/services/library_api.py` quản lý saved sources,
library videos, favorites, collections, series và UI state.

## 4. Authentication/session hiện tại

- Session cookie `reup_session` do Starlette `SessionMiddleware` ký.
- Auth guard chặn toàn bộ route riêng tư và trả 401 cho API chưa đăng nhập.
- Bảng `users` lưu username, email, password hash, role, enabled và trạng thái
  xác minh email.
- Đăng ký tạo mã 6 số trong `email_verification_codes`; SMTP dùng biến môi
  trường `REUP_SMTP_*`, local fallback ghi mã vào terminal.
- Admin local đầu tiên được khởi tạo từ biến môi trường `REUP_ADMIN_*`; mật
  khẩu hiện có trong database local không bị thay đổi khi khởi động lại.
- `/admin/users` cho admin xem và khóa/mở khóa user.

Đây là session local của website hiện tại. Khi chuyển sang website cloud,
session web và token Local Engine cần tách thành hai lớp riêng.

## 5. Database hiện tại

Database SQLite: `app/data/reup.db` trong development.

Các bảng chính:

- `users`, `email_verification_codes`.
- `library_videos`, `favorites`, `collections`, `collection_videos`, `ui_state`.
- `sources`, `source_videos`, `source_sync_cache`.
- `jobs`, `video_files`.
- `channels`, `presets`, `settings`.

Library/favorites/collections/UI state đã dùng `user_id`. Bảng `sources` và
`source_videos` hiện vẫn mang tính local dùng chung; đây là điểm cần tách theo
user trước khi nhiều user dùng chung một Local Engine.

## 6. Pipeline xử lý video

Luồng thực tế hiện tại:

```text
source URL
  -> Bilibili/Douyin metadata + thumbnail
  -> yt-dlp / Playwright download
  -> source.mp4 + audio extraction
  -> faster-whisper -> subtitle
  -> Gemini hoặc local translation
  -> VieNeu TTS
  -> subtitle detector / PaddleOCR / auto blur
  -> logo, music, subtitle, voiceover options
  -> FFmpeg renderer
  -> final.mp4
```

Các service cần giữ nguyên logic:

`services/sources/bilibili.py`, `services/sources/douyin.py`,
`transcriber.py`, `translator.py`, `tts.py`, `ttss.py`,
`subtitle_detector.py`, `auto_blur.py`, `final_renderer.py`, `job_db.py`,
`library_db.py` và `core/pipeline.py`.

## 7. Douyin/Bilibili

- Bilibili hỗ trợ profile/source, video lẻ, metadata, thumbnail và pagination.
- Douyin hỗ trợ profile/video, Playwright browser profile, login fallback,
  adaptive video/audio và mux.
- Download hiện chạy trên máy local, đọc cookies/browser profile local và ghi
  file vào thư mục project.
- Đồng bộ source đã có cache per URL, cooldown chống spam và fallback cache khi
  Bilibili rate-limit.

## 8. Các path đang hard-code

Development đang dựa trên:

- `APP_DIR / data`, `APP_DIR / downloads`, `APP_DIR / output`, `APP_DIR / temp`.
- `APP_DIR / channels/<channel>/jobs` và `APP_DIR / jobs`.
- Một số service còn default literal như `app/output/*.srt`, `app/output/*.wav`
  và các đường dẫn renderer.
- `PROJECT_ROOT` được suy ra từ vị trí source; pipeline có cơ chế dò root nhưng
  chưa có một `PathConfig` dùng chung.

Production cần chuyển dần sang:

```text
%LOCALAPPDATA%\ReupAI\data
%LOCALAPPDATA%\ReupAI\downloads
%LOCALAPPDATA%\ReupAI\projects
%LOCALAPPDATA%\ReupAI\output
%LOCALAPPDATA%\ReupAI\temp
%LOCALAPPDATA%\ReupAI\models
%LOCALAPPDATA%\ReupAI\browser
%LOCALAPPDATA%\ReupAI\logs
```

Không đổi path hàng loạt trước khi có lớp abstraction và migration/backup.

## 9. Dependency và rủi ro đóng gói Windows

Runtime cần Python packages trong `requirements.txt`, FFmpeg, yt-dlp,
Playwright/Chromium, faster-whisper/model, PaddleOCR/model, VieNeu/ONNX và
quyền truy cập browser/cookies phù hợp.

Rủi ro chính khi đóng gói PyInstaller:

- model AI lớn và native DLL không được gom đủ;
- Playwright Chromium không có hoặc sai đường dẫn;
- FFmpeg không có trong PATH;
- cookies Chrome bị khóa hoặc không thể copy;
- Gemini key và local token bị đóng gói nhầm;
- process con FFmpeg/yt-dlp không tìm được working directory;
- pipeline dài bị chạy trong HTTP request.

## 10. Phần có thể giữ nguyên

- toàn bộ logic source adapters Bilibili/Douyin;
- pipeline Whisper/Gemini/VieNeu/OCR/blur/FFmpeg;
- database SQLite và job progress;
- UI hiện tại và các luồng chỉnh vùng mờ/logo/preset;
- cache đồng bộ source và các fallback rate-limit;
- auth local làm nền cho tài khoản và admin.

## 11. Phần cần refactor để thành Local Engine

1. Tạo `app/local_engine.py` chạy FastAPI riêng trên `127.0.0.1:17888`.
2. Tách health/status, videos, sources, download, jobs, process và files thành
   local API adapter.
3. Đưa xử lý pipeline vào background job manager; request chỉ trả `job_id`.
4. Tạo `PathConfig` dùng `%LOCALAPPDATA%\ReupAI` trong production và cho phép
   override bằng environment variable trong development.
5. Thêm local secret, pairing code, token phiên và Origin allowlist.
6. Tạo một frontend `LocalEngineClient`, không rải URL localhost trong UI.
7. Chuẩn hóa job states: `queued`, `downloading`, `extracting_audio`,
   `transcribing`, `translating`, `generating_tts`, `detecting_subtitle`,
   `rendering`, `completed`, `failed`, `cancelled`.
8. Đóng gói Windows installer và kiểm tra máy sạch.

## 12. Kiến trúc web mục tiêu

```text
reupai.vn (Vercel: frontend/control UI)
        ↓ HTTPS
Browser
        ↓ loopback + Origin allowlist
127.0.0.1:17888
        ↓
ReupAI.exe / Local Engine
        ↓
SQLite + video + model + FFmpeg trên máy khách
```

Vercel chỉ nên phục vụ frontend và control metadata. Video, project, model,
SQLite và render output không được upload lên Vercel. Vercel Python Functions
không thay thế Local Engine vì có giới hạn bundle/thời gian và không phải
process worker lâu dài.

## 13. Kế hoạch chuyển đổi an toàn

### Phase 2 — Path abstraction

Tạo `app/runtime_paths.py`, thêm backup/migration SQLite, chuyển từng service
đang ghi file sang path provider. Giữ override `D:\reup-ai` cho development.

### Phase 3 — Local Engine API

Tạo adapter API và health/status trước, sau đó nối download/videos/sources.
Chưa đổi renderer.

### Phase 4 — Job manager

Tách request khỏi pipeline, lưu progress/jobs, hỗ trợ stop và resume.

### Phase 5 — Pairing/auth

Local secret, mã ghép nối một lần, token thiết bị, CORS/Origin allowlist và
kiểm tra engine version.

### Phase 6 — Frontend client

Thay dần API local hiện tại bằng `LocalEngineClient`, giữ UI và behavior.

### Phase 7 — Installer + website

PyInstaller/installer, GitHub Releases, frontend web và domain `reupai.vn`.

## 14. Acceptance tests bắt buộc

- Health engine chỉ bind loopback.
- Browser nhận diện connected/offline/version mismatch.
- Pairing token không nằm trong Git hoặc frontend bundle.
- Dán Douyin/Bilibili URL, download và file vẫn ở local.
- Tạo job trả ngay `job_id`, polling tiến độ không giữ request dài.
- Chạy đủ Whisper → Gemini → VieNeu → OCR/blur → FFmpeg.
- Mất engine, dừng job, lỗi FFmpeg và rate-limit hiển thị lỗi thân thiện.
- Upgrade giữ nguyên database/library sau backup/migration.
- Test trên máy Windows sạch không có Python/FFmpeg/Node/Git thủ công.

## 15. Danh sách file dự kiến thay đổi ở phase tiếp theo

- Thêm `app/runtime_paths.py`.
- Thêm `app/local_engine.py` và các module local API nhỏ.
- Điều chỉnh `app/services/job_db.py` để worker/job owner rõ ràng.
- Điều chỉnh các service ghi file sang runtime paths.
- Thêm `docs/LOCAL_ENGINE_API.md`.
- Sau khi API ổn định mới tách frontend web; chưa sửa pipeline business logic.

Theo yêu cầu Master Plan, audit kết thúc tại đây. Chưa tự ý rewrite hoặc
deploy production.
