export const guideBase = "/giai-phap";

export const guides = [
  {
    slug: "vietsub-video-ai",
    title: "Vietsub video bằng AI",
    description: "Tạo phụ đề tiếng Việt cho video bằng nhận diện lời thoại và dịch AI. Xem trước, chỉnh vùng che phụ đề cũ rồi xuất video trên máy với ReupAI.",
    category: "PHỤ ĐỀ AI",
    intro: "Vietsub video cần nhiều hơn một bản dịch: lời thoại phải được nhận diện, chia theo thời gian và đặt đúng vị trí trong khung hình. ReupAI đưa các bước đó vào một job để bạn xem trước trước khi xuất thành phẩm.",
    useCases: ["Video có lời thoại nhưng chưa có phụ đề tiếng Việt", "Video đã có chữ gốc cần che trước khi chèn Vietsub", "Video dọc hoặc ngang cần điều chỉnh cỡ chữ, vùng hiển thị và âm thanh gốc"],
    steps: [
      ["Thêm video nguồn", "Chọn video từ nguồn được hỗ trợ hoặc thư viện local, rồi chọn chế độ Vietsub."],
      ["Kiểm tra thiết lập", "Chọn ngôn ngữ lời thoại hoặc để tự nhận diện; xem trước vùng mờ phụ đề gốc và kiểu chữ."],
      ["Xử lý và xem thành phẩm", "Local Engine nhận diện lời nói, tạo phụ đề tiếng Việt và render file để bạn kiểm tra trên máy."],
    ],
    note: "Nhận diện tự động có thể sai khi nhạc quá lớn, nhiều người nói chồng lên nhau hoặc chữ gốc thay đổi vị trí. Hãy xem trước và chọn vùng mờ thủ công khi cần.",
    faq: [
      ["Video chưa có phụ đề có làm Vietsub được không?", "Có, nếu video có lời thoại đủ rõ để bộ nhận diện giọng nói xử lý. Bạn không cần chuẩn bị file SRT trước."],
      ["Có thể giữ tiếng gốc không?", "Có. Phần thiết lập video cho phép điều chỉnh âm lượng audio gốc trước khi render."],
    ],
    related: ["tao-phu-de-tu-dong", "che-phu-de-goc-video", "dich-video-khong-co-phu-de"],
  },
  {
    slug: "dich-video-trung-viet",
    title: "Dịch video tiếng Trung sang tiếng Việt",
    description: "Hướng dẫn dịch lời thoại video tiếng Trung sang tiếng Việt, tạo Vietsub và tùy chọn lồng tiếng bằng ReupAI Local Engine.",
    category: "DỊCH TRUNG – VIỆT",
    intro: "Với video tiếng Trung, nội dung trên màn hình và lời thoại có thể khác nhau. ReupAI lấy lời thoại làm nguồn để tạo phụ đề tiếng Việt; vùng chữ Trung đã có trên hình được nhận diện riêng để che khi render.",
    useCases: ["Video Bilibili có lời thoại tiếng Trung", "Clip có phụ đề Trung được đốt sẵn trên hình", "Nội dung cần bản tiếng Việt để người xem dễ theo dõi"],
    steps: [
      ["Chọn đúng video", "Mở video được phép tải và chọn Vietsub hoặc Vietsub + Voice trong nguồn video."],
      ["Đặt ngôn ngữ", "Chọn tiếng Trung nếu đã biết ngôn ngữ nguồn; nếu không chắc, dùng tự nhận diện."],
      ["Xem trước chữ gốc", "Kiểm tra vùng che phụ đề Trung. Nếu chữ ở vị trí khác thường, kéo vùng mờ thủ công rồi mới xử lý."],
    ],
    note: "Tên riêng, tiếng địa phương, lời hát và đoạn nói quá nhanh có thể cần sửa thủ công. Kết quả dịch qua Gemini còn phụ thuộc project Google Cloud và quyền truy cập của tài khoản bạn.",
    faq: [
      ["Có cần file phụ đề Trung không?", "Không bắt buộc. ReupAI có thể nhận diện lời thoại trong âm thanh để tạo bản phụ đề nguồn."],
      ["Có dịch chữ xuất hiện ở mọi vị trí trên video không?", "Quy trình Vietsub tập trung vào lời thoại và vùng phụ đề gốc; chữ trong cảnh quay không tự động được dịch toàn bộ."],
    ],
    related: ["vietsub-video-bilibili", "che-phu-de-goc-video", "long-tieng-video-ai"],
  },
  {
    slug: "long-tieng-video-ai",
    title: "Lồng tiếng video bằng AI",
    description: "Tạo giọng đọc tiếng Việt cho video đã dịch, chỉnh âm lượng tiếng gốc và tốc độ giọng đọc trước khi render với ReupAI.",
    category: "VOICE AI",
    intro: "Chế độ lồng tiếng kết hợp bản dịch với giọng đọc tiếng Việt. Bạn có thể nghe lại tiếng gốc ở mức âm lượng thấp hơn, chọn giọng và điều chỉnh tốc độ để lời đọc phù hợp nhịp video.",
    useCases: ["Video có lời thoại nước ngoài cần giọng đọc tiếng Việt", "Nội dung muốn giữ cả phụ đề và voice", "Video cần thay đổi tỷ lệ giữa tiếng gốc và giọng đọc"],
    steps: [
      ["Chọn Vietsub + Voice", "Từ video nguồn, chọn chế độ có lồng tiếng thay vì chỉ tạo phụ đề."],
      ["Chỉnh giọng và âm lượng", "Xem lựa chọn giọng đọc, tốc độ lồng tiếng, âm lượng voice và âm thanh gốc."],
      ["Xuất và nghe lại", "Kiểm tra đoạn hội thoại nhanh, tên riêng và thời điểm bắt đầu câu trong video thành phẩm."],
    ],
    note: "Chất lượng giọng đọc phụ thuộc bản nhận diện lời thoại và bản dịch. Video không có lời nói sẽ không tạo track lồng tiếng hữu ích.",
    faq: [
      ["Có thể chỉ tạo Vietsub mà không lồng tiếng không?", "Có. Hãy chọn chế độ Vietsub khi tạo job."],
      ["Voice có thay hoàn toàn tiếng gốc không?", "Bạn có thể điều chỉnh âm lượng audio gốc trong thiết lập để chọn mức nghe phù hợp."],
    ],
    related: ["vietsub-video-ai", "dich-video-khong-co-phu-de", "xu-ly-video-tren-may"],
  },
  {
    slug: "tao-phu-de-tu-dong",
    title: "Tạo phụ đề video tự động từ lời nói",
    description: "Nhận diện lời thoại trong video, tạo mốc thời gian phụ đề và chuyển thành Vietsub bằng ReupAI. Có thể chọn ngôn ngữ nguồn hoặc tự nhận diện.",
    category: "NHẬN DIỆN LỜI NÓI",
    intro: "Khi video không có file phụ đề, Local Engine tách âm thanh và dùng nhận diện giọng nói để tạo các câu có mốc thời gian. Bản này là đầu vào cho bước dịch và hiển thị phụ đề tiếng Việt.",
    useCases: ["Video chỉ có lời nói, không kèm SRT", "Clip cần mốc thời gian cho từng câu", "Nguồn nói tiếng Trung, Anh, Nhật hoặc Việt và muốn kiểm tra ngôn ngữ đầu vào"],
    steps: [
      ["Chọn ngôn ngữ lời thoại", "Chọn ngôn ngữ đã biết để giảm nhầm lẫn, hoặc giữ tùy chọn tự nhận diện."],
      ["Chạy nhận diện", "Whisper trong Local Engine phân tích âm thanh và chia lời nói thành từng đoạn."],
      ["Kiểm tra kết quả", "Xem các câu ngắn, khoảng im lặng và chỗ có nhạc nền trước khi xuất video."],
    ],
    note: "Không có tiếng nói rõ ràng thì không thể tạo phụ đề lời thoại đáng tin cậy. Nhạc, hiệu ứng lớn hoặc nhiều giọng chồng nhau có thể làm sai mốc thời gian.",
    faq: [
      ["Tự nhận diện ngôn ngữ có luôn chính xác không?", "Không. Với video ngắn, nhiều tiếng lóng hoặc âm thanh kém, chọn ngôn ngữ thủ công thường dễ kiểm soát hơn."],
      ["Video dài có xử lý được không?", "Có thể, nhưng thời gian và dung lượng cần thiết tăng theo độ dài video và cấu hình máy."],
    ],
    related: ["dich-video-khong-co-phu-de", "vietsub-video-ai", "xu-ly-video-tren-may"],
  },
  {
    slug: "dich-video-khong-co-phu-de",
    title: "Dịch video không có phụ đề",
    description: "Video không có sub vẫn có thể tạo Vietsub từ lời thoại: nhận diện giọng nói, dịch sang tiếng Việt và render phụ đề trên máy với ReupAI.",
    category: "VIDEO KHÔNG CÓ SUB",
    intro: "Không cần tìm file SRT trước. Với video có lời nói, ReupAI nhận diện âm thanh để tạo transcript, dịch câu thoại và căn thời gian phụ đề tiếng Việt vào video.",
    useCases: ["Video nguồn không có phụ đề sẵn", "Video chỉ có thoại và nhạc nền", "Video dài cần tự tạo mốc câu trước khi dịch"],
    steps: [
      ["Xem video nguồn", "Xác nhận video có lời thoại nghe được và chọn chế độ Vietsub hoặc Voice."],
      ["Để tự nhận diện hoặc chọn ngôn ngữ", "Thiết lập ngôn ngữ đầu vào để bộ nhận diện giọng nói bám đúng nguồn."],
      ["Kiểm tra bản render", "Nghe lại các đoạn khó, kiểm tra mốc phụ đề và chỉnh trước khi dùng thành phẩm."],
    ],
    note: "Video hoàn toàn im lặng hoặc chỉ có nhạc không có nội dung lời nói để dịch. Trong trường hợp này hệ thống có thể bỏ qua phần dịch và lồng tiếng.",
    faq: [
      ["Có cần tải phụ đề riêng từ nguồn không?", "Không. Lời thoại được nhận diện từ âm thanh của video."],
      ["Vì sao đoạn video có người nói nhưng thiếu phụ đề?", "Âm thanh nhỏ, tiếng nền lớn hoặc nhiều người nói cùng lúc có thể làm bộ nhận diện bỏ sót đoạn."],
    ],
    related: ["tao-phu-de-tu-dong", "vietsub-video-ai", "long-tieng-video-ai"],
  },
  {
    slug: "vietsub-video-bilibili",
    title: "Vietsub video Bilibili",
    description: "Thêm link Bilibili vào ReupAI, tải video được phép truy cập và tạo phụ đề tiếng Việt hoặc lồng tiếng AI trên máy.",
    category: "NGUỒN BILIBILI",
    intro: "ReupAI nhận link video Bilibili để đưa vào thư viện nguồn. Sau khi có file trên máy, bạn chọn Vietsub hoặc Voice, kiểm tra phụ đề gốc và theo dõi job đến khi có thành phẩm.",
    useCases: ["Video Bilibili có link BV", "Video tiếng Trung cần bản tiếng Việt", "Nguồn có phụ đề gốc cần xác định vùng che"],
    steps: [
      ["Dán link video", "Dùng URL video Bilibili cụ thể, kiểm tra video còn công khai hoặc tài khoản của bạn có quyền xem."],
      ["Tải về Local Engine", "Ứng dụng tải nguồn về máy. Nếu nguồn hạn chế truy cập, hãy kiểm tra trình duyệt, phiên đăng nhập và thử lại sau."],
      ["Chọn cách xử lý", "Chọn Vietsub hoặc Vietsub + Voice; xem trước vùng phụ đề gốc trước khi render."],
    ],
    note: "Không phải video nào cũng tải được. Quyền truy cập, giới hạn khu vực, thay đổi từ Bilibili hoặc yêu cầu đăng nhập có thể làm bước tải thất bại. Chỉ xử lý nội dung bạn có quyền sử dụng.",
    faq: [
      ["Dán link kênh thay cho link video được không?", "Trang Nguồn video có thể quản lý nguồn, nhưng để xử lý một job hãy chọn video cụ thể."],
      ["Lỗi tải video Bilibili có phải do Gemini không?", "Không. Bước tải nguồn diễn ra trước khi dịch; hãy kiểm tra lỗi tải và quyền truy cập video riêng."],
    ],
    related: ["dich-video-trung-viet", "che-phu-de-goc-video", "vietsub-video-ai"],
  },
  {
    slug: "vietsub-video-douyin",
    title: "Vietsub video Douyin",
    description: "Dùng link video Douyin trong ReupAI để tải nguồn được phép truy cập, nhận diện lời thoại và tạo Vietsub hoặc lồng tiếng tiếng Việt.",
    category: "NGUỒN DOUYIN",
    intro: "Video Douyin thường ngắn, dọc và có chữ hoặc nhãn nằm gần vùng phụ đề. ReupAI cho phép chọn video nguồn, xem trước khung hình và chỉnh vùng che trước khi xuất Vietsub tiếng Việt.",
    useCases: ["Clip Douyin dọc cần phụ đề tiếng Việt", "Video ngắn có chữ Trung ở dưới màn hình", "Nguồn cần giữ tỷ lệ khung hình khi render"],
    steps: [
      ["Mở video cụ thể", "Dán hoặc chọn link video Douyin có thể truy cập bằng tài khoản của bạn."],
      ["Xem trước khung dọc", "Kiểm tra vùng chữ gốc, vị trí phụ đề mới và tỷ lệ đầu ra."],
      ["Render và kiểm tra", "Xem thành phẩm trên điện thoại và máy tính để chắc chữ không che chủ thể."],
    ],
    note: "Douyin có thể thay đổi cơ chế chia sẻ hoặc hạn chế lượt truy cập. ReupAI không đảm bảo tải được mọi link; chỉ dùng video bạn có quyền xử lý.",
    faq: [
      ["Video Douyin không có lời thoại thì sao?", "Bộ nhận diện không có câu để dịch; bạn có thể dùng các tùy chỉnh video khác, nhưng không có Vietsub lời nói để tạo."],
      ["Có giữ khung hình dọc không?", "Thiết lập tỷ lệ đầu ra cho phép giữ nguyên khung nguồn khi đó là lựa chọn phù hợp."],
    ],
    related: ["vietsub-video-ai", "che-phu-de-goc-video", "dich-video-khong-co-phu-de"],
  },
  {
    slug: "che-phu-de-goc-video",
    title: "Che phụ đề gốc trước khi thêm Vietsub",
    description: "Xác định vùng chữ gốc, xem trước vùng làm mờ và tự kéo chọn khi OCR chưa chính xác để phụ đề mới không chồng lên chữ cũ.",
    category: "CHỈNH VÙNG PHỤ ĐỀ",
    intro: "Nhiều video có phụ đề được gắn thẳng vào hình. Khi thêm Vietsub, hai lớp chữ dễ chồng nhau. ReupAI nhận diện vùng phụ đề gốc để làm mờ và cho phép bạn chọn lại vùng thủ công nếu chữ dịch chuyển hoặc OCR nhận sai.",
    useCases: ["Chữ Trung hoặc chữ nguồn còn lộ dưới Vietsub", "Vùng mờ tự động quá lớn, che nhân vật", "Phụ đề xuất hiện ở vị trí khác nhau giữa các video"],
    steps: [
      ["Xem trước nhiều khung hình", "Kiểm tra vị trí chữ ở đầu, giữa và cuối clip; đừng dựa vào một khung hình duy nhất."],
      ["Chọn vùng mờ", "Dùng vùng tự động nếu bám sát chữ; nếu lệch, kéo chọn vùng phụ đề gốc bằng công cụ trên video."],
      ["Xem lại thành phẩm", "Kiểm tra chữ gốc đã được che đủ và vùng mờ không che quá nhiều nội dung quan trọng."],
    ],
    note: "Vùng mờ tĩnh khó theo kịp phụ đề di chuyển liên tục. Nếu vị trí chữ thay đổi giữa các đoạn, bạn cần xem kỹ hoặc điều chỉnh vùng theo video cụ thể.",
    faq: [
      ["Vùng mờ tự động có luôn đúng không?", "Không. OCR có thể nhầm logo, watermark hoặc chữ trong cảnh là phụ đề. Công cụ chọn thủ công giúp sửa trường hợp đó."],
      ["Video gốc không có phụ đề thì có cần làm mờ không?", "Không. Hãy chọn tùy chọn video gốc không có chữ phụ đề để tránh làm mờ không cần thiết."],
    ],
    related: ["vietsub-video-ai", "dich-video-trung-viet", "vietsub-video-douyin"],
  },
  {
    slug: "xu-ly-video-tren-may",
    title: "Xử lý video trên máy với ReupAI Local Engine",
    description: "Hiểu vì sao ReupAI dùng Local Engine cho tải video, nhận diện giọng nói, FFmpeg và render; website quản lý công việc còn file video ở trên máy bạn.",
    category: "LOCAL ENGINE",
    intro: "Website ReupAI giúp bạn quản lý tài khoản, chọn nguồn và theo dõi công việc. Tác vụ nặng như tải, tách âm thanh, nhận diện lời thoại và render chạy qua Local Engine trên máy Windows của bạn.",
    useCases: ["Muốn giữ file video nguồn và thành phẩm trên thiết bị", "Cần xử lý clip dài mà không phụ thuộc phiên tab trình duyệt", "Muốn biết vì sao website yêu cầu cài ứng dụng Windows"],
    steps: [
      ["Cài Local Engine", "Tải bản cài từ kênh chính thức, cài trên Windows và mở ứng dụng."],
      ["Kết nối website", "Đăng nhập cùng tài khoản, cho phép website kết nối với Engine trên chính máy đó."],
      ["Theo dõi job", "Tạo job trên web rồi để Local Engine xử lý; không tắt máy trong lúc đang render."],
    ],
    note: "Thời gian xử lý phụ thuộc độ dài video, CPU/GPU, tốc độ ổ đĩa và các dịch vụ ngoài dùng cho dịch. Local Engine cần đang chạy để website bắt đầu job.",
    faq: [
      ["Có thể chỉ mở website mà không cài ứng dụng không?", "Bạn có thể xem các trang công khai, nhưng cần Local Engine để tải và xử lý video trên máy."],
      ["Đóng trình duyệt có làm mất file thành phẩm không?", "File thành phẩm được lưu trên máy. Hãy để Local Engine và máy tính hoạt động cho đến khi job hoàn thành."],
    ],
    related: ["vietsub-video-ai", "long-tieng-video-ai", "tao-phu-de-tu-dong"],
  },
];

export function getGuide(slug) {
  return guides.find((guide) => guide.slug === slug);
}
