# Kế hoạch gói dùng thử và thanh toán ReupAI

Trạng thái: đề xuất để triển khai; chưa có thu tiền hoặc kích hoạt gói trên website hiện tại.

## 1. Gói đề xuất để thử thị trường

| Gói | Quyền dùng | Giá |
| --- | --- | --- |
| Dùng thử | 7 ngày từ lúc bắt đầu job đầu tiên, tối đa 3 job hoàn tất. Dùng đủ tính năng hiện có, không cần thẻ. | Miễn phí |
| Pro | Dùng các tính năng hiện có trên một tài khoản và máy cá nhân; không đặt giới hạn job riêng của ReupAI. | **Giá thử nghiệm đề xuất: 149.000 đ / 30 ngày** |

Giá Pro là giả thuyết kinh doanh để thử với nhóm khách đầu tiên, chưa đưa lên trang bán hàng trước khi chủ sản phẩm chốt. Thời gian và số job của trial phải được hiển thị trước khi khách bắt đầu. Job lỗi hoặc người dùng hủy không trừ lượt; job đang chạy được hoàn tất nếu gói hết hạn giữa chừng. Khi trial hết, dữ liệu và thành phẩm vẫn xem, tải được; chỉ chặn bắt đầu job mới.

**Phân định chi phí:** phí ReupAI trả cho phần mềm, cập nhật và hỗ trợ. Mỗi khách dùng Google Cloud project và quota Gemini của mình; chi phí hoặc giới hạn của Google là riêng, không nằm trong giá ReupAI. Giao diện mua gói phải ghi rõ điều này. Google Cloud yêu cầu quyền dùng quota trên project được chọn.

## 2. Luồng khách hàng

1. Đăng ký hoặc đăng nhập, xác minh email, kết nối Local Engine và kiểm tra Gemini. Quyền dùng thử bắt đầu khi khách bấm chạy job đầu tiên, sau khi các bước chuẩn bị đã sẵn sàng.
2. Trang **Gói của tôi** hiển thị trạng thái trial, ngày hết hạn, số job còn lại, trạng thái Pro, nút **Nâng cấp Pro** và lịch sử thanh toán.
3. Khi mua Pro, website tạo đơn trên server và chuyển khách sang trang thanh toán payOS. Khách thanh toán qua link/QR; website hiển thị **Đang xác nhận** cho đến khi server xác minh thanh toán.
4. Sau webhook hợp lệ, quyền Pro cập nhật trên server. Trang web và Local Engine nhận quyền mới; khách có thể xử lý tiếp mà không cần cài lại EXE.
5. Giai đoạn đầu gia hạn bằng link thanh toán mới trước ngày hết hạn. Chưa gọi là “tự động gia hạn” hoặc tự trừ tiền khi chưa tích hợp và kiểm thử cơ chế thu định kỳ thực tế.

## 3. Kiến trúc triển khai

- Supabase: tách `profiles.status` (trạng thái tài khoản) khỏi `entitlements` (trial/Pro, ngày bắt đầu, ngày hết hạn), `orders` (đơn hàng và số tiền do server quyết định), `payment_events` (webhook đã xử lý), `trial_usage` (job hoàn tất). RLS chỉ cho khách xem dữ liệu của mình; ghi quyền Pro bằng server/service role.
- Next.js/Vercel: API tạo đơn kiểm tra phiên đăng nhập, tra giá từ cấu hình server, tạo `orderCode` duy nhất, gọi payOS. Client không được gửi giá hoặc tự chọn trạng thái đã trả tiền.
- Webhook payOS: xác minh chữ ký, `orderCode`, số tiền và trạng thái; xử lý lặp idempotent trong một giao dịch dữ liệu; chỉ lúc đó mới cấp/gia hạn Pro. `returnUrl` chỉ hiển thị kết quả và gọi API tra trạng thái, không tự cấp quyền.
- Local Engine: kiểm tra quyền khi nhận `POST /api/process`, không chỉ ẩn nút ở website. Quyền là token ngắn hạn do server ký, gắn user và máy; Engine xác minh chữ ký và hạn. Gói Pro có thời gian ân hạn offline ngắn để mạng tạm lỗi không chặn công việc; trial cần kiểm tra online và không dựa vào đồng hồ máy. Tác vụ đang chạy được tiếp tục.
- Đăng nhập hiện tại đang yêu cầu quản trị duyệt `profiles.status`. Trước khi mở trial tự phục vụ, tách bước duyệt beta khỏi quyền dùng gói để tài khoản đã xác minh email có thể bắt đầu trial; vẫn giữ khả năng vô hiệu hóa tài khoản lạm dụng.
- Secret payOS chỉ lưu trong biến môi trường server. Không đưa API key, checksum key hoặc Supabase service role vào frontend/EXE.

## 4. Thứ tự triển khai

1. **Quyền gói:** migration Supabase, API `/api/billing/entitlement`, trang Gói của tôi, chặn job mới ở cả web và Engine. Kiểm thử hết trial, job lỗi, job đang chạy, đổi máy và mất mạng.
2. **Thanh toán:** tạo đơn payOS, trang trạng thái đơn, webhook xác minh chữ ký, chống xử lý trùng, đối soát đơn pending, gia hạn thủ công, lịch sử đơn.
3. **Vận hành:** quản trị xem/hoàn quyền, email nhắc trước khi hết hạn, đối soát giao dịch, hỗ trợ hoàn tiền theo chính sách đã công bố. Sau khi có dữ liệu sử dụng mới cân nhắc gói năm, nhóm hoặc tự động gia hạn.

## 5. Điều kiện nghiệm thu

- Khách không thể sửa giá hay tự bật Pro từ trình duyệt, Local Engine hoặc `returnUrl`.
- Webhook sai chữ ký, sai số tiền, sai đơn hoặc gọi lặp không cấp quyền.
- Thanh toán thành công nhưng trình duyệt đóng vẫn cấp quyền; webhook chậm vẫn hiện **Đang xác nhận** và có đối soát lại.
- Hết trial/Pro chỉ chặn job mới, không xóa file và không dừng job đang chạy.
- Trang gói ghi rõ Gemini tính theo Google Cloud project của khách.
- Kiểm thử thanh toán thực tế bằng đơn giá trị nhỏ trước khi mở bán. Tài liệu payOS hiện nói không có sandbox riêng.

## 6. Quyết định cần chốt trước khi thu tiền

- Xác nhận giá thử nghiệm 149.000 đ / 30 ngày và điều kiện 7 ngày/3 job.
- Tài khoản merchant payOS, tài khoản ngân hàng nhận tiền và thông tin xuất hóa đơn/chính sách hoàn tiền.
- Chính sách số máy sử dụng đồng thời cho một tài khoản và thời gian ân hạn offline.

## Tài liệu đối chiếu

- [payOS: tạo link thanh toán và tra trạng thái đơn](https://payos.vn/docs/api/)
- [payOS: webhook và dữ liệu chữ ký](https://payos.vn/docs/du-lieu-tra-ve/webhook/)
- [payOS: môi trường kiểm thử](https://payos.vn/docs/moi-truong-test/)
- [Google: quyền sử dụng quota project](https://docs.cloud.google.com/docs/quotas/set-quota-project)
- [Google: thanh toán Gemini API](https://ai.google.dev/gemini-api/docs/billing)
