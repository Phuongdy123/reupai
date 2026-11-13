# Kích hoạt gói Free / Pro

Mã thanh toán được giữ ở trạng thái tắt mặc định (`BILLING_ENABLED=false`). Giao diện gói có thể được kiểm tra trước khi nhận tiền thật. Gói Free có 3 video hoàn tất; job lỗi hoặc bị hủy không trừ lượt. Pro giá 149.000đ cho 30 ngày và không tự gia hạn.

## Chuẩn bị

1. Tạo tài khoản và xác minh cá nhân/doanh nghiệp tại [my.payos.vn](https://my.payos.vn), sau đó tạo kênh thanh toán. payOS cấp **Client ID, API Key, Checksum Key** cho kênh. Không dán các khóa vào chat, mã nguồn hoặc biến có tiền tố `NEXT_PUBLIC_`.
2. Áp dụng `supabase/migrations/20261101_billing_free_pro.sql` trong Supabase SQL Editor của đúng project. Migration cho tài khoản đăng ký mới vào Free sau khi xác minh email. Tài khoản cũ đang `pending` vẫn chờ duyệt như trước.
3. Phát hành Local Engine 0.2.26 trở lên cho khách. Engine mới xác minh lượt xử lý với website và báo trạng thái hoàn tất/lỗi/hủy về server. Web phải kiểm tra capability `billing_ledger` trước khi bắt đầu job.
4. Trong Vercel Production, đặt `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`, `SUPABASE_SECRET_KEY` (khóa `sb_secret_...`), `BILLING_SITE_URL=https://www.reupai.cloud`. Giữ `BILLING_ENABLED=false` ở bước này. Redeploy; checkout vẫn bị khóa nhưng endpoint webhook đã có thể xác minh payload mẫu có chữ ký của payOS. Backend vẫn tạm hỗ trợ `SUPABASE_SERVICE_ROLE_KEY` cũ để chuyển đổi không gián đoạn.
5. Trong kênh payOS, cấu hình và xác nhận webhook `https://www.reupai.cloud/api/billing/webhook`. Webhook kiểm tra HMAC, mã đơn, số tiền 149.000đ, loại tiền VND và `paymentLinkId` trước khi cộng 30 ngày. Lượt webhook lặp lại không cộng thêm ngày.
6. Chỉ sau khi đã kiểm tra EXE mới và webhook, đổi `BILLING_ENABLED=true` trong Vercel Production rồi redeploy. Xác nhận `/api/billing/config` trả `{"enabled":true}`.

## Kiểm tra trước khi mở bán

- Tài khoản mới thấy Free 3/3; 3 video thành công trừ đúng 3 lượt. Video lỗi hoặc hủy không trừ lượt. Lượt thứ tư báo cần Pro. Hai job chạy đồng thời không vượt giới hạn.
- Chuyển trình duyệt/đóng tab trong lúc xử lý, Engine vẫn báo kết quả về server.
- Tạo đơn 149.000đ rồi hoàn thành một giao dịch thật nhỏ theo quy trình payOS. Chỉ webhook đã ký mới kích hoạt Pro; quay về URL thanh toán không tự kích hoạt. Webhook gửi lại cùng đơn phải idempotent.
- Hết 30 ngày, tài khoản quay lại Free với số lượt đã dùng trước đó; thanh toán mới kéo dài thêm 30 ngày từ hạn hiện có.

payOS hiện yêu cầu tài khoản/kênh đã xác minh để dùng API và tài liệu của họ mô tả [API tạo liên kết thanh toán](https://payos.vn/docs/api/) cùng [cách xác minh chữ ký webhook](https://payos.vn/docs/tich-hop-webhook/kiem-tra-du-lieu-voi-signature/). Không có môi trường sandbox riêng theo [tài liệu kiểm thử payOS](https://payos.vn/docs/moi-truong-test/); cần thử giao dịch thực tế sau khi kênh sẵn sàng.
