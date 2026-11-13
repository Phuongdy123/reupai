// Loaded only when the user opens video processing settings.
import { bindProcessInspectorTabs } from './process-inspector-tabs.js';
import { bindProcessOutputSummary } from './process-output-summary.js';

export async function openProcessConfig(video, card, mode, dependencies) {
    const { document, downloadVideo, ensureProcessConfigDialog, formatDuration, formatVideoRatio, localStorage, processConfigDefaults, processVideo, uiIcon, window, runtimeSignal } = dependencies;
    const dialog = await ensureProcessConfigDialog();
    dialog._configAbort?.abort();
    const resetScrollPositions = () => {
        dialog.querySelectorAll('.process-config-body, .process-editor-main, .process-settings-sidebar, .process-inspector-content')
            .forEach(region => { region.scrollTop = 0; });
    };
    resetScrollPositions();
    const lifetime = new AbortController();
    dialog._configAbort = lifetime;
    const signal = runtimeSignal ? AbortSignal.any([runtimeSignal, lifetime.signal]) : lifetime.signal;
    const isCurrent = () => !signal.aborted && dialog.isConnected && dialog.open;
    const requestJson = (path, options = {}) => window.reupEngineClient.json(path, { ...options, signal });
    const defaults = processConfigDefaults();
    dialog._presetDirtySections = new Set();
    dialog.dataset.presetApplying = '1';
    dialog._logoData = null;
    dialog._logoFilename = null;
    const set = (id, value) => {
        const element = dialog.querySelector(`#${id}`);
        if (element && value !== undefined && value !== null) element.value = value;
        element?.dispatchEvent(new Event('input'));
    };
    const sectionForTarget = target => {
        const id = target?.id || '';
        if (id.startsWith('processOcr') || id === 'processTranscriptSource' || id === 'processSourceLanguage') return 'sub';
        if (id.startsWith('processBlur') || id === 'processBlurPreset' || id === 'processSourceNoSub') return 'sub';
        if (id.startsWith('processCustomBlur') || target?.classList?.contains('blur-start') || target?.classList?.contains('blur-end')) return 'custom';
        if (id.startsWith('processLogo') || id === 'processLogoFile') return 'logo';
        return 'general';
    };
    const updatePresetDirtyStatus = () => {
        const dirty = [...dialog._presetDirtySections];
        const name = dialog.querySelector('#processPresetSelect')?.value || '';
        const status = dialog.querySelector('#processPresetStatus');
        if (!status) return;
        if (!name || !dirty.length) {
            status.textContent = name ? `Đã lưu: ${name}` : 'Không chọn preset: dùng cấu hình hiện tại/mặc định.';
            return;
        }
        status.textContent = `Chưa lưu: ${dirty.join(', ')}. Hãy lưu trước khi xuất.`;
    };
    dialog._presetMarkDirty = target => {
        if (dialog.dataset.presetApplying === '1') return;
        dialog._presetDirtySections.add(sectionForTarget(target));
        updatePresetDirtyStatus();
    };
    const configForm = dialog.querySelector('form');
    const inspector = bindProcessInspectorTabs(dialog, { window, signal });
    const outputSummary = bindProcessOutputSummary(dialog, { mode, signal });
    if (!dialog.dataset.presetDirtyBound) {
        configForm.addEventListener('input', event => dialog._presetMarkDirty?.(event.target), true);
        configForm.addEventListener('change', event => dialog._presetMarkDirty?.(event.target), true);
        dialog.dataset.presetDirtyBound = '1';
    }
    dialog.dataset.mode = mode;
    dialog.dataset.videoId = video.video_id;
    dialog.dataset.cardId = card.dataset.videoId || '';

    dialog.querySelector('#processConfigMode').textContent = mode === 'subtitle' ? 'Vietsub' : 'Voice + Vietsub';
    dialog.querySelector('#processConfigVideoTitle').textContent = video.title || video.video_id;
    dialog.querySelector('#processConfigVideoTitle').title = video.title || video.video_id;
    dialog.querySelector('#processConfigDuration').textContent = formatDuration(video.duration_seconds || video.duration) || 'Chưa rõ';
    const sourceWidth = Number(video.video_width || video.width || 0);
    const sourceHeight = Number(video.video_height || video.height || 0);
    dialog.querySelector('#processConfigResolution').textContent = sourceWidth && sourceHeight ? `${sourceWidth} × ${sourceHeight}` : 'Chưa rõ';
    dialog.querySelector('#processConfigRatio').textContent = formatVideoRatio(video) || 'Chưa rõ';
    dialog.querySelector('#processConfigStatus').textContent = video.downloaded ? 'Đã tải về máy' : 'Chưa tải về máy';
    dialog.querySelector('#processVoiceField').style.display = mode === 'voiceover' ? '' : 'none';
    set('processPreviewSeconds', defaults.preview_seconds || '');
    set('processFontSize', defaults.subtitle_font_size || '');
    set('processSourceLanguage', defaults.source_language || 'auto');
    set('processTranscriptSource', defaults.transcript_source || 'audio');
    set('processOcrLanguage', defaults.ocr_language || 'auto');
    set('processOcrFps', defaults.ocr_fps ?? 2);
    set('processOcrConfidence', defaults.ocr_min_confidence ?? 0.45);
    set('processOcrParallelism', defaults.ocr_parallelism ?? 2);
    set('processOcrSimilarity', defaults.ocr_similarity_threshold ?? 0.82);
    dialog.querySelector('#processOcrUseGpu').checked = defaults.ocr_use_gpu === true;
    dialog.querySelector('#processOcrMergeSimilar').checked = defaults.ocr_merge_similar !== false;
    const transcriptSource = dialog.querySelector('#processTranscriptSource');
    const ocrOptions = dialog.querySelector('#processOcrOptions');
    const ocrMergeSimilar = dialog.querySelector('#processOcrMergeSimilar');
    const ocrSimilarityField = dialog.querySelector('#processOcrSimilarityField');
    const ocrNote = dialog.querySelector('#processOcrNote');
    const syncOcrOptions = () => {
        const enabled = transcriptSource?.value === 'video_subtitles';
        if (ocrOptions) ocrOptions.hidden = !enabled;
        if (ocrSimilarityField) ocrSimilarityField.hidden = !ocrMergeSimilar?.checked;
        if (ocrNote) {
            const fps = Number(dialog.querySelector('#processOcrFps')?.value || 2);
            ocrNote.textContent = `Quét ${fps.toLocaleString('vi-VN')} khung hình/giây. Tăng tốc độ sẽ đọc sát hơn nhưng xử lý lâu hơn; lần đầu có thể cần tải model OCR.`;
        }
    };
    transcriptSource.onchange = syncOcrOptions;
    ocrMergeSimilar.onchange = syncOcrOptions;
    dialog.querySelector('#processOcrFps').oninput = syncOcrOptions;
    syncOcrOptions();
    set('processSubtitleStyle', defaults.subtitle_style || 'minimal');
    set('processOriginalVolume', defaults.original_volume ?? 0.15);
    set('processVoiceVolume', defaults.voice_volume ?? 1);
    set('processTtsSpeed', defaults.tts_speed ?? 1.10);
    set('processVoice', defaults.voice || 'Trúc Ly');
    set('processAspectRatio', defaults.aspect_ratio || '');
    set('processMusicUrl', defaults.music_url || '');
    set('processMusicVolume', defaults.music_volume ?? 0.25);
    dialog.querySelector('#processSourceNoSub').checked = defaults.source_subtitle_mode === 'none';
    dialog.querySelector('#processAutoBrandBlur').checked = defaults.auto_brand_blur === true;
    const musicFileInput = dialog.querySelector('#processMusicFile');
    const musicUrlInput = dialog.querySelector('#processMusicUrl');
    const musicHint = dialog.querySelector('#processMusicHint');
    const syncMusicChoice = () => {
        const hasFile = !!musicFileInput?.files?.[0];
        const hasUrl = !!musicUrlInput?.value?.trim();
        if (musicHint) musicHint.textContent = hasFile
            ? `Dùng tệp: ${musicFileInput.files[0].name}.`
            : hasUrl
                ? 'Local Engine sẽ tải, kiểm tra audio và lưu cache theo link này.'
                : 'Không chọn nhạc: video giữ nguyên âm thanh hiện có.';
    };
    if (musicFileInput) {
        musicFileInput.value = '';
        musicFileInput.onchange = () => {
            if (musicFileInput.files?.[0] && musicUrlInput) musicUrlInput.value = '';
            syncMusicChoice();
        };
    }
    if (musicUrlInput) {
        musicUrlInput.oninput = () => {
            musicUrlInput.setCustomValidity('');
            if (musicUrlInput.value.trim() && musicFileInput) musicFileInput.value = '';
            syncMusicChoice();
        };
    }
    syncMusicChoice();
    set('processLogoSize', defaults.logo_size ?? '');
    set('processLogoX', defaults.logo_x ?? '');
    set('processLogoY', defaults.logo_y ?? '');
    ['x', 'y', 'width', 'height'].forEach(key => set(`processBlur${key[0].toUpperCase()}${key.slice(1)}`, defaults.blur_region?.[key] ?? ''));
    ['x', 'y', 'width', 'height'].forEach(key => set(`processCustomBlur${key[0].toUpperCase()}${key.slice(1)}`, defaults.custom_blur_region?.[key] ?? ''));

    const blurPreset = dialog.querySelector('#processBlurPreset');
    blurPreset.value = '';
    blurPreset.onchange = () => {
        const preset = blurPreset.value;
        dialog.querySelector('#processBlurPreset').dataset.manual = preset;
    };

    const intervalRoot = dialog.querySelector('#blurIntervals');
    intervalRoot.innerHTML = '';
    const addInterval = (item = {}) => {
        const row = document.createElement('div');
        row.className = 'blur-interval-row';
        row.innerHTML = `
            <label>Từ giây <input class="blur-start" type="number" min="0" step="0.1" value="${item.start ?? ''}" placeholder="1"></label>
            <label>Đến giây <input class="blur-end" type="number" min="0" step="0.1" value="${item.end ?? ''}" placeholder="12"></label>
            <button type="button" class="btn secondary remove-blur-interval" aria-label="Xóa khoảng mờ">${uiIcon('close', 15)}</button>
        `;
        row.querySelector('.remove-blur-interval').onclick = () => row.remove();
        intervalRoot.appendChild(row);
    };
    (defaults.blur_intervals || []).forEach(addInterval);
    dialog.querySelector('#addBlurInterval').onclick = () => addInterval();

    const logoMode = dialog.querySelector('#processLogoMode');
    const updateLogoFields = () => {
        const mode = logoMode.value;
        dialog.querySelector('#processLogoPathField').style.display = mode === 'custom' ? '' : 'none';
        dialog.querySelector('#processLogoFileField').style.display = mode === 'custom' ? '' : 'none';
        dialog.querySelector('#processLogoTextField').style.display = mode === 'text' ? '' : 'none';
    };
    set('processLogoMode', defaults.logo_mode || 'none');
    set('processLogoPath', defaults.logo_path || '');
    set('processLogoText', defaults.logo_text || '');
    logoMode.onchange = updateLogoFields;
    updateLogoFields();
    dialog.dataset.presetApplying = '0';

    const downloadButton = dialog.querySelector('#processDownloadSource');
    downloadButton.disabled = false;
    downloadButton.innerHTML = `${uiIcon('download', 16)} Tải video để xem trước`;
    downloadButton.hidden = !!video.downloaded;
    downloadButton.onclick = async () => {
        downloadButton.disabled = true;
        downloadButton.textContent = 'Đang tải video...';
        setPreviewState('downloading');
        try {
            await downloadVideo(video, card);
            if (!isCurrent()) return;
            if (!video.downloaded) { setPreviewState('empty'); return; }
            setPreviewState('loading');
            const sourceUrl = await window.reupEngineClient.mediaUrl(`/api/preview/source/${encodeURIComponent(video.video_id)}`);
            if (!isCurrent()) return;
            preview.src = sourceUrl;
            preview.load();
        } catch (error) {
            if (isCurrent()) {
                setPreviewState('error');
                empty.querySelector('p').textContent = error.message || 'Chưa tải được video. Hãy kiểm tra kết nối rồi thử lại.';
            }
        } finally {
            if (isCurrent()) {
                downloadButton.disabled = false;
                downloadButton.innerHTML = `${uiIcon('download', 16)} Tải video để xem trước`;
            }
        }
    };

    const preview = dialog.querySelector('#processConfigPreview');
    const poster = dialog.querySelector('#processConfigPoster');
    const sourceCover = card.querySelector?.('img');
    poster.hidden = true;
    poster.removeAttribute('src');
    poster.onload = () => { if (isCurrent()) poster.hidden = false; };
    poster.onerror = () => { poster.hidden = true; };
    if (sourceCover?.complete && sourceCover.naturalWidth > 0 && sourceCover.currentSrc) {
        poster.src = sourceCover.currentSrc;
    }
    const empty = dialog.querySelector('#processConfigPreviewEmpty');
    const stage = dialog.querySelector('#processPreviewStage');
    const canvas = dialog.querySelector('#processPreviewCanvas');
    const blurOverlay = dialog.querySelector('#processBlurPreviewOverlay');
    const autoBlurButton = dialog.querySelector('#processAutoBlurPreview');
    autoBlurButton.disabled = false;
    const autoBlurStatus = dialog.querySelector('#processAutoBlurStatus');
    autoBlurStatus.textContent = '';
    const pickButtons = [...dialog.querySelectorAll('.process-pick-btn')];
    const pickerToggle = dialog.querySelector('#toggleProcessPicker');
    let pickMode = 'sub';
    let pickingEnabled = false;
    let dragStart = null;
    let selectedRect = null;
    let blurPreviewEnd = 0;
    let blurPreviewWasMuted = false;
    const syncPickButtons = () => pickButtons.forEach(button => {
        const selected = button.dataset.pickMode === pickMode;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
    });
    const setPreviewState = state => {
        const ready = state === 'ready';
        dialog.dataset.previewState = state;
        pickButtons.forEach(button => { button.disabled = !ready; });
        pickerToggle.disabled = !ready;
        autoBlurButton.disabled = !ready;
        downloadButton.hidden = ready || state === 'loading';
        empty.style.display = ready ? 'none' : '';
        empty.querySelector('strong').textContent = state === 'loading' ? 'Đang mở video…' : state === 'downloading' ? 'Đang tải video…' : 'Xem trước video';
        empty.querySelector('p').textContent = state === 'loading' || state === 'downloading'
            ? 'Bạn có thể tiếp tục điều chỉnh thiết lập bên dưới.'
            : 'Tải video để chọn vùng mờ và đặt logo chính xác.';
        dialog.querySelector('#processPickerHint').textContent = ready
            ? 'Chọn loại vùng rồi bật kéo chọn để chỉnh trực tiếp trên video.'
            : 'Công cụ chỉnh vùng sẽ sẵn sàng sau khi tải video.';
    };
    syncPickButtons();
    canvas.classList.remove('is-picking');
    canvas.style.pointerEvents = 'none';
    pickerToggle.setAttribute('aria-pressed', 'false');
    pickerToggle.classList.remove('active');
    pickerToggle.innerHTML = `${uiIcon('pointer', 16)} Kéo chọn vùng`;
    setPreviewState(video.downloaded ? 'loading' : 'empty');

    const positionBlurOverlay = () => {
        if (!blurOverlay || !preview.videoWidth || !selectedRect) return;
        const rect = preview.getBoundingClientRect();
        const stageRect = stage.getBoundingClientRect();
        blurOverlay.style.left = `${rect.left - stageRect.left + selectedRect.x / preview.videoWidth * rect.width}px`;
        blurOverlay.style.top = `${rect.top - stageRect.top + selectedRect.y / preview.videoHeight * rect.height}px`;
        blurOverlay.style.width = `${selectedRect.width / preview.videoWidth * rect.width}px`;
        blurOverlay.style.height = `${selectedRect.height / preview.videoHeight * rect.height}px`;
    };
    const stopBlurPreview = () => {
        const wasActive = blurPreviewEnd > 0 || !blurOverlay.hidden;
        if (blurPreviewEnd) preview.pause();
        blurPreviewEnd = 0;
        if (wasActive) preview.muted = blurPreviewWasMuted;
        blurOverlay.hidden = true;
        canvas.style.visibility = '';
        drawSelection();
    };
    dialog.onclose = () => {
        if (dialog.open) return;
        lifetime.abort();
        dialog._assistantRequestSeq = (dialog._assistantRequestSeq || 0) + 1;
        stopBlurPreview();
        preview.pause();
        preview.removeAttribute('src');
        preview.load();
    };

    const syncSelectionFromFields = () => {
        const value = id => dialog.querySelector(`#${id}`)?.value || '';
        const prefix = pickMode === 'logo'
            ? 'processLogo'
            : pickMode === 'custom'
                ? 'processCustomBlur'
                : 'processBlur';
        const read = suffix => Number(value(`${prefix}${suffix}`));
        const values = ['X', 'Y', 'Width', 'Height'].map(read);
        if (values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) {
            selectedRect = {
                x: Math.max(0, values[0]),
                y: Math.max(0, values[1]),
                width: Math.max(0, values[2]),
                height: Math.max(0, values[3]),
            };
        } else {
            selectedRect = null;
        }
        drawSelection();
    };

    const drawSelection = () => {
        if (!canvas || !preview.videoWidth || !preview.videoHeight) return;
        const rect = preview.getBoundingClientRect();
        const stageRect = stage.getBoundingClientRect();
        canvas.width = preview.videoWidth;
        canvas.height = preview.videoHeight;
        // Video dọc thường bị giới hạn chiều cao và được căn giữa trong stage.
        // Canvas phải trùng đúng rect của video, nếu không tọa độ kéo sẽ bị
        // co nhỏ hoặc lệch sang trái/phải trước khi gửi sang pipeline.
        canvas.style.left = `${rect.left - stageRect.left}px`;
        canvas.style.top = `${rect.top - stageRect.top}px`;
        canvas.style.right = 'auto';
        canvas.style.bottom = 'auto';
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        const context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);
        if (!blurOverlay.hidden) positionBlurOverlay();
        if (!selectedRect) return;
        context.fillStyle = pickMode === 'logo' ? 'rgba(124,108,255,.22)' : pickMode === 'custom' ? 'rgba(251,191,36,.22)' : 'rgba(45,212,191,.22)';
        context.strokeStyle = pickMode === 'logo' ? '#9b91ff' : pickMode === 'custom' ? '#fbbf24' : '#2dd4bf';
        context.lineWidth = Math.max(3, canvas.width / 420);
        context.fillRect(selectedRect.x, selectedRect.y, selectedRect.width, selectedRect.height);
        context.strokeRect(selectedRect.x, selectedRect.y, selectedRect.width, selectedRect.height);
    };

    // CSS layout changes do not fire the video's intrinsic-size resize event.
    // Keep selection coordinates aligned when the inspector or viewport resizes.
    let resizeFrame = 0;
    const scheduleSelectionResize = () => {
        if (!isCurrent() || dialog.dataset.previewState !== 'ready' || resizeFrame) return;
        resizeFrame = window.requestAnimationFrame(() => {
            resizeFrame = 0;
            if (isCurrent() && dialog.dataset.previewState === 'ready') drawSelection();
        });
    };
    if (!signal.aborted) {
        const resizeObserver = typeof window.ResizeObserver === 'function'
            ? new window.ResizeObserver(scheduleSelectionResize)
            : null;
        if (resizeObserver) {
            resizeObserver.observe(preview);
            resizeObserver.observe(stage);
        } else {
            window.addEventListener('resize', scheduleSelectionResize, { signal });
        }
        signal.addEventListener('abort', () => {
            resizeObserver?.disconnect();
            if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
            resizeFrame = 0;
        }, { once: true });
    }

    const updateSelectionFields = rect => {
        if (!rect) return;
        if (pickMode === 'logo') {
            set('processLogoSize', Math.round(Math.min(rect.width, rect.height)));
            set('processLogoX', Math.round(rect.x));
            set('processLogoY', Math.round(rect.y));
        } else if (pickMode === 'custom') {
            set('processCustomBlurX', Math.round(rect.x));
            set('processCustomBlurY', Math.round(rect.y));
            set('processCustomBlurWidth', Math.round(rect.width));
            set('processCustomBlurHeight', Math.round(rect.height));
        } else {
            rect = { ...rect, x: 0, width: preview.videoWidth || rect.width };
            selectedRect = rect;
            set('processBlurX', 0);
            set('processBlurY', Math.round(rect.y));
            set('processBlurWidth', Math.round(rect.width));
            set('processBlurHeight', Math.round(rect.height));
            set('processBlurPreset', '');
        }
    };

    pickButtons.forEach(button => {
        button.onclick = () => {
            stopBlurPreview();
            pickMode = button.dataset.pickMode || 'blur';
            // Vùng logo là một lựa chọn chủ động: chỉ lúc đó mới bật logo
            // mặc định cho job này. Các job không chọn logo vẫn không chèn gì.
            if (
                pickMode === 'logo'
                && logoMode.value === 'none'
            ) {
                logoMode.value = 'default';
                logoMode.dispatchEvent(new Event('change'));
            }
            syncPickButtons();
            syncSelectionFromFields();
        };
    });

    const setPickingEnabled = enabled => {
        if (enabled) stopBlurPreview();
        pickingEnabled = !!enabled && dialog.dataset.previewState === 'ready';
        if (canvas) {
            canvas.classList.toggle('is-picking', pickingEnabled);
            canvas.style.pointerEvents = pickingEnabled ? 'auto' : 'none';
        }
        if (pickerToggle) {
            pickerToggle.setAttribute('aria-pressed', pickingEnabled ? 'true' : 'false');
            pickerToggle.classList.toggle('active', pickingEnabled);
            pickerToggle.innerHTML = `${uiIcon('pointer', 16)} ${pickingEnabled ? 'Xong chọn vùng' : 'Kéo chọn vùng'}`;
        }
        const hint = dialog.querySelector('#processPickerHint');
        if (hint) hint.textContent = pickingEnabled
            ? 'Kéo trên video để chọn vùng. Bấm “Xong chọn vùng” để tiếp tục xem.'
            : dialog.dataset.previewState === 'ready'
                ? 'Chọn loại vùng rồi bật kéo chọn để chỉnh trực tiếp trên video.'
                : 'Công cụ chỉnh vùng sẽ sẵn sàng sau khi tải video.';
    };
    if (pickerToggle) pickerToggle.onclick = () => setPickingEnabled(!pickingEnabled);

    if (stage && canvas) {
        canvas.onpointerdown = event => {
            if (!pickingEnabled || !preview.videoWidth) return;
            const bounds = canvas.getBoundingClientRect();
            const scaleX = preview.videoWidth / bounds.width;
            const scaleY = preview.videoHeight / bounds.height;
            dragStart = {
                x: Math.max(0, Math.min(preview.videoWidth, (event.clientX - bounds.left) * scaleX)),
                y: Math.max(0, Math.min(preview.videoHeight, (event.clientY - bounds.top) * scaleY)),
            };
            canvas.setPointerCapture(event.pointerId);
        };
        canvas.onpointermove = event => {
            if (!pickingEnabled || !dragStart) return;
            const bounds = canvas.getBoundingClientRect();
            const scaleX = preview.videoWidth / bounds.width;
            const scaleY = preview.videoHeight / bounds.height;
            const current = {
                x: Math.max(0, Math.min(preview.videoWidth, (event.clientX - bounds.left) * scaleX)),
                y: Math.max(0, Math.min(preview.videoHeight, (event.clientY - bounds.top) * scaleY)),
            };
            selectedRect = {
                x: pickMode === 'sub' ? 0 : Math.max(0, Math.min(dragStart.x, current.x)),
                y: Math.max(0, Math.min(dragStart.y, current.y)),
                width: pickMode === 'sub' ? preview.videoWidth : Math.abs(current.x - dragStart.x),
                height: Math.abs(current.y - dragStart.y),
            };
            drawSelection();
        };
        canvas.onpointerup = event => {
            if (!pickingEnabled || !dragStart) return;
            dragStart = null;
            if (selectedRect && selectedRect.width > 4 && selectedRect.height > 4) {
                updateSelectionFields(selectedRect);
            }
            try { canvas.releasePointerCapture(event.pointerId); } catch {}
        };
    }


    preview.onerror = () => {
        if (!isCurrent()) return;
        setPreviewState('error');
        preview.style.display = 'none';
        canvas.style.display = 'none';
        stage.dataset.aspect = '';
        dialog.querySelector('#processConfigStatus').textContent = 'Chưa có bản xem trước';
    };
    preview.onloadedmetadata = () => {
        if (!isCurrent()) return;
        if (!preview.videoWidth || !preview.videoHeight) { preview.onerror(); return; }
        setPreviewState('ready');
        video.downloaded = true;
        downloadButton.hidden = true;
        const ratio = preview.videoWidth / Math.max(1, preview.videoHeight);
        stage.dataset.aspect = ratio > 1.12 ? 'landscape' : ratio < .89 ? 'portrait' : 'square';
        preview.style.display = 'block';
        canvas.style.display = 'block';
        empty.style.display = 'none';
        dialog.querySelector('#processConfigStatus').textContent = 'Sẵn sàng xem trước';
        dialog.querySelector('#processConfigDuration').textContent = formatDuration(preview.duration) || dialog.querySelector('#processConfigDuration').textContent;
        dialog.querySelector('#processConfigResolution').textContent = `${preview.videoWidth} × ${preview.videoHeight}`;
        dialog.querySelector('#processConfigRatio').textContent = formatVideoRatio({ width: preview.videoWidth, height: preview.videoHeight }) || 'Chưa rõ';
        drawSelection();
    };
    preview.onresize = drawSelection;
    preview.ontimeupdate = () => {
        if (blurPreviewEnd && preview.currentTime >= blurPreviewEnd) {
            stopBlurPreview();
            autoBlurStatus.textContent = 'Đã xem thử 8 giây. Dải mờ chạy hết chiều ngang video; bạn có thể chỉnh chiều cao và vị trí bên dưới.';
        }
    };
    autoBlurButton.onclick = async () => {
        if (!preview.videoWidth || !video.downloaded) {
            autoBlurStatus.textContent = 'Hãy tải video về máy trước khi AI dò vùng mờ.';
            return;
        }
        autoBlurButton.disabled = true;
        autoBlurStatus.textContent = 'AI đang tìm vị trí phụ đề gốc trên video…';
        try {
            const channel = encodeURIComponent(video.channel || '2d_animation');
            const result = await requestJson(
                `/api/preview/subtitle-region/${encodeURIComponent(video.video_id)}?channel=${channel}`,
                { timeoutMs: 180000 },
            );
            if (!isCurrent() || !dialog.open) return;
            const detected = result.blur || {};
            const scaleY = preview.videoHeight / Math.max(1, Number(result.video?.height || preview.videoHeight));
            selectedRect = {
                x: 0,
                y: Math.round(Number(detected.y || 0) * scaleY),
                width: preview.videoWidth,
                height: Math.max(1, Math.round(Number(detected.height || 0) * scaleY)),
            };
            pickMode = 'sub';
            syncPickButtons();
            updateSelectionFields(selectedRect);
            dialog.querySelector('#processSourceNoSub').checked = false;
            outputSummary.refresh();
            setPickingEnabled(false);
            const length = 8;
            const start = Math.max(0, Math.min(Math.max(0, preview.duration - length), Number(result.preview_time_seconds || 0) - 1));
            preview.currentTime = start;
            blurPreviewEnd = Math.min(preview.duration, start + length);
            blurPreviewWasMuted = preview.muted;
            preview.muted = true;
            blurOverlay.hidden = false;
            canvas.style.visibility = 'hidden';
            positionBlurOverlay();
            autoBlurStatus.textContent = 'Đang xem thử mô phỏng dải mờ trên video trong 8 giây…';
            await preview.play();
        } catch (error) {
            if (!isCurrent()) return;
            stopBlurPreview();
            autoBlurStatus.textContent = error?.status === 404
                ? 'Cần cập nhật Local Engine để dùng chức năng xem thử vùng mờ AI.'
                : (error?.message || 'Chưa xem thử được. Bạn có thể tự kéo vùng mờ trên video.');
        } finally {
            if (isCurrent()) autoBlurButton.disabled = false;
        }
    };
    preview.crossOrigin = 'anonymous';
    if (video.downloaded) {
        window.reupEngineClient.mediaUrl(`/api/preview/source/${encodeURIComponent(video.video_id)}`)
            .then(url => { if (isCurrent()) preview.src = url; })
            .catch(() => { if (isCurrent()) preview.onerror(); });
    }

    dialog.querySelector('#resetProcessConfig').onclick = () => {
        set('processPreviewSeconds', '');
        set('processFontSize', '');
        set('processSourceLanguage', 'auto');
        set('processTranscriptSource', 'audio');
        set('processOcrLanguage', 'auto');
        set('processOcrFps', 2);
        set('processOcrConfidence', 0.45);
        set('processOcrParallelism', 2);
        set('processOcrSimilarity', 0.82);
        dialog.querySelector('#processOcrUseGpu').checked = false;
        dialog.querySelector('#processOcrMergeSimilar').checked = true;
        syncOcrOptions();
        set('processSubtitleStyle', 'minimal');
        set('processOriginalVolume', 0.15);
        set('processVoiceVolume', 1);
        set('processTtsSpeed', 1.10);
        set('processVoice', 'Trúc Ly');
        set('processAspectRatio', '');
        set('processMusicUrl', '');
        set('processMusicVolume', 0.25);
        dialog.querySelector('#processMusicFile').value = '';
        dialog.querySelector('#processAutoBrandBlur').checked = false;
        dialog.querySelector('#processSourceNoSub').checked = false;
        set('processBlurPreset', '');
        ['processBlurX', 'processBlurY', 'processBlurWidth', 'processBlurHeight',
            'processCustomBlurX', 'processCustomBlurY', 'processCustomBlurWidth', 'processCustomBlurHeight',
            'processLogoSize', 'processLogoX', 'processLogoY', 'processLogoPath', 'processLogoText']
            .forEach(id => set(id, ''));
        set('processLogoMode', 'none');
        intervalRoot.innerHTML = '';
        dialog.querySelector('#processLogoFile').value = '';
        dialog._logoData = null;
        dialog._logoFilename = null;
        updateLogoFields();
        pickMode = 'sub';
        syncPickButtons();
        setPickingEnabled(false);
        selectedRect = null;
        drawSelection();
        outputSummary.refresh();
    };

    // Preset v2: bản cấu hình độc lập cho từng job, áp dụng ngay khi chọn.
    const presetStoreKey = 'reup.process.presets.v2';
    const presetSelect = dialog.querySelector('#processPresetSelect');
    const presetNameInput = dialog.querySelector('#processPresetName');
    const presetStatus = dialog.querySelector('#processPresetStatus');
    const readPresets = () => {
        try {
            const value = JSON.parse(localStorage.getItem(presetStoreKey) || '{}');
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch {
            return {};
        }
    };
    const writePresets = async presets => {
        try {
        await requestJson('/api/library/ui-state/process_presets_v2', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: presets }),
        });
        localStorage.setItem(presetStoreKey, JSON.stringify(presets));
        return true;
        } catch (error) {
            if (isCurrent()) presetStatus.textContent = 'Không lưu được preset: ' + error.message;
            return false;
        }
    };
    const collectPresetConfig = () => {
        const value = id => dialog.querySelector(`#${id}`)?.value || '';
        const fields = [
            'processPreviewSeconds', 'processFontSize', 'processSourceLanguage', 'processTranscriptSource',
            'processOcrLanguage', 'processOcrFps', 'processOcrConfidence', 'processOcrParallelism', 'processOcrSimilarity', 'processSubtitleStyle', 'processOriginalVolume',
            'processVoiceVolume', 'processTtsSpeed', 'processVoice',
            'processAspectRatio', 'processMusicUrl', 'processMusicVolume',
            'processBlurPreset', 'processLogoMode', 'processLogoPath',
            'processLogoText', 'processLogoSize', 'processLogoX', 'processLogoY',
            'processCustomBlurX', 'processCustomBlurY', 'processCustomBlurWidth',
            'processCustomBlurHeight', 'processBlurX', 'processBlurY',
            'processBlurWidth', 'processBlurHeight',
        ];
        return {
            ...Object.fromEntries(fields.map(id => [id, value(id)])),
            auto_brand_blur: !!dialog.querySelector('#processAutoBrandBlur')?.checked,
            ocr_use_gpu: !!dialog.querySelector('#processOcrUseGpu')?.checked,
            ocr_merge_similar: !!dialog.querySelector('#processOcrMergeSimilar')?.checked,
            source_subtitle_mode: dialog.querySelector('#processSourceNoSub')?.checked ? 'none' : 'auto',
            active_pick_mode: pickMode,
            logo_data: dialog._logoData || null,
            logo_filename: dialog._logoFilename || null,
            blur_intervals: [...dialog.querySelectorAll('.blur-interval-row')].map(row => ({
                start: row.querySelector('.blur-start')?.value || '',
                end: row.querySelector('.blur-end')?.value || '',
            })),
        };
    };
    const applyPresetConfig = (preset, name = '') => {
        if (!preset) return;
        dialog.dataset.presetApplying = '1';
        Object.entries(preset).forEach(([id, value]) => {
            if (id === 'auto_brand_blur') {
                dialog.querySelector('#processAutoBrandBlur').checked = !!value;
            } else if (id === 'ocr_use_gpu') {
                dialog.querySelector('#processOcrUseGpu').checked = !!value;
            } else if (id === 'ocr_merge_similar') {
                dialog.querySelector('#processOcrMergeSimilar').checked = !!value;
            } else if (id === 'source_subtitle_mode') {
                dialog.querySelector('#processSourceNoSub').checked = value === 'none';
            } else if (id === 'logo_data') {
                dialog._logoData = value || null;
            } else if (id === 'logo_filename') {
                dialog._logoFilename = value || null;
            } else if (id === 'active_pick_mode' || id === 'blur_intervals') {
                return;
            } else {
                set(id, value);
            }
        });
        intervalRoot.innerHTML = '';
        (Array.isArray(preset.blur_intervals) ? preset.blur_intervals : []).forEach(addInterval);
        if (['sub', 'custom', 'logo'].includes(preset.active_pick_mode)) {
            pickMode = preset.active_pick_mode;
            pickButtons.forEach(button => button.classList.toggle('active', button.dataset.pickMode === pickMode));
        }
        logoMode.dispatchEvent(new Event('change'));
        syncOcrOptions();
        syncSelectionFromFields();
        dialog._presetDirtySections.clear();
        dialog.dataset.presetApplying = '0';
        presetStatus.textContent = name ? `Đã áp dụng: ${name}` : 'Đã áp dụng cấu hình realtime.';
        outputSummary.refresh();
    };
    const refreshPresetOptions = (presets, selected = '') => {
        presetSelect.innerHTML = '<option value="">Không dùng preset</option>';
        Object.keys(presets).sort((a, b) => a.localeCompare(b, 'vi')).forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            presetSelect.appendChild(option);
        });
        presetSelect.value = selected;
    };
    const presets = readPresets();
    refreshPresetOptions(presets);
    presetSelect.onchange = () => {
        const name = presetSelect.value;
        if (!name || !presets[name]) return;
        applyPresetConfig(presets[name], name);
    };
    dialog.querySelector('#saveProcessPreset').onclick = async () => {
        const name = presetNameInput.value.trim();
        if (!name) {
            presetStatus.textContent = 'Hãy nhập tên preset trước.';
            presetNameInput.focus();
            return;
        }
        presets[name] = collectPresetConfig();
        if (!await writePresets(presets)) return;
        refreshPresetOptions(presets, name);
        applyPresetConfig(presets[name], name);
        presetNameInput.value = '';
    };
    dialog.querySelector('#deleteProcessPreset').onclick = async () => {
        const name = presetSelect.value;
        if (!name || !presets[name]) return;
        delete presets[name];
        if (!await writePresets(presets)) return;
        refreshPresetOptions(presets);
        presetStatus.textContent = `Đã xóa: ${name}`;
    };
    const saveSection = async (section, label) => {
        const name = presetSelect.value;
        if (name && presets[name]) {
            const current = collectPresetConfig();
            const sectionFields = {
                sub: ['processBlurPreset', 'processBlurX', 'processBlurY', 'processBlurWidth', 'processBlurHeight', 'source_subtitle_mode'],
                custom: ['processCustomBlurX', 'processCustomBlurY', 'processCustomBlurWidth', 'processCustomBlurHeight', 'blur_intervals'],
                logo: ['processLogoMode', 'processLogoPath', 'processLogoText', 'processLogoSize', 'processLogoX', 'processLogoY'],
            }[section] || [];
            const saved = { ...presets[name] };
            sectionFields.forEach(field => { saved[field] = current[field]; });
            if (section === 'sub') saved.auto_brand_blur = current.auto_brand_blur;
            if (section === 'logo') {
                saved.logo_data = current.logo_data;
                saved.logo_filename = current.logo_filename;
            }
            presets[name] = saved;
            if (!await writePresets(presets)) return;
        }
        dialog._presetDirtySections.delete(section);
        updatePresetDirtyStatus();
        presetStatus.textContent = name
            ? `Đã lưu ${label} vào preset: ${name}`
            : `Đã lưu ${label} cho job hiện tại.`;
    };
    dialog.querySelector('#saveSubSelection').onclick = () => saveSection('sub', 'vùng mờ sub');
    dialog.querySelector('#saveCustomSelection').onclick = () => saveSection('custom', 'vùng mờ tùy chỉnh');
    dialog.querySelector('#saveLogoSelection').onclick = () => saveSection('logo', 'logo');
    dialog.querySelector('#processLogoFile').onchange = async event => {
        const file = event.target.files?.[0];
        if (!file) {
            dialog._logoData = null;
            dialog._logoFilename = null;
            return;
        }
        const logoData = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        });
        if (!isCurrent()) return;
        dialog._logoData = logoData;
        dialog._logoFilename = file.name;
    };

    const aiPrompt = dialog.querySelector('#processAiPrompt');
    const aiImage = dialog.querySelector('#processAiImage');
    const aiImageName = dialog.querySelector('#processAiImageName');
    const aiResult = dialog.querySelector('#processAiResult');
    const aiAnswer = dialog.querySelector('#processAiAnswer');
    const aiSettings = dialog.querySelector('#processAiSettings');
    const aiApply = dialog.querySelector('#processAiApply');
    const aiGenerate = dialog.querySelector('#processAiGenerate');
    aiGenerate.disabled = false;
    aiGenerate.textContent = 'Gợi ý cấu hình';
    dialog._assistantRequestSeq = (dialog._assistantRequestSeq || 0) + 1;
    let aiImageData = null;
    let aiSuggestion = null;
    aiPrompt.value = '';
    aiImage.value = '';
    aiImageName.textContent = '';
    aiResult.hidden = true;
    aiApply.hidden = true;
    aiImage.onchange = async () => {
        const file = aiImage.files?.[0];
        if (!file) return;
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024) {
            aiImage.value = '';
            aiImageName.textContent = 'Chọn ảnh PNG, JPEG hoặc WebP dưới 4 MB.';
            return;
        }
        aiImageData = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Không đọc được ảnh.'));
            reader.readAsDataURL(file);
        }).catch(() => null);
        if (!isCurrent()) return;
        aiImageName.textContent = aiImageData ? file.name : 'Không đọc được ảnh.';
    };
    dialog.querySelector('#processAiFrame').onclick = () => {
        if (!preview.videoWidth) {
            aiImageName.textContent = 'Tải video để chụp khung hình.';
            return;
        }
        try {
            const frame = document.createElement('canvas');
            const scale = Math.min(1, 1280 / preview.videoWidth);
            frame.width = Math.round(preview.videoWidth * scale);
            frame.height = Math.round(preview.videoHeight * scale);
            frame.getContext('2d').drawImage(preview, 0, 0, frame.width, frame.height);
            aiImageData = frame.toDataURL('image/jpeg', 0.82);
            aiImage.value = '';
            aiImageName.textContent = 'Khung hình hiện tại';
        } catch {
            aiImageName.textContent = 'Không chụp được khung hình; hãy đính kèm ảnh từ máy.';
        }
    };
    aiGenerate.onclick = async () => {
        const message = aiPrompt.value.trim();
        if (!message) { aiPrompt.focus(); return; }
        const requestSeq = dialog._assistantRequestSeq;
        aiGenerate.disabled = true;
        aiGenerate.textContent = 'Đang hỏi Gemini…';
        aiResult.hidden = false;
        aiAnswer.textContent = 'Đang phân tích yêu cầu…';
        aiSettings.replaceChildren();
        aiApply.hidden = true;
        aiSuggestion = null;
        try {
            const response = await requestJson('/api/assistant', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message, kind: 'config', mode, image_data: aiImageData,
                    video_context: {
                        title: video.title || video.video_id,
                        duration_seconds: Number(video.duration_seconds || video.duration || preview.duration || 0),
                        width: preview.videoWidth || sourceWidth,
                        height: preview.videoHeight || sourceHeight,
                    },
                }),
                timeoutMs: 70000,
            });
            if (!isCurrent() || dialog._assistantRequestSeq !== requestSeq) return;
            aiAnswer.textContent = response.answer || 'Gemini chưa có gợi ý.';
            aiSuggestion = response.settings || {};
            const labels = {
                aspect_ratio: 'Tỷ lệ đầu ra', blur_preset: 'Vị trí phụ đề cũ',
                source_subtitle_mode: 'Phụ đề nguồn', original_volume: 'Âm lượng gốc',
                voice_volume: 'Âm lượng Voice', tts_speed: 'Tốc độ Voice',
                voice: 'Giọng đọc', auto_brand_blur: 'Làm mờ watermark',
            };
            Object.entries(aiSuggestion).forEach(([key, value]) => {
                if (!labels[key]) return;
                const item = document.createElement('li');
                item.textContent = `${labels[key]}: ${typeof value === 'boolean' ? value ? 'Bật' : 'Tắt' : value}`;
                aiSettings.appendChild(item);
            });
            aiApply.hidden = !aiSettings.childElementCount;
        } catch (error) {
            if (!isCurrent() || dialog._assistantRequestSeq !== requestSeq) return;
            aiAnswer.textContent = error?.status === 404
                ? 'Local Engine hiện tại chưa có Trợ lý AI. Hãy cập nhật ứng dụng trên máy.'
                : (error?.message || 'Chưa thể hỏi Gemini. Kiểm tra kết nối trong Cài đặt.');
        } finally {
            if (isCurrent() && dialog._assistantRequestSeq === requestSeq) {
                aiGenerate.disabled = false;
                aiGenerate.textContent = 'Gợi ý cấu hình';
            }
        }
    };
    aiApply.onclick = () => {
        if (!aiSuggestion) return;
        const fields = {
            aspect_ratio: 'processAspectRatio', blur_preset: 'processBlurPreset',
            original_volume: 'processOriginalVolume', voice_volume: 'processVoiceVolume',
            tts_speed: 'processTtsSpeed', voice: 'processVoice',
        };
        Object.entries(fields).forEach(([key, id]) => {
            if (aiSuggestion[key] === undefined) return;
            set(id, aiSuggestion[key]);
            dialog.querySelector(`#${id}`)?.dispatchEvent(new Event('change', { bubbles: true }));
        });
        if (aiSuggestion.source_subtitle_mode) {
            const noSub = dialog.querySelector('#processSourceNoSub');
            noSub.checked = aiSuggestion.source_subtitle_mode === 'none';
            noSub.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (typeof aiSuggestion.auto_brand_blur === 'boolean') {
            const brand = dialog.querySelector('#processAutoBrandBlur');
            brand.checked = aiSuggestion.auto_brand_blur;
            brand.dispatchEvent(new Event('change', { bubbles: true }));
        }
        aiAnswer.textContent += ' Đã áp dụng vào form; hãy kiểm tra lại trước khi xử lý.';
        aiApply.hidden = true;
    };

    let submitting = false;
    dialog.querySelector('form').onsubmit = async event => {
        event.preventDefault();
        if (submitting || !isCurrent()) return;
        submitting = true;
        const submitButton = dialog.querySelector('#runProcessConfig');
        submitButton.disabled = true;
        configForm.setAttribute('aria-busy', 'true');
        try {
        const selectedPreset = presetSelect.value;
        if (selectedPreset && dialog._presetDirtySections.size) {
            inspector.select('presets');
            const sections = [...dialog._presetDirtySections].join(', ');
            presetStatus.textContent = `Chưa lưu: ${sections}. Hãy lưu lựa chọn trước khi xuất.`;
            alert(`Preset "${selectedPreset}" còn thay đổi chưa lưu (${sections}). Hãy bấm nút Lưu tương ứng hoặc Lưu và áp dụng trước khi xuất.`);
            return;
        }
        const value = id => dialog.querySelector(`#${id}`)?.value || '';
        const blur = {};
        [['x', 'X'], ['y', 'Y'], ['width', 'Width'], ['height', 'Height']].forEach(([key, suffix]) => {
            if (value(`processBlur${suffix}`) !== '') blur[key] = Number(value(`processBlur${suffix}`));
        });
        const blur_intervals = [...dialog.querySelectorAll('.blur-interval-row')]
            .map(row => ({
                start: Number(row.querySelector('.blur-start').value),
                end: Number(row.querySelector('.blur-end').value),
                x: Number(value('processCustomBlurX') || 0),
                y: Number(value('processCustomBlurY') || 0),
                width: Number(value('processCustomBlurWidth') || 0),
                height: Number(value('processCustomBlurHeight') || 0),
            }))
            .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start);
        const logoFile = dialog.querySelector('#processLogoFile')?.files?.[0];
        let logoData = dialog._logoData || null;
        if (logoFile) {
            logoData = await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(logoFile);
            });
            if (!isCurrent()) return;
            dialog._logoData = logoData;
            dialog._logoFilename = logoFile.name;
        }
        const musicUrl = value('processMusicUrl').trim();
        if (musicUrl && !/^https?:\/\/\S+$/i.test(musicUrl)) {
            musicUrlInput?.setCustomValidity('Link nhạc phải bắt đầu bằng http:// hoặc https://.');
            musicUrlInput?.reportValidity();
            return;
        }
        const musicFile = dialog.querySelector('#processMusicFile')?.files?.[0];
        let musicData = null;
        if (musicFile) {
            musicData = await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(musicFile);
            });
        }
        const config = {
            preview_seconds: value('processPreviewSeconds') ? Number(value('processPreviewSeconds')) : null,
            subtitle_font_size: value('processFontSize') ? Number(value('processFontSize')) : null,
            source_language: value('processSourceLanguage') || 'auto',
            transcript_source: value('processTranscriptSource') || 'audio',
            ocr_language: value('processOcrLanguage') || 'auto',
            ocr_fps: Number(value('processOcrFps') || 2),
            ocr_min_confidence: Number(value('processOcrConfidence') || 0.45),
            ocr_parallelism: Number(value('processOcrParallelism') || 2),
            ocr_use_gpu: !!dialog.querySelector('#processOcrUseGpu')?.checked,
            ocr_merge_similar: !!dialog.querySelector('#processOcrMergeSimilar')?.checked,
            ocr_similarity_threshold: Number(value('processOcrSimilarity') || 0.82),
            subtitle_style: value('processSubtitleStyle') || 'minimal',
            original_volume: Number(value('processOriginalVolume') || 0.15),
            voice_volume: Number(value('processVoiceVolume') || 1),
            tts_speed: Number(value('processTtsSpeed') || 1.10),
            voice: value('processVoice'),
            music_url: musicUrl || null,
            music_data: musicData,
            music_filename: musicFile?.name || null,
            music_volume: (() => {
                const selected = Number(value('processMusicVolume'));
                return Number.isFinite(selected) ? Math.min(2, Math.max(0, selected)) : 0.25;
            })(),
            auto_brand_blur: !!dialog.querySelector('#processAutoBrandBlur')?.checked,
            source_subtitle_mode: dialog.querySelector('#processSourceNoSub')?.checked ? 'none' : 'auto',
            aspect_ratio: value('processAspectRatio') || null,
            blur_preset: value('processBlurPreset') || null,
            logo_size: value('processLogoSize') ? Number(value('processLogoSize')) : null,
            logo_x: value('processLogoX') ? Number(value('processLogoX')) : null,
            logo_y: value('processLogoY') ? Number(value('processLogoY')) : null,
            blur_region: Object.keys(blur).length ? blur : null,
            custom_blur_region: ['x', 'y', 'width', 'height'].every(key => value(`processCustomBlur${key[0].toUpperCase()}${key.slice(1)}`) !== '')
                ? {
                    x: Number(value('processCustomBlurX')),
                    y: Number(value('processCustomBlurY')),
                    width: Number(value('processCustomBlurWidth')),
                    height: Number(value('processCustomBlurHeight')),
                }
                : null,
            blur_intervals,
            logo_mode: value('processLogoMode') || 'none',
            logo_path: value('processLogoPath') || null,
            logo_text: value('processLogoText') || null,
            logo_data: logoData,
            logo_filename: logoFile?.name || dialog._logoFilename || null,
        };
        if (!isCurrent()) return;
        dialog.close();
        processVideo(video, card, mode, config);
        } finally {
            submitting = false;
            submitButton.disabled = false;
            configForm.removeAttribute('aria-busy');
        }
    };
    outputSummary.refresh();
    dialog.showModal();
    resetScrollPositions();
}
