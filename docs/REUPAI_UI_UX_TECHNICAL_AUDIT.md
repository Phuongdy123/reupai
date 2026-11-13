# ReupAI — UI/UX & Frontend Technical Audit

**Ngày kiểm tra:** 04/11/2026
**Phạm vi:** source tree web/, production HTTP read-only tại https://www.reupai.cloud, build và các kiểm tra responsive có sẵn trong repository.
**Giới hạn:** không đăng nhập tài khoản thật, không tạo job video, không gọi Gemini, không tạo giao dịch, không ghi dữ liệu vào production. Chưa có tài khoản test production để kiểm tra các bước sau đăng nhập.

## Follow-up sau audit — 04/11/2026

Hai vấn đề đã được xử lý sau lần audit và push lên production trong commit `8424e21`:

- **AUTH-01:** khi thiếu cấu hình Supabase, middleware chỉ cho qua route công khai và chuyển các route workspace sang đăng nhập, giữ nguyên đường dẫn đích.
- **BILL-01:** trang gói phân biệt đơn đã hủy/thất bại; polling trạng thái đơn dừng khi có trạng thái cuối hoặc sau tối đa 4 phút, kèm nút kiểm tra lại.

Hiệu năng Dashboard được điều chỉnh tiếp trong commit kế tiếp: job đang chạy vẫn được hỏi mỗi 2 giây; khi rảnh giảm còn 15 giây; số liệu tổng quan chuyển từ 10 lên 30 giây khi rảnh. Khi quay lại tab, trang vẫn làm mới ngay.

Build Next.js **PASS**, test hiện có **3/3 PASS**. Production trả `/`, `/plans`, `/giai-phap`, `robots.txt`, `sitemap.xml` với HTTP 200; `/app` trả 307 khi chưa đăng nhập. Bundle `/plans` đang phục vụ có chuỗi UI của nút “Kiểm tra lại”. Chưa chạy giao dịch hoặc đăng nhập production; nhánh middleware thiếu cấu hình được compile/build, chưa chạy trực tiếp qua browser với môi trường production.

## A. Executive Summary

ReupAI hiện dùng Next.js 14 App Router, React 18 và CSS viết trực tiếp. Sản phẩm đã có luồng web SaaS thực tế gồm đăng nhập, workspace, dashboard, quản lý thư viện video, cài đặt Local Engine/Gemini, giới hạn Free/Pro, PayOS và trang quản trị. Luồng video chính vẫn phụ thuộc Local Engine trên máy khách; trang Nguồn video nạp một runtime JavaScript cũ qua lớp tích hợp React.

### Điểm tốt

- npm run build hoàn tất thành công; Next tạo 45 trang tĩnh và route/API động.
- Kiểm tra responsive đã lưu trong artifacts/redesign/checks.json: 29 lần kiểm tra Chromium không có tràn ngang ở các trang/độ rộng đã chọn.
- Middleware xác thực Supabase và API quản trị tự kiểm tra quyền admin; API webhook PayOS xác minh chữ ký trước khi áp dụng đơn.
- Màn hình có loading, empty, error và retry ở các luồng chính; hỗ trợ prefers-reduced-motion trong các stylesheet đang dùng.
- Production trả HTTP 200 cho trang công khai và chuyển /app, /sources chưa đăng nhập sang /sign-in; HSTS đã bật.

### Điểm yếu và rủi ro chính

- Middleware mở truy cập khi thiếu biến môi trường Supabase thay vì fail closed; API vẫn cần tự bảo vệ, nhưng toàn bộ trang giao diện riêng tư vẫn được trả về.
- Trang thanh toán tiếp tục polling không giới hạn và mọi đơn không ở trạng thái paid đều hiển thị như đang chờ; trường hợp hủy/thất bại không có kết thúc rõ ràng.
- Dashboard hỏi Local Engine mỗi 2 giây kể cả lúc không có job chạy; đây là tải nền tránh được trong phiên để mở lâu.
- Hệ thống CSS có nhiều bộ token :root trùng tên và stylesheet được import toàn cục theo chuỗi dài; dễ phát sinh sai khác giữa giao diện React và runtime nguồn video.
- Source route nặng nhất trong build: 53.4 kB riêng route, 157 kB First Load JS; source runtime cũ được mount qua innerHTML và cần được tách/kiểm thử có chủ đích.
- Chưa có script lint riêng hoặc bộ UI/E2E/accessibility tự động. Kiểm tra responsive sẵn có chỉ đo overflow ở một tập route/viewport, không xác nhận WCAG hay hoạt động trên Firefox/WebKit.

### 5 việc ưu tiên

1. **P1 — Bảo vệ fail-closed:** không phục vụ workspace khi cấu hình Supabase bị thiếu; bổ sung kiểm thử cấu hình lỗi.
2. **P1 — Kết thúc trạng thái thanh toán:** xử lý cancelled/failed, dừng polling khi xong và giới hạn thời gian kiểm tra.
3. **P2 — Giảm polling dashboard:** gọi endpoint job thường xuyên khi đang xử lý; giảm tần suất/ngừng khi rảnh và khi tab ẩn.
4. **P2 — Chuẩn hóa CSS:** thống nhất tokens và giảm xung đột giữa stylesheet toàn cục/runtime cũ.
5. **P2 — Thiết lập kiểm tra tự động frontend:** navigation, auth có mock, xử lý nguồn với fixture, modal, keyboard/accessibility và responsive.

## B. Route & Component Inventory

### Framework và cấu trúc

| Hạng mục | Phát hiện |
|---|---|
| Framework | Next.js 14.2.15 App Router, React/React DOM 18.3.1 |
| UI library | Không có thư viện component chuyên biệt; HTML/React và CSS thủ công |
| Routing | Next App Router trong web/app/; route handlers cho API |
| State | React local state/hooks; EngineProvider chia sẻ trạng thái kết nối Local Engine; sessionStorage cho lịch sử chat ngắn; Supabase cho tài khoản; Local Engine cho thư viện/media local |
| Styling | 20 stylesheet CSS được nối từ web/app/globals.css; có bộ token trong nhiều stylesheet nhưng không có một nguồn duy nhất |
| Video workflow | /sources ghép component React với sources-runtime.js/sources-markup.js; Local Engine thực hiện tải, xử lý, preview và lưu file |
| Scripts | dev, build, start; không có lint/test trong web/package.json |
| Dữ liệu mock | Không thấy mock data sản phẩm trong các component đã audit; screenshot responsive trước đó là fixture/local UI, không đại diện cho kết quả job thật |

### Trang web

| Route | Vai trò | Bảo vệ/điều kiện | Tình trạng kiểm tra |
|---|---|---|---|
| / | Landing, thông tin sản phẩm, SEO | Công khai | Source + HTTP production |
| /sign-in, /sign-up | Đăng nhập/đăng ký email hoặc Google | Công khai | Source + HTTP; không chạy OAuth thật |
| /pending | Tài khoản chờ duyệt | Công khai có điều kiện | Source/build |
| /app | Dashboard, trợ lý, job gần đây, gợi ý | Đăng nhập và approved khi Supabase cấu hình | Source + production chuyển hướng + responsive fixture |
| /sources | Tìm/đồng bộ nguồn, tải và cấu hình xử lý | Cần Local Engine kết nối | Source + production chuyển hướng + build; không tạo job thật |
| /downloads, /outputs, /favorites | Video local, thành phẩm, yêu thích | Workspace | Source/build; responsive fixture cho downloads/outputs |
| /collections, /series | Gom video, quản lý tập/series | Workspace | Source/build |
| /history | Lịch sử job | Workspace | Source/build; responsive fixture |
| /settings | Local Engine, Gemini, chẩn đoán | Workspace | Source/build; responsive fixture |
| /profile | Hồ sơ, tài khoản | Workspace | Source/build; responsive fixture |
| /plans | Free/Pro, thanh toán, lịch sử đơn | Mở được cả công khai và sau đăng nhập | Source + HTTP production; không giao dịch thật |
| /help, /local-engine | Hỗ trợ, hướng dẫn cài Local Engine | Workspace theo middleware | Source/build; responsive fixture cho help |
| /local-engine/callback, /auth/callback | Nhận kết quả OAuth | Callback | Source/build |
| /giai-phap, /giai-phap/[slug] | Trang SEO theo giải pháp | Công khai | Source/build; 9 slug được tạo tĩnh |
| /privacy, /terms | Chính sách và điều khoản | Công khai | Source/build + HTTP production |
| /admin/users | Quản trị người dùng và quota | Middleware + API yêu cầu admin approved | Source/build; không dùng tài khoản production |

### API chính được tìm thấy

/api/auth/login, /api/profile, /api/admin/users, /api/billing/{me,config,checkout,webhook}, /api/billing/jobs/{claim,finish,reserve} và /auth/callback. Các API không qua middleware matcher; do đó kiểm tra xác thực/quyền phải nằm trong từng route handler. admin/users và billing user handlers có kiểm tra server-side trong source đã xem.

### Components chính

| Component | Trách nhiệm |
|---|---|
| app-shell.jsx | Sidebar, điều hướng, trạng thái Local Engine, menu tài khoản, badge gói, footer workspace |
| dashboard.jsx | Thống kê, kết nối, job đang chạy, gần đây, gợi ý và trợ lý |
| workspace-assistant.jsx | Chat Gemini, nhận diện link Bilibili/Douyin, đính kèm ảnh, mở luồng cấu hình |
| sources-page.jsx + legacy/sources-runtime.js | Cầu nối React/Local Engine với giao diện nguồn và dialog cấu hình video |
| library-page.jsx, library-ui.jsx, series-page.jsx, output-editor.jsx | Thư viện, xem media, tổ chức series, chỉnh vùng mờ thành phẩm |
| settings-page.jsx | Cấu hình, kiểm tra/khôi phục Google Gemini và Local Engine |
| auth-card.jsx | Đăng nhập/đăng ký, Google OAuth và onboarding Gemini |
| plans-page.jsx, profile-page.jsx, admin-users-page.jsx | Gói, hồ sơ, quyền quản trị |

## C. Issue List

### P1 — High

#### AUTH-01 — Middleware fail-open khi thiếu cấu hình Supabase

- **Ảnh hưởng:** mọi route giao diện được xử lý bởi middleware; rủi ro cao nhất ở /app, /sources, /settings, /profile, /admin/users.
- **Vị trí:** web/src/lib/supabase/middleware.js:7-8; matcher ở web/middleware.js:5.
- **Cách tái hiện:** chạy/deploy với thiếu NEXT_PUBLIC_SUPABASE_URL hoặc NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, sau đó mở /app trong cửa sổ chưa đăng nhập.
- **Actual:** middleware trả NextResponse.next() trước khi kiểm tra user; trang giao diện riêng tư vẫn được render. Các API được route riêng nên vẫn cần kiểm tra quyền độc lập.
- **Expected:** thiếu cấu hình xác thực phải chặn truy cập riêng tư bằng trang lỗi cấu hình an toàn; không được coi là phiên hợp lệ.
- **Nguyên nhân:** fallback tiện cho môi trường local đang áp dụng như hành vi fail-open.
- **Tác động UX/bảo mật:** môi trường deploy sai cấu hình có thể trả HTML/UI của route riêng tư mà không xác thực; API vẫn phải tự kiểm tra quyền và cần được audit độc lập. Người dùng cũng có thể vào trang rồi gặp lỗi API.
- **Khắc phục:** phân tách public routes trước; nếu Supabase thiếu, chỉ cho qua public routes và hiện trang cấu hình lỗi. Thêm test middleware cho biến env thiếu, user vắng, user pending/approved, admin và API auth độc lập.
- **Độ phức tạp:** Medium.
- **Bằng chứng:** web/src/lib/supabase/middleware.js:7-8; production hiện tại có Supabase hoạt động theo quan sát HTTP /app → 307 /sign-in?next=%2Fapp, nên lỗi này là rủi ro triển khai khi env bị thiếu, chưa tái hiện trên production.

### P2 — Medium

#### BILL-01 — Trang gói không phân biệt hủy/thất bại và polling không dừng

- **Ảnh hưởng:** /plans?order=..., luồng checkout PayOS.
- **Vị trí:** web/src/components/plans-page.jsx:10-29, :44-55.
- **Cách tái hiện:** mở checkout, hủy thanh toán để quay về URL có result=cancel, hoặc xem đơn ở trạng thái cancelled/failed.
- **Actual:** orderCode khiến gọi /api/billing/me mỗi 4 giây vô thời hạn đến khi rời trang. Component chỉ tìm đơn paid; mọi trạng thái khác vẫn hiện “Đang kiểm tra đơn…”. result trong URL không được đọc.
- **Expected:** hiển thị trạng thái theo đơn (đang chờ/đã trả/hủy/thất bại), kết thúc polling khi trạng thái cuối hoặc hết thời gian; nút thử kiểm tra lại rõ ràng.
- **Nguyên nhân:** polling gắn vào sự tồn tại của mã đơn, không dựa vào trạng thái trả về; UI chỉ có nhánh paid và not paid.
- **Tác động UX:** người mua tưởng thanh toán chưa xong dù đã hủy hoặc đơn lỗi; polling vô ích gây request liên tục.
- **Khắc phục:** đọc trạng thái order từ account.orders, xử lý result, dừng poll khi paid/cancelled/failed, đặt deadline/backoff và nút làm mới thủ công.
- **Độ phức tạp:** Low.
- **Bằng chứng:** web/src/components/plans-page.jsx:28 interval 4000ms; :44-55 chỉ có paidOrder và nhánh “đang kiểm tra”.

#### PERF-01 — Dashboard polling job mỗi 2 giây ngay cả khi rảnh

- **Ảnh hưởng:** /app, Local Engine API trên máy người dùng.
- **Vị trí:** web/src/components/dashboard.jsx:56-63.
- **Cách tái hiện:** mở Dashboard đã kết nối Engine nhưng không có job chạy trong ít nhất một phút; quan sát /api/jobs trên localhost.
- **Actual:** jobs fetch mỗi 2 giây (tối đa 30 lần/phút); dashboard stats mỗi 10 giây. Có kiểm tra tab visible và chống request chồng lấn, nhưng không dừng khi jobs.length === 0.
- **Expected:** khi có job thì cập nhật nhanh; khi rảnh giảm tần suất hoặc chỉ fetch khi có event/thay đổi trạng thái; khi tab ẩn thì không poll.
- **Nguyên nhân:** timer dựa duy nhất vào trạng thái connected, không vào trạng thái job.
- **Tác động UX/kỹ thuật:** tăng hoạt động nền trong Local Engine và browser, đặc biệt khi nhiều tab hoặc workspace mở lâu. Đây là ước tính theo chu kỳ source code, không phải đo CPU/mạng thực tế.
- **Khắc phục:** poll nhanh khi active job, giảm dần khi rảnh, refresh ngay khi tab visible/job event, thêm AbortController/cleanup nếu kết nối đổi giữa request.
- **Độ phức tạp:** Medium.
- **Bằng chứng:** web/src/components/dashboard.jsx:60-61; request guard tại :33-47 giúp tránh overlap.

#### PERF-02 — Trang Nguồn video có bundle frontend lớn nhất

- **Ảnh hưởng:** /sources, luồng quan trọng nhất của sản phẩm.
- **Vị trí:** web/src/components/sources-page.jsx:22-46; import runtime tại web/src/legacy/sources-runtime.js; build output.
- **Cách tái hiện:** npm run build trong web/; xem bảng route size.
- **Actual:** /sources có route JS 53.4 kB và First Load JS 157 kB; /app 3.77 kB/114 kB. Nguồn video mount runtime legacy và markup khi Engine kết nối.
- **Expected:** tải lõi danh sách trước; cấu hình video, preview/editor và hành vi phụ chỉ tải khi cần. Giữ kích thước tải và parse phù hợp máy cấu hình thấp.
- **Nguyên nhân:** workflow lớn được tập trung trong sources-runtime.js và component import trực tiếp; chưa có phân tách tính năng theo lúc sử dụng.
- **Tác động UX:** có nguy cơ tăng thời gian tải/parse và tương tác đầu trang trên laptop yếu hoặc mạng chậm. Không có Lighthouse/Web Vitals thực đo nên không khẳng định vi phạm LCP/INP.
- **Khắc phục:** dynamic import các dialog/editor và phần ít dùng; tách runtime/logic theo tính năng; đo Lighthouse trên production và laptop mục tiêu trước/sau.
- **Độ phức tạp:** High.
- **Bằng chứng:** build Next.js hoàn tất; web/app/sources hiển thị 53.4 kB / 157 kB First Load JS; web/app/app hiển thị 3.77 kB / 114 kB.

#### UI-01 — Design tokens trùng tên và cascade stylesheet toàn cục

- **Ảnh hưởng:** toàn bộ trang workspace, auth và trang cấu hình video.
- **Vị trí:** web/app/globals.css:1-20; web/src/styles/local-app.css:5-14,1050-1069; web/src/styles/local-theme.css:17-36; web/src/styles/product-controls.css:3-19.
- **Cách tái hiện:** kiểm tra computed style/token trên các component legacy và React; đổi accent/token trong một nhóm stylesheet sẽ không đảm bảo nhóm kia đổi theo.
- **Actual:** globals nối nhiều stylesheet theo thứ tự; nhiều :root khai báo lại --bg, --panel, --text, --purple, --danger với giá trị khác; một số token khác namespace như --ui-*.
- **Expected:** một tập design tokens chuẩn cho brand/surface/text/status; component dùng token semantic theo cùng quy tắc.
- **Nguyên nhân:** CSS tích lũy qua nhiều lớp giao diện (legacy/local/native/React) và các lần polish, thay vì một theme base duy nhất.
- **Tác động UX:** màu, border, spacing hoặc focus state có thể lệch giữa trang Nguồn video và workspace; tăng rủi ro regression khi thay theme.
- **Khắc phục:** lập bảng token semantic, chuyển stylesheet theo từng nhóm component và gỡ token trùng sau so sánh screenshot; tránh refactor lớn cùng lúc.
- **Độ phức tạp:** High.
- **Bằng chứng:** khai báo token tại các dòng nêu trên và imports tại web/app/globals.css.

#### A11Y-01 — Chưa có kiểm tra WCAG/keyboard tự động cho các dialog quan trọng

- **Ảnh hưởng:** dialog chọn/cấu hình video, xem video, chọn collection, quick navigation.
- **Vị trí:** web/src/legacy/sources-runtime.js:2192-2241; web/src/components/library-ui.jsx:235-249; web/src/components/app-shell.jsx:79-99,178.
- **Cách tái hiện:** kiểm tra bằng keyboard/screen reader: mở dialog, nhấn Tab đến cuối, đóng bằng Escape, kiểm tra focus quay lại trigger và announcement lỗi/status.
- **Actual:** app shell có focus trap cho mobile nav/quick navigation; library viewer và một số dialog React khai báo role=dialog/aria-modal; source dialog/runtime keyboard flow và focus restore chưa được xác minh tự động. Không có axe/Playwright accessibility test trong test hiện tại.
- **Expected:** tất cả modal khóa focus, đóng bằng Escape khi không có thao tác đang lưu, trả focus về trigger, có accessible name và trạng thái lỗi dễ nhận biết.
- **Nguyên nhân:** modal thuộc cả React lẫn runtime DOM cũ nên hành vi không dùng chung component/tiện ích.
- **Tác động UX:** người dùng chỉ dùng bàn phím/assistive tech có thể bị kẹt hoặc không biết trạng thái cập nhật.
- **Khắc phục:** thêm kiểm thử keyboard/accessibility cho modal source, library, editor; dùng semantic dialog/helper dùng chung; kiểm tra focus visible, contrast và target size bằng axe + thao tác tay.
- **Độ phức tạp:** Medium.
- **Bằng chứng:** app-shell có focus trap; audit chưa có test chuyên WCAG. Đây là lỗ hổng xác minh, chưa khẳng định có lỗi cụ thể ở từng dialog.

#### SEC-02 — Production thiếu một số response header bảo vệ browser

- **Ảnh hưởng:** toàn site www.reupai.cloud.
- **Vị trí:** chưa có cấu hình header trong web/next.config.mjs; thiết lập hiện chỉ reactStrictMode.
- **Cách tái hiện:** curl -sSI https://www.reupai.cloud/.
- **Actual:** header quan sát được có HSTS, nhưng không thấy Content-Security-Policy, X-Content-Type-Options, Referrer-Policy, Permissions-Policy trong response này.
- **Expected:** xác định chính sách header theo kiến trúc; tối thiểu đặt nosniff và referrer policy. CSP cần lập theo script/style và OAuth hiện hữu, không bật restrictive policy mù quáng.
- **Nguyên nhân:** chưa tìm thấy header policy trong Next config; Vercel response không cung cấp các header đó cho trang chủ tại thời điểm kiểm tra.
- **Tác động UX/bảo mật:** giảm lớp phòng vệ cho MIME sniffing, referrer leakage và injection; không phải bằng chứng hiện có lỗ hổng XSS.
- **Khắc phục:** thêm headers tại Vercel/Next, rà soát inline script/style/OAuth trước khi áp CSP; xác nhận trên route HTML/API.
- **Độ phức tạp:** Medium.
- **Bằng chứng:** production HEAD ngày 04/11/2026; web/next.config.mjs.

### P3 — Low

#### QA-01 — Test suite web quá nhỏ và chưa có lệnh lint riêng

- **Ảnh hưởng:** bảo trì frontend và ngăn regression.
- **Vị trí:** web/package.json; web/tests/.
- **Cách tái hiện:** xem scripts và chạy node --test tests/*.test.mjs trong web/.
- **Actual:** scripts chỉ dev, build, start; 2 file test hiện cho 3 test pass, tập trung kết nối Local Engine và xác minh chữ ký PayOS. Chưa có route/UI, auth mock, payment state UI, accessibility hoặc cross-browser test.
- **Expected:** có lệnh kiểm tra nhất quán và smoke tests cho các hành trình quan trọng không gọi dịch vụ thật.
- **Nguyên nhân:** test hiện ưu tiên logic kết nối/thanh toán, chưa bao phủ UI App Router.
- **Tác động UX:** thay đổi CSS/auth/dashboard có thể gây hỏng mà build không phát hiện.
- **Khắc phục:** thêm lint script khi cấu hình ESLint rõ ràng; Playwright smoke test với API mock/fixture cho dashboard, nguồn, dialogs, plans và keyboard.
- **Độ phức tạp:** Medium.
- **Bằng chứng:** test hiện chạy 3/3 pass; cảnh báo Node MODULE_TYPELESS_PACKAGE_JSON với local-engine-client.js (ESM được nạp lại như module, có overhead nhỏ). Không nên thêm "type":"module" trước khi đánh giá tác động tới toàn package.

## D. Priority Matrix

| Ưu tiên | Mã | Lý do |
|---|---|---|
| P1 | AUTH-01 | Điều kiện cấu hình sai có thể bỏ qua bảo vệ giao diện; cần sửa trước khi coi deploy cấu hình lỗi là an toàn. |
| P2 | BILL-01 | Người mua không thấy trạng thái hủy/thất bại cuối cùng; polling kéo dài. |
| P2 | PERF-01 | Lặp request local liên tục trong dashboard dù rảnh. |
| P2 | PERF-02 | Luồng chính có JS nặng nhất; cần tối ưu và đo trên thiết bị thật. |
| P2 | UI-01 | CSS token/cascade làm tăng nguy cơ lệch thiết kế và regression. |
| P2 | A11Y-01 | Dialog workflow cốt lõi chưa có chứng cứ accessibility tự động. |
| P2 | SEC-02 | Thiếu lớp hardening response headers; CSP phải triển khai có kiểm soát. |
| P3 | QA-01 | Thiếu độ bao phủ UI/E2E và lint riêng. |

Không thấy bằng chứng cần xếp P0: production hiện phản hồi, build thành công và không có lỗi dữ liệu/luồng chính được phép tái hiện trong phạm vi không đăng nhập.

## E. Roadmap

### 1. Stabilization

1. Đổi middleware sang fail-closed khi thiếu Supabase; test public/private/pending/admin và xác nhận API handler tự kiểm tra auth.
2. Hoàn thiện trạng thái đơn PayOS: pending/paid/cancelled/failed, deadline polling, retry có kiểm soát và hướng dẫn hỗ trợ theo mã đơn.
3. Thêm smoke test mock cho sign-in states, /app, /sources offline/connected, quota hết, Gemini lỗi và đơn thanh toán.

### 2. UX & Performance

1. Chuyển dashboard sang poll nhanh khi job chạy, chậm khi rảnh; dừng khi tab ẩn và làm mới ngay khi tab hiện lại.
2. Dynamic import editor/preview và phần tùy chọn không cần cho lần vào /sources đầu tiên.
3. Đo Web Vitals/Lighthouse trên build production ở laptop/mobile thật; ghi lại LCP/INP/CLS và waterfall, tránh suy luận chỉ từ bundle.
4. Kiểm thử keyboard/axe trên app shell, process-config, media viewer, output editor, collection dialog và checkout return.

### 3. SaaS Polish

1. Tập trung tokens màu/spacing/typography/radius/elevation/focus vào theme semantic dùng bởi React và legacy runtime.
2. Chuẩn hóa button/input/status/error/loading/empty components; giữ ngôn ngữ và tên trạng thái thống nhất.
3. Rà soát onboarding: Local Engine bắt buộc, quyền Gemini theo project khách, quota Free, hạn Pro; nêu bước tiếp theo tại từng empty/error state.
4. Thêm browser coverage Firefox/WebKit và visual snapshots cho các viewport mục tiêu.

### Files nên chỉnh trong các giai đoạn tiếp

- web/src/lib/supabase/middleware.js, web/middleware.js — kiểm soát truy cập fail-closed.
- web/src/components/plans-page.jsx, web/app/api/billing/me/route.js — state đơn/polling return từ PayOS.
- web/src/components/dashboard.jsx — cadence job polling.
- web/src/components/sources-page.jsx, web/src/legacy/sources-runtime.js, web/src/legacy/sources-markup.js — tách runtime/preview và accessibility.
- web/app/globals.css, web/src/styles/local-app.css, local-theme.css, product-controls.css, native-components.css — design tokens/cascade.
- web/package.json, web/tests/ — lệnh lint/test và UI smoke tests.
- web/next.config.mjs — hardening headers sau khi rà soát OAuth/CSP.

## F. Verification

### Lệnh và kết quả

| Kiểm tra | Kết quả |
|---|---|
| npm run build tại web/ | **PASS** — Next.js 14.2.15 compile, tạo 45 trang tĩnh; route output liệt kê 21 trang và API handlers. |
| node --test tests/*.test.mjs tại web/ | **PASS 3/3** — không fail; có cảnh báo module type Node nêu ở QA-01. |
| artifacts/redesign/checks.json | **PASS 29/29** kiểm tra overflow: false, pageErrors: []; Chromium/local fixture. |
| curl -I https://www.reupai.cloud/ | **200**, Vercel cache HIT, HSTS có; chưa thấy CSP/nosniff/referrer/permissions header. |
| curl -I https://www.reupai.cloud/app | **307** sang /sign-in?next=%2Fapp, cho thấy auth guard đang hoạt động trên deploy hiện tại. |
| Production /plans, /sign-in, /sitemap.xml, /robots.txt | **200** theo GET status check. |

### Responsive và trang đã xem

- Evidence responsive: [artifacts/redesign/checks.json](../artifacts/redesign/checks.json).
- Screenshot có sẵn: dashboard, mobile navigation, downloads, outputs, history, settings, profile, help và process-config tại artifacts/redesign/.
- Đã review source inventory và luồng code cho landing, auth, dashboard, sources/process config, libraries/output editor, settings/Gemini, profile, plans/PayOS, admin, legal/help/SEO routes.
- Các viewport trong fixture: /app 320/390/768/1024/1440/1920; downloads/outputs/history/settings/profile/help 320/768/1440; video-settings 320/390/768/1440/1920. Đây không phải toàn bộ ma trận yêu cầu; chưa có 375, 430, 1366 hoặc kiểm tra theo chiều cao.

### Chưa kiểm tra được / giới hạn

- Không đăng nhập production, không xác minh dữ liệu tài khoản, OAuth Google/Gemini, cấp quota, admin workflow hay transaction thật.
- Không tạo video/job, không gọi API tốn phí; do vậy progress, cancellation, preview/media sync và lỗi Local Engine chỉ được review source chứ chưa chạy end-to-end.
- Không chạy Lighthouse/Web Vitals vì chưa có phép đo tin cậy trên thiết bị người dùng; không có điểm benchmark trong báo cáo.
- Chưa chạy axe-core, screen reader hoặc Firefox/WebKit; đánh giá WCAG là khoảng trống kiểm chứng, không khẳng định đạt WCAG 2.2 AA.
- Production HTML/HTTP được kiểm tra read-only; /app chỉ xác nhận redirect khi chưa đăng nhập.

### Bằng chứng giao diện

![Dashboard sau đợt polish hiện có](../artifacts/redesign/after-dashboard.png)

![Thiết lập xử lý video](../artifacts/redesign/after-video-settings.png)
