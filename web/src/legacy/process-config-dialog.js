// Loaded only when the user opens video processing settings.
import { TARGET_LANGUAGE_OPTIONS, renderVoiceOptionsHtml } from '../lib/tts-voices';
import { copyrightIconSvg } from '../lib/copyright-checker';

function renderTargetLanguageOptionsHtml() {
    return TARGET_LANGUAGE_OPTIONS.map(
        (lang) => `<option value="${lang.value}">${lang.label}</option>`,
    ).join('\n');
}

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
                <div class="process-flow-switch" role="group" aria-label="Chế độ xử lý">
                    <button type="button" class="btn secondary process-tour-toggle-btn" id="processTourToggleBtn" title="Xem hướng dẫn nhanh cho phiên mới">? Hướng dẫn</button>
                    <button type="button" class="btn secondary" id="processFlowWizardBtn">Từng bước (5 bước)</button>
                    <button type="button" class="btn primary" id="processFlowQuickBtn">Xử lý nhanh</button>
                </div>
            </div>

            <div class="process-onboarding-guide" id="processTourGuide" hidden>
                <div class="process-tour-head">
                    <div>
                        <strong>Hướng dẫn thiết lập video cho phiên mới</strong>
                        <span>Các nút viền đỏ là chỗ cần chỉnh. Nhấn từng bước để chỉ đúng vị trí hoặc để AI tự cài tối ưu.</span>
                    </div>
                    <div class="process-tour-actions">
                        <button type="button" class="btn primary process-tour-auto-btn" id="processTourAutoBtn">⚡ Để AI tự điều chỉnh</button>
                        <button type="button" class="btn secondary process-tour-done-btn" id="processTourDoneBtn">Đã hiểu · Tắt gợi ý</button>
                    </div>
                </div>
                <div class="process-tour-steps">
                    <button type="button" class="process-tour-step" data-tour-target="#processDownloadSource"><b>Bước 1 · Tải video xem trước</b><span>Bấm <em>Tải video để xem trước</em> để xem khung hình gốc (hoặc bỏ qua để hệ thống tự tải).</span></button>
                    <button type="button" class="process-tour-step" data-tour-target="#processAutoBlurPreview,#toggleProcessPicker,#processAutoBrandBlur" data-tour-tab="video"><b>Bước 2 · Làm mờ vùng sub / logo</b><span>Bấm <em>AI dò vùng mờ</em>, <em>Kéo chọn vùng</em>, hoặc bật <em>Tự động làm mờ watermark</em>.</span></button>
                    <button type="button" class="process-tour-step" data-tour-target="#processSummaryVoice,#processSummaryVoicePreviewBtn,#processInspectorTabAudio" data-tour-tab="audio"><b>Bước 3 · Chọn giọng &amp; Âm lượng</b><span>Chọn giọng AI + <em>Nghe thử</em> hoặc mở tab <em>Âm thanh</em> chỉnh âm lượng &amp; nhạc nền.</span></button>
                    <button type="button" class="process-tour-step" data-tour-target="#processFlowWizardBtn,#processFlowQuickBtn,#runProcessConfig"><b>Bước 4 · Chọn luồng &amp; Bắt đầu</b><span>Chọn <em>Từng bước (5 bước)</em> hoặc <em>Xử lý nhanh</em> rồi bấm <em>Bắt đầu xử lý</em>.</span></button>
                </div>
            </div>

            <div class="process-wizard-bar" id="processWizardBar" hidden>
                <nav class="process-wizard-steps" aria-label="Quy trình 5 bước">
                    <button type="button" class="process-wizard-step is-active" data-wizard-step="1"><b>1</b><span>Tải video</span></button>
                    <button type="button" class="process-wizard-step" data-wizard-step="2"><b>2</b><span>Vùng mờ &amp; Giọng đọc</span></button>
                    <button type="button" class="process-wizard-step" data-wizard-step="3"><b>3</b><span>Âm lượng &amp; Nhạc nền</span></button>
                    <button type="button" class="process-wizard-step" data-wizard-step="4"><b>4</b><span>Xem lại thay đổi</span></button>
                    <button type="button" class="process-wizard-step" data-wizard-step="5"><b>5</b><span>Xuất video</span></button>
                </nav>
                <div class="process-wizard-guide" id="processWizardGuide">
                    <strong id="processWizardGuideTitle">Bước 1: Tải video nguồn</strong>
                    <p id="processWizardGuideText">Bấm “Tải video để xem trước” nếu bạn muốn kiểm tra khung hình, chọn vùng mờ chính xác, hoặc bấm Tiếp tục để sang Bước 2.</p>
                </div>
                <div class="process-wizard-review" id="processWizardReview" hidden></div>
            </div>

            <div class="process-config-body">
            <div class="process-editor-main">
            <div class="process-config-showcase" id="processConfigShowcase">
            <div class="process-stage-topbar" id="processStageTopbar">
                <span class="process-stage-metric-badge" id="processStageMetricBadge">Xem trước video &amp; Logo</span>
                <button type="button" class="btn secondary process-expand-stage-btn" id="processExpandStageBtn" title="Phóng to khung video theo kích thước thực tế để chỉnh Logo và vùng mờ chính xác">
                    ${uiIcon('expand', 14)}<span>Phóng to chỉnh kích thước thật</span>
                </button>
            </div>
            <div class="process-config-preview" id="processConfigPreviewWrap">
                <img id="processConfigPoster" class="process-preview-poster" alt="" hidden>
                <div class="process-preview-stage" id="processPreviewStage">
                    <video id="processConfigPreview" controls preload="metadata"></video>
                    <canvas id="processPreviewCanvas"></canvas>
                    <div id="processBlurPreviewOverlay" class="process-blur-preview-overlay" hidden aria-hidden="true"></div>
                    <div id="processStageLogoOverlay" class="process-stage-logo-overlay" data-shape="rect" hidden>
                        <img id="processStageLogoImg" alt="" draggable="false" hidden>
                        <span id="processStageLogoTextPreview" class="process-stage-logo-text" hidden></span>
                        <span id="processStageLogoDims" class="process-stage-logo-dims"></span>
                        <span id="processStageLogoHandle" class="process-stage-logo-handle" title="Kéo để đổi kích thước logo (giữ đúng tỷ lệ)" aria-hidden="true"></span>
                    </div>
                </div>
                <div id="processConfigPreviewEmpty">
                    <span class="process-empty-icon" aria-hidden="true">${uiIcon('play', 22)}</span>
                    <strong>Xem trước video</strong>
                    <p>Tải bản gốc để kiểm tra vùng mờ và vị trí logo.</p>
                </div>
                <button type="button" class="btn secondary process-download-source" id="processDownloadSource">${uiIcon('download', 16)} Tải video để xem trước</button>
                <div id="processStageSubtitlePreview" class="process-stage-subtitle-preview" data-style="minimal" hidden aria-hidden="true"><span class="process-sub-render-text" id="processStageSubtitleText"></span></div>
            </div>
            <div class="process-expanded-logo-bar" id="processExpandedLogoBar" hidden>
                <div class="process-expanded-logo-controls">
                    <label class="process-expanded-scale-label">
                        <span>Cỡ logo</span>
                        <input type="range" id="processQuickLogoScale" min="3" max="35" step="1" value="12">
                        <strong id="processQuickLogoScaleText">12%</strong>
                    </label>
                    <div class="process-expanded-corner-btns" role="group" aria-label="Đặt nhanh góc logo">
                        <button type="button" class="btn secondary" data-logo-corner="tl">Trên trái</button>
                        <button type="button" class="btn secondary" data-logo-corner="tr">Trên phải</button>
                        <button type="button" class="btn secondary" data-logo-corner="bl">Dưới trái</button>
                        <button type="button" class="btn secondary" data-logo-corner="br">Dưới phải</button>
                    </div>
                    <label class="process-expanded-rect-note">
                        <input type="checkbox" id="processQuickLogoKeepRect" checked>
                        <span>Giữ vuông/chữ nhật (không cắt tròn)</span>
                    </label>
                </div>
                <button type="button" class="btn primary process-collapse-stage-btn" id="processCollapseStageBtn">Xong · Thu nhỏ</button>
            </div>
            <div class="process-preview-tools">
                <div class="process-region-tabs" role="group" aria-label="Loại vùng chỉnh sửa">
                    <button type="button" class="btn secondary process-pick-btn active" data-pick-mode="sub" aria-pressed="true">${uiIcon('blur', 16)} Phụ đề</button>
                    <button type="button" class="btn secondary process-pick-btn" data-pick-mode="sub_novoice" aria-pressed="false" title="Khoanh vùng chữ bay / thoại phụ bất kỳ trên màn hình để dịch thành chữ (không lồng tiếng)">${uiIcon('captions', 15)} Chữ phụ (No Voice)</button>
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
            <div class="process-showcase-subbar" id="processShowcaseSubBar">
                <div class="process-showcase-subbar-row">
                    <span class="process-showcase-subbar-label">${uiIcon('captions', 14)} Kiểu phụ đề xem trên video</span>
                    <div class="process-sub-style-chips" id="processShowcaseStyleChips" role="group" aria-label="Chọn kiểu phụ đề xem trên video">
                        <button type="button" class="is-active" data-sub-style="minimal">Minimal Clean</button>
                        <button type="button" data-sub-style="bold">Creator Bold</button>
                        <button type="button" data-sub-style="cinema">Cinema</button>
                        <button type="button" data-sub-style="neon">Neon Pop</button>
                        <button type="button" data-sub-style="box">Simple Box</button>
                    </div>
                </div>
                <div class="process-showcase-subbar-samples">
                    <div class="process-sub-sample-pills" id="processShowcaseSampleChips" role="group" aria-label="Xem thử từng câu mẫu"></div>
                    <button type="button" class="process-showcase-sub-toggle" id="processToggleStageSubBtn" aria-pressed="false">Xem sub trên video</button>
                </div>
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

            <section class="process-copyright-card" id="processCopyrightCard" aria-label="Kiểm tra bản quyền Video và Nhạc YouTube">
                <div class="process-copyright-head">
                    <div class="process-copyright-title-wrap">
                        <span class="process-copyright-icon-box">${copyrightIconSvg('shield', 15)}</span>
                        <strong>Tra bản quyền Video &amp; Nhạc YouTube</strong>
                        <span class="process-copyright-badge" id="processCopyrightBadge"><i class="cr-status-dot"></i><span>Đang đánh giá…</span></span>
                    </div>
                    <div class="process-copyright-actions">
                        <button type="button" class="btn secondary process-copyright-scan-btn" id="processCopyrightScanBtn" title="Phân tích chuyên sâu cả Nhạc nền & Hình ảnh/Logo video miễn phí bằng AI">
                            ${copyrightIconSvg('scan', 14)}<span>Quét sâu Nhạc &amp; Hình (AI)</span>
                        </button>
                        <button type="button" class="btn secondary process-copyright-fix-btn" id="processCopyrightFixBtn" hidden title="Tự động hạ âm gốc xuống 5%, bật lồng tiếng AI và bật làm mờ logo để né Content ID">
                            ${copyrightIconSvg('bolt', 14)}<span>Áp dụng cấu hình Né Bản Quyền</span>
                        </button>
                    </div>
                </div>
                <div class="process-copyright-metrics">
                    <span class="process-copyright-pill" id="processCopyrightMusicPill">${copyrightIconSvg('music', 13)}<span>Nhạc: Đang kiểm tra</span></span>
                    <span class="process-copyright-pill" id="processCopyrightVisualPill">${copyrightIconSvg('film', 13)}<span>Hình ảnh: Đang kiểm tra</span></span>
                    <span class="process-copyright-music-note" id="processCopyrightMusicNote"></span>
                </div>
                <ul class="process-copyright-warnings" id="processCopyrightWarnings"></ul>
            </section>
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

            <details class="process-config-advanced" id="processSecondarySubPanel">
                <summary><strong>Vùng dịch chữ phụ (Không lồng tiếng)</strong><small>Chữ bay / chú thích vị trí bất kỳ — chỉ dịch chữ, không đọc Voice</small></summary>
                <p>Dùng cho video có thoại phụ/chữ bay ở góc trên, bảng hiệu hoặc chú thích nhân vật. Có thể bấm <strong>AI dò vùng</strong> hoặc chọn tab <strong>Chữ phụ (No Voice)</strong> để kéo vùng.</p>
                <div class="process-interval-head" style="margin-bottom:8px;">
                    <button type="button" class="btn secondary" id="processAutoSecondarySubBtn">${uiIcon('sparkles', 15)} AI dò vùng chữ phụ</button>
                    <button type="button" class="btn secondary" id="processScanSecondarySubBtn">${uiIcon('captions', 15)} Quét &amp; dịch thử</button>
                    <button type="button" class="btn secondary" id="processClearSecondarySubBtn">Xóa vùng</button>
                </div>
                <div class="process-blur-grid">
                    <label>X <input id="processSecondarySubX" type="number" min="0" placeholder="Trống"></label>
                    <label>Y <input id="processSecondarySubY" type="number" min="0" placeholder="Trống"></label>
                    <label>Rộng <input id="processSecondarySubWidth" type="number" min="0" placeholder="Trống"></label>
                    <label>Cao <input id="processSecondarySubHeight" type="number" min="0" placeholder="Trống"></label>
                </div>
                <label class="process-check-option" style="margin-top:8px;">
                    <input id="processSecondarySubBlur" type="checkbox" checked>
                    Làm mờ chữ gốc trong vùng trước khi chèn chữ dịch
                </label>
                <small id="processSecondarySubStatus" role="status"></small>
                <div id="processSecondarySubPreviewList" class="process-secondary-sub-list" hidden></div>
            </details>

            <details class="process-config-advanced">
                <summary><strong>Logo, nhãn lên video</strong><small>Chèn logo chữ nhật/tròn hoặc tên kênh</small></summary>
                <label>Kiểu logo
                    <select id="processLogoMode">
                        <option value="none">Không chèn logo</option>
                        <option value="default">Logo mặc định</option>
                        <option value="custom">Logo ảnh (Chữ nhật / Vuông / PNG)</option>
                        <option value="text">Chèn chữ thay logo</option>
                    </select>
                </label>
                <label id="processLogoShapeField">Hình dáng logo
                    <select id="processLogoShape">
                        <option value="rect">Giữ nguyên khung (Vuông / Chữ nhật · Không cắt tròn)</option>
                        <option value="circle">Cắt hình tròn</option>
                    </select>
                </label>
                <label id="processLogoPathField">Đường dẫn logo mới
                    <input id="processLogoPath" placeholder="D:\\logo.png hoặc đường dẫn file logo">
                </label>
                <label id="processLogoFileField">Chọn tệp logo trên máy
                    <input id="processLogoFile" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml">
                </label>
                <div id="processLogoInlinePreview" class="process-logo-inline-preview" hidden>
                    <img id="processLogoThumbImg" alt="Logo xem trước">
                    <div>
                        <small id="processLogoSavedBadge"></small>
                        <small>Mẹo: Kéo trực tiếp logo trên khung hình video hoặc chọn tab Logo → Kéo chọn vùng.</small>
                    </div>
                </div>
                <label id="processLogoTextField">Nội dung chữ
                    <input id="processLogoText" placeholder="Tên kênh / thương hiệu">
                </label>
                <div class="process-blur-grid process-logo-grid">
                    <label>Rộng (px) <input id="processLogoWidth" type="number" min="1" max="4000" placeholder="Tự động"></label>
                    <label>Cao (px) <input id="processLogoHeight" type="number" min="1" max="4000" placeholder="Tự động"></label>
                    <label>Cỡ (px) <input id="processLogoSize" type="number" min="1" max="4000" placeholder="Mặc định"></label>
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
                    <button type="button" class="process-inspector-tab" id="processInspectorTabOcr" role="tab" data-inspector-tab="ocr" aria-controls="processInspectorOcr" aria-selected="false" tabindex="-1"><span class="process-inspector-tab-icon">${uiIcon('captions', 18)}</span><span>SRT</span></button>
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
                <label class="process-check-option">
                    <input id="processBoostGpu" type="checkbox">
                    Boost GPU
                    <small>Tăng tốc tối đa CUDA Whisper/OCR, NVENC/NVDEC &amp; TTS song song.</small>
                </label>
                </div>
            </section>

            <section class="process-settings-card process-inspector-panel process-subtitles-settings-panel" id="processInspectorSubtitles" data-inspector-panel="subtitles" role="tabpanel" aria-labelledby="processInspectorTabSubtitles" tabindex="0" hidden>
                <div class="process-section-heading"><span class="process-panel-icon" aria-hidden="true">${uiIcon('captions', 18)}</span><strong>Phụ đề &amp; Ngôn ngữ</strong><small>Ngôn ngữ nguồn, đầu ra và kiểu chữ</small></div>
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
                <label class="process-source-language-field">Dịch sang ngôn ngữ (Phụ đề &amp; Lồng tiếng)
                    <select id="processTargetLanguage">
                        ${renderTargetLanguageOptionsHtml()}
                    </select>
                    <small>Mặc định là Tiếng Việt. Có thể chọn Tiếng Anh hoặc ngôn ngữ khác để tạo phụ đề &amp; lồng tiếng AI tương ứng.</small>
                </label>
                <label>Model dịch
                    <select id="processTranslationModel">
                        <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite · Mặc định</option>
                        <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite</option>
                        <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                        <option value="gemini-3.6-flash">Gemini 3.6 Flash</option>
                        <option value="gemini-3.8-flash">Gemini 3.8 Flash</option>
                    </select>
                    <small>Hết quota hoặc bị giới hạn sẽ tự chuyển về Gemini 3.1 Flash Lite.</small>
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

                <div class="process-sub-preview-card" id="processSubtitleStylePreview">
                    <div class="process-sub-preview-head">
                        <div>
                            <strong id="processSubPreviewTitle">Minimal Clean</strong>
                            <small id="processSubPreviewDesc">Chữ trắng sáng, viền đen mảnh gọn gàng, dễ đọc mọi video.</small>
                        </div>
                    </div>
                    <div class="process-sub-style-chips" id="processSubStyleChips" role="group" aria-label="Chọn nhanh kiểu phụ đề">
                        <button type="button" class="is-active" data-sub-style="minimal">Minimal Clean</button>
                        <button type="button" data-sub-style="bold">Creator Bold</button>
                        <button type="button" data-sub-style="cinema">Cinema</button>
                        <button type="button" data-sub-style="neon">Neon Pop</button>
                        <button type="button" data-sub-style="box">Simple Box</button>
                    </div>
                    <div class="process-sub-preview-stage" id="processSubPreviewStage" data-style="minimal">
                        <span class="process-sub-preview-badge">Xem trước mẫu phụ đề</span>
                        <span class="process-sub-render-text" id="processSubPreviewText">Chào mừng bạn đến với kênh hôm nay!</span>
                    </div>
                    <div class="process-sub-sample-list" id="processSubSampleList" role="listbox" aria-label="Các câu mẫu xem trước"></div>
                </div>

                </div>
            </section>
            <section class="process-settings-card process-inspector-panel process-ocr-settings-panel" id="processInspectorOcr" data-inspector-panel="ocr" role="tabpanel" aria-labelledby="processInspectorTabOcr" tabindex="0" hidden>
                <div class="process-section-heading"><span class="process-panel-icon" aria-hidden="true">${uiIcon('captions', 18)}</span><strong>SRT</strong><small>Đọc chữ, dịch và xuất phụ đề</small></div>
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
                    <button type="button" class="process-secondary-button" id="processOcrPickRegion">Chọn vùng phụ đề trên video</button>
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
                    <small class="process-ocr-note" id="processOcrManualStatus" role="status"></small>
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
                    <input id="processTtsSpeed" type="range" min="0.5" max="1.6" step="0.05" value="1.0">
                    <output data-for="processTtsSpeed">1.00x</output>
                </label>
                <label id="processVoiceField">Giọng lồng tiếng
                    <select id="processVoice">
                        ${renderVoiceOptionsHtml()}
                    </select>
                    <button type="button" class="btn secondary" id="processVoicePreviewBtn" style="margin-top:6px;display:inline-flex;align-items:center;gap:6px;">${uiIcon('voice', 14)} Nghe thử</button>
                </label>
                </div>
            </section>
            </div>

<section class="process-settings-card process-inspector-panel process-presets-settings-panel" id="processInspectorPresets" data-inspector-panel="presets" role="tabpanel" aria-labelledby="processInspectorTabPresets" tabindex="0" hidden><div class="process-section-heading"><span class="process-panel-icon" aria-hidden="true">${uiIcon('save', 18)}</span><strong>Cấu hình đã lưu</strong><small>Tự nhớ thao tác gần nhất &amp; dùng lại preset</small></div>
            <div class="process-preset-bar">
                <label class="process-checkbox"><input id="processAutoRememberConfig" type="checkbox" checked> Tự động nhớ thao tác cấu hình gần nhất cho video sau</label>
                <div class="process-section-heading"><strong>Preset</strong><small>Lưu và dùng lại thiết lập yêu thích</small></div>
                <label>Chọn cấu hình
                    <select id="processPresetSelect">
                        <option value="">Không dùng preset</option>
                    </select>
                </label>
                <input id="processPresetName" aria-label="Tên cấu hình mới" placeholder="Tên cấu hình mới">
                <button type="button" class="btn secondary" id="updateProcessPreset" hidden>Cập nhật preset đang chọn</button>
                <button type="button" class="btn secondary" id="saveProcessPreset">Lưu thành preset mới</button>
                <button type="button" class="btn secondary" id="deleteProcessPreset">Xóa</button>
                <small id="processPresetStatus">Tự động lưu thao tác gần nhất. Chọn preset sẽ áp dụng ngay.</small>
            </div>

</section>
                <div class="process-output-review">
                <section class="process-output-summary" id="processOutputSummary" aria-labelledby="processOutputSummaryTitle">
                    <header><h4 id="processOutputSummaryTitle">Tóm tắt đầu ra</h4><span class="process-output-mode" data-output-summary="mode">Vietsub + Voice</span></header>
                    <dl>
                        <div><dt>${uiIcon('video', 13)} Khung hình</dt><dd data-output-summary="frame">Giữ tỷ lệ gốc</dd></div>
                        <div><dt>${uiIcon('captions', 13)} Lời thoại</dt><dd data-output-summary="language">Tự nhận diện → Tiếng Việt</dd></div>
                        <div data-output-summary-row="voice"><dt>${uiIcon('voice', 13)} Giọng đọc</dt><dd style="display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;"><span data-output-summary="voice" hidden>Trúc Ly</span><select id="processSummaryVoice" aria-label="Chọn giọng đọc nhanh" style="max-width:210px;height:28px;font-size:11.5px;padding:0 8px;">${renderVoiceOptionsHtml()}</select><button type="button" class="btn secondary" id="processSummaryVoicePreviewBtn" style="height:28px;min-height:28px;padding:0 10px;font-size:11.5px;display:inline-flex;align-items:center;gap:5px;">${uiIcon('voice', 13)} Nghe thử</button></dd></div>
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
                <button type="button" class="btn secondary" id="processWizardPrev" hidden>← Bước trước</button>
                <button type="button" class="btn primary" id="processWizardNext" hidden>Bước tiếp →</button>
                <button type="submit" class="btn primary" id="runProcessConfig">${uiIcon('sparkles', 16)} Bắt đầu xử lý</button>
                </div>
            </div>
        </form>
    `;
    document.body.appendChild(dialog);

    let reviewDialog = document.getElementById('processTranscriptReviewDialog');
    if (!reviewDialog) {
        reviewDialog = document.createElement('dialog');
        reviewDialog.id = 'processTranscriptReviewDialog';
        reviewDialog.className = 'process-transcript-review-dialog';
        reviewDialog.setAttribute('aria-labelledby', 'processTranscriptReviewTitle');
        reviewDialog.innerHTML = `
            <div class="process-transcript-review-shell">
                <header class="process-transcript-review-head">
                    <div class="process-transcript-review-title">
                        <span class="process-transcript-step">QUY TRÌNH XỬ LÝ VIDEO</span>
                        <h2 id="processTranscriptReviewTitle">Duyệt bản dịch tiếng Việt</h2>
                        <p id="processTranscriptReviewDescription">Xem đúng đoạn video, sửa câu tiếng Việt và thời gian trước khi xuất.</p>
                    </div>
                    <button type="button" class="btn secondary" id="processTranscriptReviewClose" aria-label="Quay lại thiết lập">Quay lại</button>
                </header>
                <nav class="process-transcript-stepper" aria-label="Các bước xử lý">
                    <span class="is-current" id="processTranscriptStepRecognize" aria-current="step"><b>1</b> Nhận diện <small>0%</small></span><i aria-hidden="true"></i>
                    <span id="processTranscriptStepReview"><b>2</b> Dịch &amp; duyệt <small>0%</small></span><i aria-hidden="true"></i>
                    <span id="processTranscriptStepExport"><b>3</b> Xuất thành phẩm <small>0%</small></span>
                </nav>
                <div class="process-transcript-progress" role="progressbar" aria-label="Tiến độ nhận diện lời thoại" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="processTranscriptProgressFill"></span></div>
                <div class="process-transcript-review-status" id="processTranscriptReviewStatus" role="status">Đang nhận diện lời thoại…</div>
                <main class="process-transcript-review-workspace">
                    <section class="process-transcript-preview-panel" aria-label="Xem trước video">
                        <div class="process-transcript-panel-heading"><span>VIDEO NGUỒN</span><small id="processTranscriptScanPosition">Đang chuẩn bị quét</small></div>
                        <div class="process-transcript-preview-player">
                            <video id="processTranscriptReviewPreview" crossorigin="anonymous" controls muted playsinline preload="metadata"></video>
                            <div class="process-transcript-preview-loading" id="processTranscriptPreviewLoading" role="status">Đang mở video xem trước…</div>
                            <button type="button" class="btn secondary process-transcript-preview-retry" id="processTranscriptPreviewRetry" hidden>Thử tải lại video</button>
                        </div>
                    </section>
                    <section class="process-ocr-result-section" aria-label="Bản dịch tiếng Việt">
                        <div class="process-transcript-panel-heading"><span>BẢN DỊCH TIẾNG VIỆT</span><small>Sửa bản dịch · mở câu gốc để đối chiếu</small></div>
                        <div class="process-ocr-table-wrap"><table class="process-ocr-table"><thead><tr><th>#</th><th>THỜI GIAN</th><th>TIẾNG VIỆT · CÓ THỂ SỬA</th><th></th></tr></thead><tbody class="process-ocr-lines" id="processTranscriptReviewLines" aria-live="polite"><tr class="process-ocr-empty"><td colspan="4">Các bản dịch sẽ hiện ở đây sau khi nhận diện.</td></tr></tbody></table></div>
                    </section>
                </main>
                <footer class="process-transcript-review-actions">
                    <div class="process-transcript-review-footnote">Tự tiếp tục xuất khi dịch xong. Bạn có thể tạm dừng để chỉnh bản dịch.</div>
                    <div class="process-transcript-review-buttons"><button type="button" class="btn primary" id="processTranscriptReviewSkip">Bỏ qua duyệt · Tiếp tục xử lý</button>
                    <button type="button" class="btn secondary" id="processTranscriptTranslationRetry" hidden>Thử dịch lại</button>
                    <a class="btn secondary" id="processTranscriptEngineUpdate" href="/api/engine/download" target="_blank" rel="noopener" hidden>Tải bản cập nhật Engine</a>
                    <button type="button" class="btn secondary" id="processTranscriptReviewPause">Tạm dừng để sửa</button>
                    <button type="button" class="btn primary" id="processTranscriptReviewConfirm" disabled hidden>Tiếp tục xuất</button></div>
                </footer>
            </div>`;
        document.body.appendChild(reviewDialog);
    }

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

