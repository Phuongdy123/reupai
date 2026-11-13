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
                    <h3 id="processConfigTitle">Thiết lập Video</h3>
                    <p><span id="processConfigMode">Vietsub</span> · Tùy chỉnh thông số trước khi xử lý</p>
                </div>
            </div>

            <div class="process-config-showcase">
            <div class="process-config-preview" id="processConfigPreviewWrap">
                <div class="process-preview-stage" id="processPreviewStage">
                    <video id="processConfigPreview" controls preload="metadata"></video>
                    <canvas id="processPreviewCanvas"></canvas>
                    <div id="processBlurPreviewOverlay" class="process-blur-preview-overlay" hidden aria-hidden="true"></div>
                </div>
                <div id="processConfigPreviewEmpty">Video chưa tải về máy nên chưa có bản xem trước.</div>
                <button type="button" class="btn secondary process-download-source" id="processDownloadSource">${uiIcon('download', 16)} Tải video để xem trước</button>
            </div>
            <aside class="process-video-info" aria-label="Thông tin video">
                <h4>${uiIcon('video', 18)} Thông tin video</h4>
                <dl>
                    <div><dt>Tên video</dt><dd id="processConfigVideoTitle"></dd></div>
                    <div><dt>Thời lượng</dt><dd id="processConfigDuration">Chưa rõ</dd></div>
                    <div><dt>Độ phân giải</dt><dd id="processConfigResolution">Chưa rõ</dd></div>
                    <div><dt>Tỷ lệ khung hình</dt><dd id="processConfigRatio">Chưa rõ</dd></div>
                    <div><dt>Trạng thái</dt><dd id="processConfigStatus">Đang kiểm tra</dd></div>
                </dl>
                <p>Xem trước trên máy trước khi xử lý để chọn vùng mờ và vị trí logo chính xác.</p>
            </aside>
            </div>

            <div class="process-preview-tools">
                <div class="process-section-heading"><strong>Công cụ nhanh</strong><small>Chọn trực tiếp trên video</small></div>
                <button type="button" class="btn secondary process-pick-btn active" data-pick-mode="sub">${uiIcon('blur', 16)} Vùng mờ sub</button>
                <button type="button" class="btn secondary" id="processAutoBlurPreview">${uiIcon('sparkles', 16)} AI dò vùng mờ · xem thử 8 giây</button>
                <button type="button" class="btn secondary process-pick-btn" data-pick-mode="custom">${uiIcon('blur', 16)} Vùng mờ tùy chỉnh</button>
                <button type="button" class="btn secondary process-pick-btn" data-pick-mode="logo">${uiIcon('sparkles', 16)} Vị trí logo</button>
                <button type="button" class="btn secondary" id="toggleProcessPicker" aria-pressed="false">${uiIcon('pointer', 16)} Bật kéo vùng</button>
                <small id="processPickerHint">Chọn loại vùng trước, sau đó bấm “Bật kéo vùng” nếu muốn kéo trên video.</small>
                <small id="processAutoBlurStatus" role="status"></small>
            </div>

            <div class="process-settings-layout">
            <section class="process-settings-card">
                <div class="process-section-heading"><strong>Phụ đề tiếng Việt</strong><small>Nhận diện lời thoại từ audio gốc, không cần phụ đề có sẵn</small></div>
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
                        <option value="">Giữ nguyên mặc định</option>
                        <option value="shorts">YouTube Shorts · 9:16</option>
                        <option value="youtube">YouTube ngang · 16:9</option>
                        <option value="facebook">Facebook · 4:5</option>
                        <option value="tiktok">TikTok · 9:16</option>
                    </select>
                </label>
                <label>Ngôn ngữ lời thoại
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
                    <small>Whisper nghe audio gốc rồi tạo phụ đề tiếng Việt; chữ phụ đề in trên hình không ảnh hưởng.</small>
                </label>
                <label>Cỡ chữ phụ đề
                    <select id="processFontSize">
                        <option value="">Tự động theo vùng mờ</option>
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
                <label class="process-check-option">
                    <input id="processAutoBrandBlur" type="checkbox">
                    Tự động làm mờ ID/chữ watermark
                    <small>Chỉ bật khi video có watermark ở góc trên.</small>
                </label>
                </div>
            </section>
            <section class="process-settings-card">
                <div class="process-section-heading"><strong>Âm thanh &amp; giọng đọc</strong><small>Âm lượng, giọng đọc và tốc độ</small></div>
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

<details class="process-disclosure process-preset-disclosure"><summary><strong>Cấu hình đã lưu</strong><span>Dùng lại thiết lập yêu thích</span></summary>
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

</details>
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

            <div class="process-config-note">Mặc định chỉ làm mờ phụ đề. Chọn logo hoặc chữ ở trên khi bạn muốn chèn vào video.</div>
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
    return dialog;
}

