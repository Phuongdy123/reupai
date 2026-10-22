# Rủi ro phát hành ReupAI Local Engine

Ngày rà soát: 2026-10-23. Phạm vi: mã nguồn và bộ cài Windows trong repository này. Không thể bảo đảm mọi máy, tài khoản Google và nguồn video đều không phát sinh lỗi; các mục dưới đây là các đường lỗi có thể dự báo và hành động cụ thể khi xảy ra.

| Khâu | Rủi ro và dấu hiệu | Biện pháp hiện có / bản 0.2.16 | Rủi ro còn lại và hướng xử lý |
| --- | --- | --- | --- |
| Cập nhật | Setup báo không đóng được ReupAI, hoặc không thay được `ReupAI.exe`. | Installer yêu cầu Engine thoát qua cửa sổ khay hệ thống rồi chờ tiến trình kết thúc; không dùng force kill. | Nếu khay hệ thống hỏng hoặc Engine không trả trạng thái, dừng cập nhật với lời nhắn rõ ràng; người dùng thoát ứng dụng rồi thử lại. |
| Công việc đang chạy | Cập nhật giữa lúc tải hoặc render làm job dở dang. | Trạng thái Engine báo số job và lượt tải đang hoạt động; installer hoãn cập nhật khi một trong hai lớn hơn 0. | Bản cũ không báo số lượt tải; trong lần nâng cấp từ 0.2.15 nên đợi tải xong trước khi mở installer. |
| Cài trùng | Mở lại đúng installer của bản đã cài, gây khóa file không cần thiết. | Installer tương tác nhận diện cùng phiên bản và hỏi rõ có muốn sửa bản cài hiện tại hay không. | Cài đặt im lặng vẫn cho phép chạy lại theo chủ đích của người quản trị. |
| Gói cài thiếu file | Engine không khởi động vì thiếu logo, FFmpeg hoặc FFprobe. | Build dừng nếu các file bắt buộc không có trong gói; phiên bản EXE, Engine và installer phải khớp. | Các tài nguyên phụ thuộc phát sinh trong thư viện AI cần được kiểm tra thêm trên máy sạch trước khi phát hành rộng. |
| Gói cài quá lớn | Tải và cài lâu, thiếu dung lượng khi giải nén. | Inno Setup kiểm tra dung lượng tối thiểu trước cài. | Bộ đóng gói đang chứa nhiều dữ liệu phụ của thư viện AI. Chỉ loại bớt sau khi có bằng chứng OCR/TTS/Whisper vẫn chạy trên máy sạch. |
| Windows/antivirus | File bị khóa, bị cách ly hoặc thiếu quyền ghi thư mục cài. | Cài theo người dùng hiện tại; helper chỉ đóng đúng tiến trình thuộc thư mục cài đã chọn; nếu không xác định được trạng thái thì dừng an toàn. | Nên ký số installer và có kênh hỗ trợ nhận log trên máy khách. Không thể bảo đảm chính sách bảo mật của mọi máy. |
| Khởi động | Port 17888 bị ứng dụng khác chiếm hoặc có hai Engine dùng cùng dữ liệu. | Engine chỉ bind loopback, kiểm tra port và khóa instance, ghi log lỗi khởi động. | Hiển thị lỗi trong Settings và hướng dẫn xác định tiến trình giữ cổng để khách tự xử lý. |
| Nguồn video | Bilibili/Douyin thay giao diện, giới hạn IP, yêu cầu đăng nhập hoặc CDN trả stream lỗi. | Bilibili có browser stream và yt-dlp dự phòng; đồng bộ có thời gian chờ sau rate limit; file tải dở dùng tên staging. | Không thể bảo đảm tải mọi URL. Cần log mã HTTP, nguồn lỗi và cách thử lại sau; khi giới hạn tài khoản phải cho khách biết. |
| Dung lượng | Ổ đĩa hết chỗ giữa tải, nhận dạng hoặc kết xuất. | Pipeline kiểm tra dung lượng tối thiểu trước khi chạy; diagnostics báo dung lượng còn trống. | Route tải nguồn cần ước lượng dung lượng trước tải và xử lý `ENOSPC` bằng thông báo cụ thể. |
| AI trên máy khách | CUDA hoặc DLL của CTranslate2 thiếu/không tương thích. | Whisper tự chuyển sang CPU khi CUDA lỗi lúc tạo model hoặc lúc phiên âm. | Import thư viện ở đầu tiến trình vẫn có thể lỗi trước khi fallback. Cần kiểm tra phụ thuộc trong tiến trình tách biệt và đưa lỗi vào diagnostics. |
| OCR/TTS | Thiếu thư viện, dictionary hoặc model trên máy khách. | Spec gói các thư viện/tài nguyên và kiểm tra `sea_g2p.bin`; diagnostics báo OCR/TTS sẵn sàng ở mức module. | Kiểm tra khả năng chạy thực tế trên máy sạch trước phát hành; trạng thái module có mặt không chứng minh model chạy được. |
| Gemini/Google | OAuth chưa cấp quyền, API chưa bật, quota hoặc thanh toán giới hạn. | Diagnostics tách trạng thái kết nối Google, API key và quyền cần làm mới; pipeline kiểm tra trước công việc dài. | Các điều kiện Google thay đổi ngoài quyền kiểm soát ứng dụng. Cần hiện mã lỗi gốc và bước khắc phục tương ứng, không hứa tự lấy API key chỉ bằng đăng nhập. |
| Job/dữ liệu | Engine mất điện hoặc tắt đột ngột, job kẹt ở trạng thái processing. | SQLite WAL, khóa job trùng, recovery đánh dấu job bị ngắt khi Engine khởi động lại; file nguồn và dữ liệu người dùng ở AppData tách khỏi thư mục cài. | Chưa tự tiếp tục mọi job đang dở; khách có thể chạy lại sau khi xem trạng thái và log. |
| Xuất lại | Render chỉnh sửa lỗi làm mất bản thành phẩm trước. | Luồng render-only tạo output tạm và thay file cuối sau khi hoàn tất. | Vẫn nên giữ lịch sử phiên bản output nếu khách cần quay lại một lần chỉnh sửa cũ. |
| Phát hành | EXE và installer khác phiên bản hoặc tải về bị hỏng. | Build kiểm tra phiên bản; tạo SHA256 cho EXE và installer. | Nên công bố checksum cùng bản phát hành và hướng dẫn xác thực cho kênh tải công khai. |

## Thứ tự xử lý tiếp

1. Chạy bộ cài trên máy Windows sạch và máy đã có 0.2.15, bao gồm tình huống Engine đang chạy và đang có job. Chỉ phát hành rộng sau khi xác nhận.
2. Thêm kiểm tra Whisper/CTranslate2 trong tiến trình riêng để lỗi DLL không làm Engine chết.
3. Thêm kiểm tra dung lượng cho route tải nguồn và phân loại lỗi mạng, quota, giới hạn nguồn.
4. Tạo lịch sử output và đường khôi phục nếu khách chỉnh sửa/rerender thất bại.
5. Ký số bộ cài và phát hành checksum qua kênh tải chính thức.
