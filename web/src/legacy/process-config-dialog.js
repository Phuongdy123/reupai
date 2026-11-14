// Loaded only when the user opens video processing settings.
export function createProcessConfigDialog({ document, uiIcon }) {
    let dialog = document.getElementById('processConfigDialog');
    if (dialog) return dialog;

    dialog = document.createElement('dialog');
    dialog.id = 'processConfigDialog';
    dialog.setAttribute('aria-labelledby', 'processConfigTitle');
    dialog.innerHTML = `
        <form method="dialog" class="process-config-dialog">
            <div class="process-config-head">
                <button type="button" class="btn secondary process-config-back" id="closeProcessConfig">${uiIcon('undo', 16)} Quay lại</button>
                <div class="process-config-heading">
                    <h3 id="processConfigTitle">Thiết lập video</h3>
                    <p><span id="processConfigMode">Vietsub</span> · Kiểm tra và bắt đầu khi bạn sẵn sàng</p>
                </div>
            </div>

            <div class="process-config-body">
            <div class="process-editor-main">
            <div class="process-config-showcase">
            <div class="process-config-preview" id="processConfigPreviewWrap">
                <img id="processConfigPoster" class="process-preview-poster" alt="" hidden>
                <div class="process-preview-stage" id="processPreviewStage">
                    <video id="processConfigPreview" controls preload="metadata"></video>
                    <canvas id="processPreviewCanvas"></canvas>
                    <div id="processBlurPreviewOverlay" class="process-blur-preview-overlay" hidden aria-hidden="true"></div>
                </div>
                <div id="processConfigPreviewEmpty">
                    <span class="process-empty-icon" aria-hidden="true">${uiIcon('play', 22)}</span>
                    <strong>Xem trước video</strong>
                    <p>Tải bản gốc để kiểm tra vùng mờ và vị trí logo.</p>
                </div>
                <button type="button" class="btn secondary process-download-source" id="processDownloadSource">${uiIcon('download', 16)} Tải video để xem trước</button>
            </div>
            <div class="process-preview-tools">
                <div class="process-region-tabs" role="group" aria-label="Loại vùng chỉnh sửa">
                    <button type="button" class="btn secondary process-pick-btn active" data-pick-mode="sub" aria-pressed="true">${uiIcon('blur', 16)} Phụ đề</button>
                    <button type="button" class="btn secondary process-pick-btn" data-pick-mode="custom" aria-pressed="false">${uiIcon('blur', 16)} Vùng mờ</button>
                    <button type="button" class="btn secondary process-pick-btn" data-pick-mode="logo" aria-pressed="false">${uiIcon('sparkles', 16)} Logo</button>
                </div>
                <div class="process-region-actions">
                    <button type="button" class="btn secondary" id="processAutoBlurPreview" title="Tự tìm vùng phụ đề và xem thử dải mờ trong 8 giây">${uiIcon('sparkles', 16)} AI dò vùng mờ <span class="process-tool-duration">8 giây</span></button>
                    <button type="button" class="btn secondary" id="toggleProcessPicker" aria-pressed="false">${uiIcon('pointer', 16)} Kéo chọn vùng</button>
                </div>
                <small id="processPickerHint">Tải video để sử dụng công cụ chỉnh vùng.</small>
                <small id="processAutoBlurStatus" role="status"></small>
            </div>

            <aside class="process-video-info" aria-label="Thông tin video">
                <h4>${uiIcon('video', 18)} Thông tin video</h4>
                <dl>
                    <div class="process-video-title-row"><dt>Video nguồn</dt><dd id="processConfigVideoTitle"></dd></div>
                    <div><dt>Thời lượng</dt><dd id="processConfigDuration">Chưa rõ</dd></div>
                    <div><dt>Độ phân giải</dt><dd id="processConfigResolution">Chưa rõ</dd></div>
                    <div><dt>Tỷ lệ khung hình</dt><dd id="processConfigRatio">Chưa rõ</dd></div>
                    <div class="process-video-status-row"><dt>Trạng thái</dt><dd id="processConfigStatus">Đang kiểm tra</dd></div>
                </dl>
            </aside>
            </div>


<details class="process-disclosure process-ai-disclosure"><summary><strong>Nhờ AI gợi ý</strong><span>Mô tả ý tưởng để nhận cấu hình phù hợp</span></summary>
            <section class="process-ai-suggest" aria-label="Trợ lý AI thiết lập video">
                <div class="process-section-heading"><strong>Gợi ý bằng AI</strong><small>Mô tả mục tiêu, đính kèm ảnh hoặc chụp khung hình hiện tại</small></div>
                <label for="processAiPrompt" class="process-ai-label">Bạn muốn video được xử lý thế nào?</label>
                <textarea id="processAiPrompt" rows="2" maxlength="2000" placeholder="Ví dụ: Làm Vietsub cho video dọc, giữ tiếng gốc nhỏ và làm mờ phụ đề cũ ở dưới…"></textarea>
                <div class="process-ai-tools">
                    <label class="btn secondary process-ai-attach">Đính kèm ảnh<input id="processAiImage" type="file" accept="image/png,image/jpeg,image/webp"></label>
                    <button type="button" class="btn secondary" id="processAiFrame">Chụp khung hình</button>
                    <span id="processAiImageName"></span>
                    <button type="button" class="btn primary" id="processAiGenerate">Gợi ý cấu hình</button>
                </div>
                <div class="process-ai-result" id="processAiResult" role="status" hidden>
                    <p id="processAiAnswer"></p>
                    <ul id="processAiSettings"></ul>
                    <button type="button" class="btn secondary" id="processAiApply" hidden>Áp dụng gợi ý</button>
                </div>
                <small>Mô tả và ảnh được gửi đến Google Gemini bằng project của bạn. Gợi ý không tự chạy video; hãy kiểm tra thông số trước khi xử lý.</small>
            </section>

</details>
            <details class="process-disclosure process-more-disclosure"><summary><strong>Tùy chọn nâng cao</strong><span>Nhạc nền, vùng mờ và logo</span></summary>
            <div class="process-advanced-shell">
            <details class="process-config-advanced" id="processMusicSection">
                <summary><strong>Nhạc nền</strong><small>Thêm nhạc và điều chỉnh âm lượng</small></summary>
                <p>Dán link YouTube hoặc TikTok công khai, link audio/video khác, hoặc chọn một tệp trên máy. Nhạc sẽ lặp vừa đủ chiều dài video và được trộn cùng tiếng gốc hoặc Voice.</p>
                <div class="process-config-grid">
                    <label>Link nhạc / video có nhạc
                        <input id="processMusicUrl" type="url" inputmode="url" placeholder="YouTube, TikTok hoặc https://...">
                    </label>
                    <label>Hoặc chọn audio/video trên máy
                        <input id="processMusicFile" type="file" accept="audio/*,video/*">
                    </label>
                    <label>Âm lượng nhạc
                        <div class="music-volume-control">
                            <input id="processMusicVolume" type="range" min="0" max="2" step="0.01" value="0.25" aria-label="Âm lượng nhạc nền">
                            <input id="processMusicVolumePercent" type="number" min="0" max="200" step="1" value="25" inputmode="numeric" aria-label="Phần trăm âm lượng nhạc nền">
                            <span aria-hidden="true">%</span>
                        </div>
                        <small>0% tắt nhạc · nhập trực tiếp từ 0–200%.</small>
                        <output data-for="processMusicVolume">25%</output>
                    </label>
                </div>
                <small id="processMusicHint">Không chọn nhạc: video giữ nguyên âm thanh hiện có. Link TikTok công khai được tách audio tự động.</small>
            </details>

            <details class="process-config-advanced">
                <summary><strong>Vùng mờ sub</strong><small>Thiết lập vùng mờ cho phụ đề cũ</small></summary>
                <p>Vùng này dùng để làm mờ phụ đề gốc. Tọa độ tính theo pixel của video.</p>
                <label class="process-check-option">
                    <input id="processSourceNoSub" type="checkbox">
                    Video gốc không có chữ phụ đề
                    <small>Bỏ qua quét chữ và vùng mờ tự động. Vẫn nhận diện lời thoại, dịch và tạo Voice/Vietsub.</small>
                </label>
                <div class="process-blur-grid">
                    <label>Vị trí gợi ý vùng mờ
                        <select id="processBlurPreset">
                            <option value="">Tự động</option>
                            <option value="top">Trên cùng</option>
                            <option value="bottom">Dưới cùng</option>
                            <option value="center">Chính giữa</option>
                        </select>
                    </label>
                    <label>X <input id="processBlurX" type="number" min="0" placeholder="Tự động"></label>
                    <label>Y <input id="processBlurY" type="number" min="0" placeholder="Tự động"></label>
                    <label>Rộng <input id="processBlurWidth" type="number" min="0" placeholder="Tự động"></label>
                    <label>Cao <input id="processBlurHeight" type="number" min="0" placeholder="Tự động"></label>
                </div>
                <button type="button" class="btn secondary process-section-save" id="saveSubSelection">${uiIcon('save', 16)} Lưu vùng mờ sub</button>
            </details>

            <details class="process-config-advanced">
                <summary><strong>Vùng mờ tùy chỉnh</strong><small>Tạo vùng mờ bất kỳ trên video</small></summary>
                <p>Vùng này chỉ làm mờ, không chèn phụ đề. Kéo chọn vùng rồi đặt khoảng thời gian.</p>
                <div class="process-blur-grid">
                    <label>X <input id="processCustomBlurX" type="number" min="0" placeholder="Tự động"></label>
                    <label>Y <input id="processCustomBlurY" type="number" min="0" placeholder="Tự động"></label>
                    <label>Rộng <input id="processCustomBlurWidth" type="number" min="0" placeholder="Tự động"></label>
                    <label>Cao <input id="processCustomBlurHeight" type="number" min="0" placeholder="Tự động"></label>
                </div>
                <div class="process-interval-head">
                    <strong>Khoảng thời gian mờ</strong>
                    <button type="button" class="btn secondary" id="addBlurInterval">${uiIcon('plus', 16)} Thêm khoảng</button>
                </div>
                <div id="blurIntervals" class="blur-intervals"></div>
                <small>Ví dụ: 1–12 giây và 14–26 giây.</small>
                <button type="button" class="btn secondary process-section-save" id="saveCustomSelection">${uiIcon('save', 16)} Lưu vùng mờ tùy chỉnh</button>
            </details>

            <details class="process-config-advanced">
                <summary><strong>Logo, nhãn lên video</strong><small>Chèn logo hoặc tên kênh</small></summary>
                <label>Kiểu logo
                    <select id="processLogoMode">
                        <option value="none">Không chèn logo</option>
                        <option value="default">Logo mặc định</option>
                        <option value="custom">Logo mới (đường dẫn file)</option>
                        <option value="text">Chèn chữ thay logo</option>
                    </select>
                </label>
                <label id="processLogoPathField">Đường dẫn logo mới
                    <input id="processLogoPath" placeholder="D:\\logo.png hoặc đường dẫn file logo">
                </label>
                <label id="processLogoFileField">Chọn tệp logo trên máy
                    <input id="processLogoFile" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml">
                </label>
                <label id="processLogoTextField">Nội dung chữ
                    <input id="processLogoText" placeholder="Tên kênh / thương hiệu">
                </label>
                <div class="process-blur-grid process-logo-grid">
                    <label>Cỡ logo (px) <input id="processLogoSize" type="number" min="1" max="4000" placeholder="Mặc định"></label>
                    <label>Vị trí X <input id="processLogoX" type="number" min="0" placeholder="Mặc định"></label>
                    <label>Vị trí Y <input id="processLogoY" type="number" min="0" placeholder="Mặc định"></label>
                </div>
                <button type="button" class="btn secondary process-section-save" id="saveLogoSelection">${uiIcon('save', 16)} Lưu lựa chọn logo</button>
            </details>
            </div>

            </details>
            </div>
            <aside class="process-settings-sidebar" aria-label="Thiết lập đầu ra">
                <nav class="process-inspector-rail" role="tablist" aria-label="Nhóm thiết lập video" aria-orientation="vertical">
                    <button type="button" class="process-inspector-tab active" id="processInspectorTabVideo" role="tab" data-inspector-tab="video" aria-controls="processInspectorVideo" aria-selected="true" tabindex="0"><span class="process-inspector-tab-icon">${uiIcon('video', 18)}</span><span>Video</span></button>
                    <button type="button" class="process-inspector-tab" id="processInspectorTabSubtitles" role="tab" data-inspector-tab="subtitles" aria-controls="processInspectorSubtitles" aria-selected="false" tabindex="-1"><span class="process-inspector-tab-icon">${uiIcon('captions', 18)}</span><span>Phụ đề</span></button>
                    <button type="button" class="process-inspector-tab" id="processInspectorTabOcr" role="tab" data-inspector-tab="ocr" aria-controls="processInspectorOcr" aria-selected="false" tabindex="-1"><span class="process-inspector-tab-icon">${uiIcon('captions', 18)}</span><span>OCR → SRT</span></button>
                    <button type="button" class="process-inspector-tab" id="processInspectorTabAudio" role="tab" data-inspector-tab="audio" aria-controls="processInspectorAudio" aria-selected="false" tabindex="-1"><span class="process-inspector-tab-icon">${uiIcon('voice', 18)}</span><span>Âm thanh</span></button>
                    <button type="button" class="process-inspector-tab" id="processInspectorTabPresets" role="tab" data-inspector-tab="presets" aria-controls="processInspectorPresets" aria-selected="false" tabindex="-1"><span class="process-inspector-tab-icon">${uiIcon('save', 18)}</span><span>Cấu hình</span></button>
                </nav>
                <div class="process-inspector-content">
                <div class="process-inspector-heading"><span class="process-inspector-dot" aria-hidden="true"></span>Thiết lập đầu ra</div>
            <div class="process-settings-layout">
            <section class="process-settings-card process-inspector-panel process-video-settings-panel" id="processInspectorVideo" data-inspector-panel="video" role="tabpanel" aria-labelledby="processInspectorTabVideo" tabindex="0">
                <div class="process-section-heading"><span class="process-panel-icon" aria-hidden="true">${uiIcon('video', 18)}</span><strong>Thiết lập video</strong><small>Khung hình và phạm vi xử lý</small></div>
                <div class="process-config-grid">
                <label>Thời lượng xem trước
                    <select id="processPreviewSeconds">
                        <option value="">Toàn bộ video</option>
                        <option value="10">10 giây đầu</option>
                        <option value="30">30 giây đầu</option>
                        <option value="60">60 giây đầu</option>
                    </select>
                </label>
                <label>Tỷ lệ video đầu ra
                    <select id="processAspectRatio">
                        <option value="">Giữ tỷ lệ gốc</option>
                        <option value="shorts">YouTube Shorts · 9:16</option>
                        <option value="youtube">YouTube ngang · 16:9</option>
                        <option value="facebook">Facebook · 4:5</option>
                        <option value="tiktok">TikTok · 9:16</option>
                    </select>
                </label>
                <label class="process-check-option">
                    <input id="processAutoBrandBlur" type="checkbox">
                    Tự động làm mờ watermark
                    <small>Che ID hoặc chữ ở góc trên video.</small>
                </label>
                </div>
            </section>

            <section class="process-settings-card process-inspector-panel process-subtitles-settings-panel" id="processInspectorSubtitles" data-inspector-panel="subtitles" role="tabpanel" aria-labelledby="processInspectorTabSubtitles" tabindex="0" hidden>
                <div class="process-section-heading"><span class="process-panel-icon" aria-hidden="true">${uiIcon('captions', 18)}</span><strong>Phụ đề tiếng Việt</strong><small>Ngôn ngữ và kiểu chữ</small></div>
                <div class="process-config-grid">
                <label class="process-source-language-field">Ngôn ngữ nguồn để dịch
                    <select id="processSourceLanguage">
                        <option value="auto">Tự động nhận diện (khuyên dùng)</option>
                        <option value="zh">Tiếng Trung</option>
                        <option value="en">Tiếng Anh</option>
                        <option value="ja">Tiếng Nhật</option>
                        <option value="ko">Tiếng Hàn</option>
                        <option value="th">Tiếng Thái</option>
                        <option value="id">Tiếng Indonesia</option>
                        <option value="es">Tiếng Tây Ban Nha</option>
                        <option value="pt">Tiếng Bồ Đào Nha</option>
                        <option value="fr">Tiếng Pháp</option>
                        <option value="de">Tiếng Đức</option>
                        <option value="ru">Tiếng Nga</option>
                        <option value="it">Tiếng Ý</option>
                        <option value="hi">Tiếng Hindi</option>
                        <option value="ar">Tiếng Ả Rập</option>
                        <option value="tr">Tiếng Thổ Nhĩ Kỳ</option>
                        <option value="ms">Tiếng Mã Lai</option>
                        <option value="vi">Tiếng Việt</option>
                    </select>
                    <small>Để tự động nếu bạn chưa biết ngôn ngữ của video.</small>
                </label>
                <label>Cỡ chữ phụ đề
                    <select id="processFontSize" title="Tự động: cỡ chữ được điều chỉnh theo vùng phụ đề">
                        <option value="">Tự động</option>
                        <option value="24">24 px</option>
                        <option value="28">28 px</option>
                        <option value="32">32 px</option>
                        <option value="36">36 px</option>
                    </select>
                </label>
                <label class="process-subtitle-style-field">Phong cách phụ đề
                    <select id="processSubtitleStyle">
                        <option value="minimal">Minimal Clean</option>
                        <option value="bold">Creator Bold</option>
                        <option value="cinema">Cinema</option>
                        <option value="neon">Neon Pop</option>
                        <option value="box">Simple Box</option>
                    </select>
                </label>

                </div>
            </section>
            <section class="process-settings-card process-inspector-panel process-ocr-settings-panel" id="processInspectorOcr" data-inspector-panel="ocr" role="tabpanel" aria-labelledby="processInspectorTabOcr" tabindex="0" hidden>
                <div class="process-section-heading"><span class="process-panel-icon" aria-hidden="true">${uiIcon('captions', 18)}</span><strong>OCR → SRT</strong><small>Đọc chữ, dịch và xuất phụ đề</small></div>
                <p class="process-recognition-hint">Mặc định AI tự nhận diện. Chỉ điều chỉnh các mục dưới đây khi bạn muốn chọn cách lấy phụ đề.</p>
                <div class="process-config-grid process-recognition-controls">
                <label class="process-source-language-field">Kết quả cần xuất
                    <select id="processOutputFormat">
                        <option value="video">Video kèm file SRT riêng</option>
                        <option value="srt">Chỉ file SRT · Không render video</option>
                    </select>
                    <small>File SRT tiếng Việt được tải riêng trong Thành phẩm.</small>
                </label>

                <label class="process-source-language-field">Lấy phụ đề từ
                    <select id="processTranscriptSource">
                        <option value="audio">Lời thoại trong âm thanh (mặc định)</option>
                        <option value="video_subtitles">Chữ phụ đề trên hình</option>
                    </select>
                    <small>OCR đọc phụ đề có sẵn trong khung hình, dịch và lưu thêm tệp SRT.</small>
                </label>
                <div id="processOcrOptions" class="process-ocr-options" hidden>
                    <label>Ngôn ngữ nhận diện OCR
                        <select id="processOcrLanguage">
                            <option value="auto">Đa ngôn ngữ · Trung + Latin</option>
                            <option value="zh">Tiếng Trung</option>
                            <option value="en">Tiếng Anh</option>
                            <option value="ja">Tiếng Nhật</option>
                            <option value="ko">Tiếng Hàn</option>
                            <option value="vi">Tiếng Việt</option>
                            <option value="th">Tiếng Thái</option>
                        </select>
                    </label>
                    <label>Số khung hình quét mỗi giây
                        <input id="processOcrFps" type="range" min="0.5" max="10" step="0.5" value="2">
                        <output data-for="processOcrFps">2 fps</output>
                    </label>
                    <label>Ngưỡng tin cậy OCR
                        <input id="processOcrConfidence" type="range" min="0.2" max="0.9" step="0.05" value="0.45">
                        <output data-for="processOcrConfidence">45%</output>
                    </label>
                    <label>Số luồng CPU
                        <select id="processOcrParallelism">
                            <option value="1">1 · Ít tải máy</option>
                            <option value="2" selected>2 · Cân bằng</option>
                            <option value="4">4 · Nhanh hơn</option>
                            <option value="6">6</option>
                            <option value="8">8 · Tải CPU cao</option>
                        </select>
                    </label>
                    <label class="process-check-option">
                        <input id="processOcrUseGpu" type="checkbox">
                        Ưu tiên tăng tốc GPU
                        <small>Nếu Engine không hỗ trợ GPU, tự chạy bằng CPU.</small>
                    </label>
                    <label class="process-check-option">
                        <input id="processOcrMergeSimilar" type="checkbox" checked>
                        Gộp phụ đề OCR giống nhau
                        <small>Giảm dòng trùng do cùng một câu xuất hiện ở nhiều khung hình.</small>
                    </label>
                    <label id="processOcrSimilarityField">Ngưỡng gộp câu giống nhau
                        <input id="processOcrSimilarity" type="range" min="0.5" max="0.98" step="0.02" value="0.82">
                        <output data-for="processOcrSimilarity">82%</output>
                    </label>
                    <p class="process-ocr-note" id="processOcrNote">Quét 2 khung hình/giây là mức cân bằng. Tăng tốc độ sẽ đọc sát hơn nhưng xử lý lâu hơn; lần đầu có thể cần tải model OCR.</p>
                </div>
                </div>
            </section>
            <section class="process-settings-card process-inspector-panel process-audio-settings-panel" id="processInspectorAudio" data-inspector-panel="audio" role="tabpanel" aria-labelledby="processInspectorTabAudio" tabindex="0" hidden>
                <div class="process-section-heading"><span class="process-panel-icon" aria-hidden="true">${uiIcon('voice', 18)}</span><strong>Âm thanh &amp; giọng đọc</strong><small>Âm lượng, giọng đọc và tốc độ</small></div>
                <div class="process-config-grid">
                <label>Âm lượng audio gốc
                    <input id="processOriginalVolume" type="range" min="0" max="1" step="0.05" value="0.15">
                    <output data-for="processOriginalVolume">15%</output>
                </label>
                <label>Âm lượng lồng tiếng
                    <input id="processVoiceVolume" type="range" min="0" max="2" step="0.05" value="1">
                    <output data-for="processVoiceVolume">100%</output>
                </label>
                <label>Tốc độ lồng tiếng
                    <input id="processTtsSpeed" type="range" min="0.5" max="1.6" step="0.05" value="1.1">
                    <output data-for="processTtsSpeed">1.10x</output>
                </label>
                <label id="processVoiceField">Giọng lồng tiếng
                    <select id="processVoice">
                        <option value="Trúc Ly">Trúc Ly (mặc định)</option>
                        <option value="Hải Đăng">Hải Đăng</option>
                    </select>
                </label>
                </div>
            </section>
            </div>

<section class="process-settings-card process-inspector-panel process-presets-settings-panel" id="processInspectorPresets" data-inspector-panel="presets" role="tabpanel" aria-labelledby="processInspectorTabPresets" tabindex="0" hidden><div class="process-section-heading"><span class="process-panel-icon" aria-hidden="true">${uiIcon('save', 18)}</span><strong>Cấu hình đã lưu</strong><small>Dùng lại thiết lập yêu thích</small></div>
            <div class="process-preset-bar">
                <div class="process-section-heading"><strong>Preset</strong><small>Lưu và dùng lại thiết lập yêu thích</small></div>
                <label>Chọn cấu hình
                    <select id="processPresetSelect">
                        <option value="">Không dùng preset</option>
                    </select>
                </label>
                <input id="processPresetName" aria-label="Tên cấu hình mới" placeholder="Tên cấu hình mới">
                <button type="button" class="btn secondary" id="saveProcessPreset">Lưu và áp dụng</button>
                <button type="button" class="btn secondary" id="deleteProcessPreset">Xóa</button>
                <small id="processPresetStatus">Chọn preset sẽ cập nhật ngay cấu hình hiện tại.</small>
            </div>

</section>
                <div class="process-output-review">
                <section class="process-output-summary" id="processOutputSummary" aria-labelledby="processOutputSummaryTitle">
                    <header><h4 id="processOutputSummaryTitle">Tóm tắt đầu ra</h4><span class="process-output-mode" data-output-summary="mode">Vietsub + Voice</span></header>
                    <dl>
                        <div><dt>${uiIcon('video', 13)} Khung hình</dt><dd data-output-summary="frame">Giữ tỷ lệ gốc</dd></div>
                        <div><dt>${uiIcon('captions', 13)} Lời thoại</dt><dd data-output-summary="language">Tự nhận diện → Tiếng Việt</dd></div>
                        <div data-output-summary-row="voice"><dt>${uiIcon('voice', 13)} Giọng đọc</dt><dd data-output-summary="voice">Trúc Ly</dd></div>
                    </dl>
                    <div class="process-output-tags">
                        <span title="Phong cách phụ đề" data-output-summary="style">Minimal Clean</span>
                        <span title="Thời lượng xử lý" data-output-summary="duration">Toàn bộ video</span>
                        <span title="Vùng mờ phụ đề gốc">Mờ sub: <span data-output-summary="blur">Tự nhận diện</span></span>
                    </div>
                </section>
                </div>
                </div>

            </aside>
            </div>
            <div class="process-config-actions">
                <button type="button" class="btn secondary" id="resetProcessConfig">${uiIcon('reset', 16)} Đặt lại mặc định</button>
                <div class="process-config-actions-main">
                <button type="button" class="btn secondary" id="cancelProcessConfig">Hủy</button>
                <button type="submit" class="btn primary" id="runProcessConfig">${uiIcon('sparkles', 16)} Bắt đầu xử lý</button>
                </div>
            </div>
        </form>
    `;
    document.body.appendChild(dialog);

    const close = () => dialog.close();
    dialog.querySelector('#closeProcessConfig').onclick = close;
    dialog.querySelector('#cancelProcessConfig').onclick = close;
    const syncMusicVolume = source => {
        const slider = dialog.querySelector('#processMusicVolume');
        const percent = dialog.querySelector('#processMusicVolumePercent');
        const output = dialog.querySelector('output[data-for="processMusicVolume"]');
        const raw = source === percent ? Number(percent.value) / 100 : Number(slider.value);
        const normalized = Number.isFinite(raw) ? Math.min(2, Math.max(0, raw)) : 0.25;
        slider.value = String(normalized);
        percent.value = String(Math.round(normalized * 100));
        output.textContent = `${Math.round(normalized * 100)}%`;
    };
    const musicSlider = dialog.querySelector('#processMusicVolume');
    const musicPercent = dialog.querySelector('#processMusicVolumePercent');
    musicSlider?.addEventListener('input', () => syncMusicVolume(musicSlider));
    musicPercent?.addEventListener('input', () => syncMusicVolume(musicPercent));

    ['processOriginalVolume', 'processVoiceVolume', 'processTtsSpeed'].forEach(id => {
        const input = dialog.querySelector(`#${id}`);
        const output = dialog.querySelector(`output[data-for="${id}"]`);
        input?.addEventListener('input', () => {
            output.textContent = id === 'processTtsSpeed'
                ? `${Number(input.value).toFixed(2)}x`
                : `${Math.round(Number(input.value) * 100)}%`;
        });
    });
    const ocrRangeFormats = {
        processOcrFps: value => `${Number(value).toLocaleString('vi-VN')} fps`,
        processOcrConfidence: value => `${Math.round(Number(value) * 100)}%`,
        processOcrSimilarity: value => `${Math.round(Number(value) * 100)}%`,
    };
    Object.entries(ocrRangeFormats).forEach(([id, format]) => {
        const input = dialog.querySelector(`#${id}`);
        const output = dialog.querySelector(`output[data-for="${id}"]`);
        input?.addEventListener('input', () => { if (output) output.textContent = format(input.value); });
    });
    return dialog;
}

