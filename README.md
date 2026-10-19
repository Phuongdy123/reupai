# Reup AI

Ứng dụng Python để theo dõi nguồn video Bilibili/Douyin, tải video, nhận dạng và dịch phụ đề, tạo giọng đọc tiếng Việt, rồi kết xuất video đầu ra.

## Chạy ứng dụng

Từ thư mục gốc dự án, cài các thư viện Python nếu cần:

```powershell
python -m pip install -r requirements.txt
```

Khởi chạy dashboard:

```powershell
python -m app.main
```

Ứng dụng mặc định mở tại `http://127.0.0.1:8000`. Trong bản cài đặt hiện tại có thể dùng Python của môi trường sẵn có:

```powershell
.\venv\Scripts\python.exe -m app.main
```

Chạy Local Engine adapter riêng để chuẩn bị kết nối website:

```powershell
.\venv\Scripts\python.exe -m app.local_engine
```

Local Engine chỉ bind `127.0.0.1:17888`. Kiểm tra nhanh:

```powershell
Invoke-WebRequest http://127.0.0.1:17888/api/health
```

Local Engine root kiểm tra nhanh tại `http://127.0.0.1:17888/` và không cần
authentication. Runtime path development giữ ở `app/`; khi đặt
`REUP_ENV=production` hoặc `REUP_DATA_DIR`, Local Engine dùng một root riêng
(`data`, `downloads`, `projects`, `output`, `temp`, `models`, `browser`,
`logs`, `config`, `channels`, `jobs`, `local_token`). Migration legacy chỉ
copy file còn thiếu và ghi dấu migration, không ghi đè dữ liệu mới.

Chạy frontend local (Phase 3.1):

```powershell
cd web
Copy-Item .env.local.example .env.local
npm install
npm run dev
```

Frontend mở tại `http://localhost:3001`. Frontend dùng
`NEXT_PUBLIC_LOCAL_ENGINE_URL` để tìm Local Engine; mặc định development là
`http://127.0.0.1:17888`. Bấm **Kết nối ReupAI** để mở trang cấp quyền của
Local Engine. Mã cấp quyền chỉ dùng một lần và được đổi thành browser session
token; `app/local_token` không bao giờ được gửi cho trình duyệt.

Development CORS có allowlist, mặc định gồm `http://localhost:3001` và
`http://127.0.0.1:3001`. Có thể ghi đè bằng biến môi trường
`REUP_ENGINE_ALLOWED_ORIGINS` (danh sách phân tách bằng dấu phẩy) khi cần đổi
origin ở môi trường khác.

`app/local_token` chỉ được Local Engine dùng nội bộ và không được commit lên
Git. Browser frontend luôn dùng browser session token nhận sau bước cấp quyền;
token nội bộ không được gửi ra ngoài process Engine.

Sau lần cấp quyền đầu tiên, Local Engine lưu grant dạng fingerprint trong
`app/config/authorization_grants.json` (hoặc `%LOCALAPPDATA%\\ReupAI\\config`
khi chạy production). Browser chỉ giữ credential grant dạng opaque để xin
browser session mới sau khi Engine restart; grant bị xóa hoàn toàn khi bấm
**Thu hồi**.

Cần cấu hình `GEMINI_API_KEY` trong `.env` ở thư mục gốc để dùng dịch vụ dịch Gemini. Pipeline cũng cần các chương trình hệ thống mà nó gọi, gồm FFmpeg; hãy bảo đảm chúng có thể được tìm thấy qua `PATH`.

## Điều chỉnh tốc độ tải và RAM

Mặc định, web chỉ chạy một lượt tải và một pipeline AI cùng lúc để tránh nhiều tiến trình trình duyệt/Whisper/FFmpeg làm RAM tăng đột ngột. Có thể đổi các giá trị này trong `.env`:

```dotenv
REUP_MAX_PARALLEL_DOWNLOADS=1
REUP_MAX_PARALLEL_PIPELINES=1
REUP_YTDLP_CONCURRENT_FRAGMENTS=2
REUP_SUBTITLE_MIN_POSITIVE_HITS=2
REUP_MIN_FREE_DISK_BYTES=2147483648
```

`REUP_YTDLP_CONCURRENT_FRAGMENTS` tăng tốc các video DASH/HLS bằng cách tải một số phân đoạn song song; đặt `1` để giảm RAM hoặc tăng tối đa `8` nếu máy còn dư tài nguyên. Tùy chọn HTTP chunk `2M` hiện tại được giữ để tương thích; đặt `REUP_HTTP_CHUNK_SIZE=off` để tắt nếu nguồn không bị bóp băng thông. Các giá trị giới hạn đồng thời được chặn trong khoảng an toàn của ứng dụng.

`REUP_SUBTITLE_MIN_POSITIVE_HITS=2` cho phép phụ đề ngắn được chấp nhận khi điểm OCR và độ phủ thời gian vẫn đạt ngưỡng. Tăng lên `3` nếu muốn detector khó chấp nhận vùng chữ hơn.

Mỗi job lưu một snapshot cấu hình bất biến và fingerprint trong SQLite. Vì vậy
job đang chờ không bị preset mới ghi đè, thay đổi giọng/tốc độ sẽ tạo lại cache
TTS, và mỗi link nhạc có cache riêng. Local Engine dùng SQLite WAL, từ chối job
trùng và đánh dấu `interrupted` cho job bị ngắt do Engine restart. Endpoint
`/api/diagnostics` cung cấp trạng thái FFmpeg, Python, CPU, ổ đĩa và hàng đợi
sau khi browser đã được cấp quyền.

## Lệnh tiện ích

Các lệnh cũ vẫn được giữ để không làm gián đoạn cách chạy hiện tại:

```powershell
python app/pipeline.py --help
python app/source_manager.py --help
python app/setup_v12.py
```

Phần triển khai mới được chia theo vai trò:

```powershell
python -m app.cli.source_manager --help
python -m app.cli.setup_v12
```

## Bố cục

```text
app/
├── core/                 # Pipeline xử lý video
├── cli/                  # Công cụ dòng lệnh quản lý nguồn và cơ sở dữ liệu
├── services/             # Nguồn video, cơ sở dữ liệu, phụ đề, dịch, TTS, kết xuất
├── web/
│   ├── server.py         # FastAPI dashboard
│   ├── templates/        # HTML templates
│   └── static/           # CSS và JavaScript
├── data/                 # Cơ sở dữ liệu và cấu hình cục bộ
├── channels/             # Kênh và dữ liệu theo kênh
├── downloads/            # Video đã tải
├── jobs/                 # Tác vụ pipeline
├── output/               # Kết quả và tệp trung gian
└── temp/                 # Tệp tạm khi xử lý

samples/                  # Media mẫu được gom khỏi thư mục gốc
archive/                  # Giao diện cũ và tệp thừa được lưu để tra cứu
```

Các thư mục dữ liệu trong `app/` được giữ nguyên vị trí vì mã hiện tại và các tác vụ tự động đang dùng trực tiếp những đường dẫn đó. Không xóa chúng nếu còn cần lịch sử, video tải xuống hoặc kết quả đã tạo.

`app/demo_ui.py`, `app/pipeline.py`, `app/source_manager.py` và `app/setup_v12.py` là các điểm vào tương thích. Mã chính nằm trong `app/web`, `app/core` và `app/cli`.
# Authentication and local engine

The local dashboard now supports separate browser sessions, user registration
with email verification, and an admin user-management page at `/admin/users`.
The first local admin is created only when `REUP_ADMIN_USERNAME`,
`REUP_ADMIN_PASSWORD`, and `REUP_ADMIN_EMAIL` are configured. Existing local
admin accounts are never reset when the server restarts.

For real email delivery, copy the SMTP values from `.env.example` into the
project `.env`. If SMTP is not configured, the six-digit verification code is
printed in the terminal running Reup AI so local development still works.

The intended deployment boundary is:

`reupai.vn (web/auth) -> browser session -> localhost Reup AI Local Engine`

The current implementation remains local; no public deployment or external
database is enabled.

## Đóng gói Local Engine cho Windows

Cài dependency runtime và build trong virtual environment của dự án:

```powershell
venv\Scripts\python.exe -m pip install -r requirements-windows.txt
venv\Scripts\python.exe -m pip install -r requirements-build.txt
.\scripts\build_windows.ps1
```

Bản portable được tạo tại `dist\ReupAI\ReupAI.exe`. Nếu máy build có Inno
Setup (`iscc`) thì script đồng thời tạo installer trong `release\`. Có thể dùng
`-SkipInstaller` để chỉ tạo bản portable.

Ứng dụng chỉ lắng nghe tại `127.0.0.1:17888`, mở frontend
`https://www.reupai.cloud` và nằm trong khay hệ thống. Dữ liệu production được
lưu trong `%LOCALAPPDATA%\ReupAI`; cấu hình Local Engine nằm tại
`%LOCALAPPDATA%\ReupAI\config\engine.env`. Gỡ ứng dụng không xóa video, project
hoặc thành phẩm của người dùng.

### Checklist trước khi phát hành cho khách Windows

1. Build từ môi trường sạch bằng `scripts\build_windows.ps1`, rồi phát hành
   `release\ReupAI-Setup-<version>.exe` và checksum SHA-256 đi kèm.
2. Cài thử bằng installer trên một Windows x64 khác, mở ReupAI hai lần, rồi
   xác nhận lần thứ hai chỉ mở website thay vì tạo thêm Local Engine.
3. Vào **Cài đặt → Chẩn đoán xử lý**. FFmpeg, FFprobe, trình tải video và
   trình duyệt nguồn phải báo sẵn sàng. Nếu dùng Vietsub hoặc Voice, thêm
   `GEMINI_API_KEY=...` vào `%LOCALAPPDATA%\ReupAI\config\engine.env`, sau đó
   khởi động lại Local Engine.
4. Chạy một video Vietsub, một video Voice, một link Douyin và một video có
   nhạc nền. Hệ thống thử Chrome, Microsoft Edge rồi Chromium đi kèm để đọc
   Douyin; có thể đặt `REUP_BROWSER_CHANNEL=chrome`, `msedge` hoặc `bundled`
   trong `engine.env` nếu cần cố định trình duyệt.
5. Khi job lỗi, web chỉ hiện nguyên nhân có thể xử lý; nhật ký đầy đủ nằm ở
   `%LOCALAPPDATA%\ReupAI\logs` và log của từng job nằm trong thư mục job.

Engine chỉ bind loopback `127.0.0.1`. File video, token Engine, Gemini key và
dữ liệu job không được gửi lên website. Website chỉ nhận một browser session
gắn với đúng origin để điều khiển Engine trên chính máy đó.

## Tài khoản website và phê duyệt truy cập

Website production dùng Supabase cho **tài khoản và quyền truy cập**. Local Engine, video, jobs, SQLite và file thành phẩm vẫn chỉ nằm trên máy người dùng.

1. Tạo một Supabase project, mở **SQL Editor** và chạy `supabase/migrations/20261014_account_access.sql`. Nếu project đã tạo trước khi cập nhật username login, chạy thêm `supabase/migrations/20261014_username_login.sql`.
2. Trong Supabase Authentication, bật xác minh email; thêm `https://www.reupai.cloud/auth/callback` và `https://reupai.cloud/auth/callback` vào Redirect URLs.
3. Trong Vercel, thêm cho Production các biến sau rồi redeploy:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
   SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
   ```

   `SUPABASE_SERVICE_ROLE_KEY` chỉ dùng trên server Vercel. Không đưa nó vào file frontend, biến `NEXT_PUBLIC_*`, Git hoặc chat.
4. Đăng ký và xác minh tài khoản chủ sở hữu. Trong SQL Editor, duyệt và gán quyền quản trị cho email đó một lần:

   ```sql
   update public.profiles
   set role = 'admin', status = 'approved'
   where email = 'EMAIL_CHU_SO_HUU';
   ```

Người dùng dùng email để đăng ký/xác minh và dùng **tên đăng nhập hoặc email** để đăng nhập. Sau đó, chủ sở hữu dùng **Quản trị tài khoản** trong Workspace để duyệt hoặc khóa các tài khoản tiếp theo. Tài khoản mới luôn ở trạng thái `pending` cho đến khi được duyệt.
