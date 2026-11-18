// Loaded only when the user opens video processing settings.
import { bindProcessInspectorTabs } from './process-inspector-tabs.js';
import { bindProcessOutputSummary } from './process-output-summary.js';
import { defaultVoiceForLanguage, isVoiceCompatibleWithLanguage, playVoicePreview, renderVoiceOptionsHtml } from '../lib/tts-voices.js';
import { getSubtitlePreviewData, sampleLinesForLanguage } from '../lib/subtitle-style-previews.js';
import {
    analyzeVideoCopyrightRisk,
    checkVideoCopyrightWithEngine,
    copyrightIconSvg,
    readCopyrightFingerprintConfig,
} from '../lib/copyright-checker.js';
import {
    clearLastConfig,
    mergeSectionIntoConfig,
    readActivePresetPref,
    readLastConfigLocal,
    readPresetsLocal,
    syncLastConfigFromEngine,
    syncPresetsFromEngine,
    writeActivePresetPref,
    writeLastConfig,
    writePresets,
} from '../lib/process-config-store.js';

let logoSessionEnabled = false;

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
    const requestJson = (path, options = {}) => {
        const effectiveSignal = options.signal ? AbortSignal.any([signal, options.signal]) : signal;
        return window.reupEngineClient.json(path, { ...options, signal: effectiveSignal });
    };
    const defaults = processConfigDefaults();
    dialog._presetDirtySections = new Set();
    dialog.dataset.presetApplying = '1';
    dialog._logoData = null;
    dialog._logoFilename = null;
    let transcriptConfirmed = false;
    let submitting = false;
    let reviewPaused = false;
    let translationReady = false;
    let autoContinueScheduled = false;
    let skipReviewRequested = false;
    let previewAbortController = null;
    let statusTimer = null;
    let lastConfigSaveTimer = null;
    let hasUserEditedSinceOpen = false;
    signal.addEventListener('abort', () => clearTimeout(lastConfigSaveTimer), { once: true });
    const set = (id, value) => {
        const element = dialog.querySelector(`#${id}`);
        if (element && value !== undefined && value !== null) element.value = value;
        element?.dispatchEvent(new Event('input'));
    };
    const isPresetMetaControl = target => {
        const id = target?.id || '';
        return id === 'processPresetSelect' || id === 'processPresetName' || id === 'processAutoRememberConfig';
    };
    const sectionForTarget = target => {
        const id = target?.id || '';
        if (id.startsWith('processOcr') || id === 'processTranscriptSource' || id === 'processSourceLanguage') return 'sub';
        if (id.startsWith('processBlur') || id === 'processBlurPreset' || id === 'processSourceNoSub' || id === 'processAutoBrandBlur') return 'sub';
        if (id.startsWith('processCustomBlur') || target?.classList?.contains('blur-start') || target?.classList?.contains('blur-end')) return 'custom';
        if (id.startsWith('processLogo') || id === 'processLogoFile') return 'logo';
        return 'general';
    };
    const updatePresetDirtyStatus = () => {
        const dirty = [...dialog._presetDirtySections];
        const name = dialog.querySelector('#processPresetSelect')?.value || '';
        const status = dialog.querySelector('#processPresetStatus');
        const updateBtn = dialog.querySelector('#updateProcessPreset');
        if (updateBtn) {
            updateBtn.hidden = !name;
            updateBtn.textContent = name ? `Cập nhật “${name}”` : 'Cập nhật preset đang chọn';
        }
        if (!status) return;
        if (!name) {
            const rememberOn = dialog.querySelector('#processAutoRememberConfig')?.checked !== false;
            status.textContent = rememberOn
                ? 'Tự động lưu thao tác cấu hình gần nhất cho lần mở video sau.'
                : 'Đang dùng cấu hình của riêng video hiện tại.';
            return;
        }
        if (!dirty.length) {
            status.textContent = `Đang dùng preset: ${name}`;
            return;
        }
        status.textContent = `Đã chỉnh sửa từ preset “${name}” — bấm Cập nhật để lưu vào preset, hoặc bấm Xuất ngay cho video này.`;
    };
    dialog._presetMarkDirty = target => {
        if (dialog.dataset.presetApplying === '1' || isPresetMetaControl(target)) return;
        hasUserEditedSinceOpen = true;
        dialog._presetDirtySections.add(sectionForTarget(target));
        updatePresetDirtyStatus();
        dialog._scheduleSaveLastConfig?.();
    };
    const configForm = dialog.querySelector('form');
    const inspector = bindProcessInspectorTabs(dialog, { window, signal });
    // Manual OCR settings are opt-in for every new video, even after editing
    // the previous video's OCR panel.
    inspector.select('video');
    const outputSummary = bindProcessOutputSummary(dialog, { mode, signal });
    if (!dialog.dataset.presetDirtyBound) {
        configForm.addEventListener('input', event => dialog._presetMarkDirty?.(event.target), true);
        configForm.addEventListener('change', event => dialog._presetMarkDirty?.(event.target), true);
        dialog.dataset.presetDirtyBound = '1';
    }
    dialog.dataset.mode = mode;
    dialog.dataset.videoId = video.video_id;
    dialog.dataset.cardId = card.dataset.videoId || '';
    let manualOcrRows = [];
    let secondarySubRows = [];
    let recognitionComplete = false;
    let translatingReview = false;
    const deletedTranscriptIds = new Set();
    let transcriptSignature = '';
    const reviewDialog = document.getElementById('processTranscriptReviewDialog');
    const reviewPreview = reviewDialog?.querySelector('#processTranscriptReviewPreview');

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
    set('processTargetLanguage', defaults.target_language || 'vi');
    set('processTranslationModel', defaults.translation_model || 'gemini-3.1-flash-lite');
    const modelPicker = dialog.querySelector('#processTranslationModel');
    if (modelPicker) {
        modelPicker.disabled = !window.reupEngineClient.health?.capabilities?.translation_model_selection;
        modelPicker.title = modelPicker.disabled ? 'Cập nhật Engine 0.2.54 để chọn model dịch.' : '';
    }
    set('processTranscriptSource', defaults.transcript_source || 'audio');
    set('processOutputFormat', defaults.output_format || 'video');
    set('processOcrLanguage', defaults.ocr_language || 'auto');
    set('processOcrFps', defaults.ocr_fps ?? 2);
    set('processOcrConfidence', defaults.ocr_min_confidence ?? 0.45);
    set('processOcrParallelism', defaults.ocr_parallelism ?? (defaults.boost_gpu ? 4 : 2));
    set('processOcrSimilarity', defaults.ocr_similarity_threshold ?? 0.82);
    dialog.querySelector('#processOcrUseGpu').checked = defaults.ocr_use_gpu === true || defaults.boost_gpu === true;
    const modalBoostGpu = dialog.querySelector('#processBoostGpu');
    if (modalBoostGpu) {
        const barBoost = document.getElementById('boostGpuToggle');
        modalBoostGpu.checked = Boolean(barBoost ? barBoost.checked : defaults.boost_gpu);
        modalBoostGpu.onchange = () => {
            const enabled = Boolean(modalBoostGpu.checked);
            if (barBoost) barBoost.checked = enabled;
            try {
                localStorage.setItem('reupai:boost-gpu', enabled ? '1' : '0');
            } catch {
                // ignore storage errors
            }
            const ocrGpu = dialog.querySelector('#processOcrUseGpu');
            if (ocrGpu) ocrGpu.checked = enabled;
            set('processOcrParallelism', enabled ? 4 : 2);
        };
    }
    dialog.querySelector('#processOcrMergeSimilar').checked = defaults.ocr_merge_similar !== false;
    const transcriptSource = dialog.querySelector('#processTranscriptSource');
    const ocrOptions = dialog.querySelector('#processOcrOptions');
    const ocrMergeSimilar = dialog.querySelector('#processOcrMergeSimilar');
    const ocrSimilarityField = dialog.querySelector('#processOcrSimilarityField');
    const ocrNote = dialog.querySelector('#processOcrNote');
    const syncOcrOptions = () => {
        const enabled = transcriptSource?.value === 'video_subtitles';
        if (ocrOptions) ocrOptions.hidden = !enabled;
        const pickButton = dialog.querySelector('#processOcrPickRegion');
        const scanButton = dialog.querySelector('#processOcrScan');
        if (pickButton) pickButton.hidden = !enabled;
        if (scanButton) scanButton.textContent = enabled ? 'Quét chữ trên hình' : 'Quét lời thoại';
        if (ocrSimilarityField) ocrSimilarityField.hidden = !ocrMergeSimilar?.checked;
        if (ocrNote) {
            const fps = Number(dialog.querySelector('#processOcrFps')?.value || 2);
            ocrNote.textContent = `OCR quét ${fps.toLocaleString('vi-VN')} khung hình/giây. Chế độ lời thoại dùng Whisper nhận diện audio, không cần chọn vùng video.`;
        }
    };
    transcriptSource.onchange = syncOcrOptions;
    ocrMergeSimilar.onchange = syncOcrOptions;
    dialog.querySelector('#processOcrFps').oninput = syncOcrOptions;
    syncOcrOptions();
    const outputFormat = dialog.querySelector('#processOutputFormat');
    const syncOutputLabel = () => {
        const button = dialog.querySelector('#runProcessConfig');
        const hasTranscript = manualOcrRows.some(Boolean);
        if (button) button.textContent = hasTranscript
            ? (outputFormat?.value === 'srt' ? 'Dịch & xuất SRT' : 'Tiếp tục dịch & xử lý')
            : (outputFormat?.value === 'srt' ? 'Xuất file SRT' : 'Bắt đầu xử lý');
    };
    if (outputFormat) outputFormat.onchange = syncOutputLabel;
    syncOutputLabel();
    set('processSubtitleStyle', defaults.subtitle_style || 'minimal');
    const bindSubtitleStylePreview = () => {
        const cardRoot = dialog.querySelector('#processSubtitleStylePreview');
        const showcaseBar = dialog.querySelector('#processShowcaseSubBar');
        const showcaseChipsRoot = dialog.querySelector('#processShowcaseStyleChips');
        const showcaseSecChipsRoot = dialog.querySelector('#processShowcaseSecStyleChips');
        const showcaseSampleRoot = dialog.querySelector('#processShowcaseSampleChips');
        const toggleStageBtn = dialog.querySelector('#processToggleStageSubBtn');
        const toggleSecStageBtn = dialog.querySelector('#processToggleStageSecSubBtn');
        const togglePickerBtn = dialog.querySelector('#toggleProcessPicker');
        const styleSelect = dialog.querySelector('#processSubtitleStyle');
        const secStyleSelect = dialog.querySelector('#processSecondarySubStyle');
        const secFontSizeSelect = dialog.querySelector('#processSecondarySubFontSize');
        const targetLangSelect = dialog.querySelector('#processTargetLanguage');
        const fontSizeSelect = dialog.querySelector('#processFontSize');
        const titleEl = dialog.querySelector('#processSubPreviewTitle');
        const descEl = dialog.querySelector('#processSubPreviewDesc');
        const stageEl = dialog.querySelector('#processSubPreviewStage');
        const textEl = dialog.querySelector('#processSubPreviewText');
        const stageOverlay = dialog.querySelector('#processStageSubtitlePreview');
        const stageOverlayText = dialog.querySelector('#processStageSubtitleText');
        const stageSecOverlay = dialog.querySelector('#processStageSecSubPreview');
        const stageSecOverlayText = dialog.querySelector('#processStageSecSubText');
        const chipsRoot = dialog.querySelector('#processSubStyleChips');
        const sampleListRoot = dialog.querySelector('#processSubSampleList');
        const subPanel = dialog.querySelector('#processInspectorSubtitles');
        if (!styleSelect) return;

        let activeSample = 0;
        let previewHovering = false;
        let showOnVideoStage = false;
        let showSecOnVideoStage = false;
        let renderedSampleLang = null;

        const rebuildSampleButtons = lines => {
            if (sampleListRoot) {
                sampleListRoot.innerHTML = '';
                lines.forEach((line, index) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'process-sub-sample-item';
                    btn.dataset.subSample = String(index);
                    const badge = document.createElement('b');
                    badge.textContent = `Câu ${index + 1}`;
                    const copy = document.createElement('span');
                    copy.textContent = line;
                    btn.appendChild(badge);
                    btn.appendChild(copy);
                    btn.onclick = () => {
                        activeSample = index;
                        showOnVideoStage = true;
                        renderSubtitlePreview();
                    };
                    sampleListRoot.appendChild(btn);
                });
            }

            if (showcaseSampleRoot) {
                showcaseSampleRoot.innerHTML = '';
                lines.forEach((line, index) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.dataset.subSample = String(index);
                    btn.textContent = `Câu ${index + 1}`;
                    btn.title = line;
                    btn.onclick = () => {
                        activeSample = index;
                        showOnVideoStage = true;
                        renderSubtitlePreview();
                    };
                    showcaseSampleRoot.appendChild(btn);
                });
            }
        };

        const syncChipContainer = (root, selectedStyle) => {
            root?.querySelectorAll('[data-sub-style]').forEach(btn => {
                const selected = btn.dataset.subStyle === selectedStyle;
                btn.classList.toggle('is-active', selected);
                btn.setAttribute('aria-pressed', String(selected));
            });
        };

        const bindChipClicks = root => {
            root?.querySelectorAll('[data-sub-style]').forEach(btn => {
                btn.onclick = () => {
                    const nextStyle = btn.dataset.subStyle || 'minimal';
                    showOnVideoStage = true;
                    if (styleSelect.value !== nextStyle) {
                        styleSelect.value = nextStyle;
                        styleSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    renderSubtitlePreview();
                };
            });
        };

        const renderSubtitlePreview = () => {
            if (signal.aborted) return;
            const targetLang = targetLangSelect?.value || 'vi';
            const isSrtOnly = outputFormat?.value === 'srt';
            const isPicking = togglePickerBtn?.getAttribute('aria-pressed') === 'true';
            const { spec, lines, sampleIndex, sampleText, previewFontPx, stageFontPx } = getSubtitlePreviewData(
                styleSelect.value,
                fontSizeSelect?.value,
                activeSample,
                targetLang,
            );
            if (renderedSampleLang !== targetLang) {
                renderedSampleLang = targetLang;
                rebuildSampleButtons(lines);
            }

            if (titleEl) titleEl.textContent = spec.label;
            if (descEl) descEl.textContent = spec.description;
            if (stageEl && textEl) {
                stageEl.dataset.style = spec.id;
                textEl.textContent = sampleText;
                textEl.style.fontSize = `${previewFontPx}px`;
            }

            syncChipContainer(chipsRoot, spec.id);
            syncChipContainer(showcaseChipsRoot, spec.id);

            [sampleListRoot, showcaseSampleRoot].forEach(root => {
                root?.querySelectorAll('[data-sub-sample]').forEach(btn => {
                    const selected = Number(btn.dataset.subSample) === sampleIndex;
                    btn.classList.toggle('is-active', selected);
                    btn.setAttribute('aria-selected', String(selected));
                });
            });

            if (showcaseBar) {
                showcaseBar.hidden = isSrtOnly;
            }
            if (showcaseSampleRoot) {
                showcaseSampleRoot.hidden = !showOnVideoStage;
            }
            if (toggleStageBtn) {
                toggleStageBtn.setAttribute('aria-pressed', String(showOnVideoStage));
                toggleStageBtn.textContent = showOnVideoStage ? 'Đang bật trên video · Bấm để ẩn' : 'Xem sub trên video';
            }

            if (stageOverlay && stageOverlayText) {
                const showNow = showOnVideoStage && !isSrtOnly && !isPicking;
                stageOverlay.hidden = !showNow;
                stageOverlay.dataset.style = spec.id;
                stageOverlayText.textContent = sampleText;
                stageOverlayText.style.fontSize = `${stageFontPx}px`;
            }

            if (secStyleSelect) {
                const secStyle = secStyleSelect.value || 'box';
                showcaseSecChipsRoot?.querySelectorAll('[data-sec-sub-style]').forEach(btn => {
                    const selected = btn.dataset.secSubStyle === secStyle;
                    btn.classList.toggle('is-active', selected);
                    btn.setAttribute('aria-pressed', String(selected));
                });
                if (toggleSecStageBtn) {
                    toggleSecStageBtn.setAttribute('aria-pressed', String(showSecOnVideoStage));
                    toggleSecStageBtn.textContent = showSecOnVideoStage ? 'Đang bật chữ phụ · Bấm để ẩn' : 'Xem chữ phụ trên video';
                }
                if (stageSecOverlay && stageSecOverlayText) {
                    const secData = getSubtitlePreviewData(
                        secStyle,
                        secFontSizeSelect?.value,
                        0,
                        targetLang,
                    );
                    const showSecNow = showSecOnVideoStage && !isSrtOnly && !isPicking;
                    stageSecOverlay.hidden = !showSecNow;
                    stageSecOverlay.dataset.style = secData.spec.id;
                    stageSecOverlayText.textContent = targetLang === 'en'
                        ? 'Floating Note (No Voice)'
                        : 'Chữ phụ / Chú thích (Không Voice)';
                    stageSecOverlayText.style.fontSize = `${Math.max(12, Math.round(secData.stageFontPx * 0.88))}px`;
                }
            }
        };

        bindChipClicks(chipsRoot);
        bindChipClicks(showcaseChipsRoot);

        showcaseSecChipsRoot?.querySelectorAll('[data-sec-sub-style]').forEach(btn => {
            btn.onclick = () => {
                const nextSecStyle = btn.dataset.secSubStyle || 'box';
                showSecOnVideoStage = true;
                if (secStyleSelect && secStyleSelect.value !== nextSecStyle) {
                    secStyleSelect.value = nextSecStyle;
                    secStyleSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
                renderSubtitlePreview();
            };
        });

        if (toggleStageBtn) {
            toggleStageBtn.onclick = () => {
                showOnVideoStage = !showOnVideoStage;
                renderSubtitlePreview();
            };
        }
        if (toggleSecStageBtn) {
            toggleSecStageBtn.onclick = () => {
                showSecOnVideoStage = !showSecOnVideoStage;
                renderSubtitlePreview();
            };
        }

        const onUserStyleChange = () => {
            if (dialog.dataset.presetApplying !== '1') {
                showOnVideoStage = true;
            }
            renderSubtitlePreview();
        };
        const onUserSecStyleChange = () => {
            if (dialog.dataset.presetApplying !== '1') {
                showSecOnVideoStage = true;
            }
            renderSubtitlePreview();
        };
        styleSelect.addEventListener('change', onUserStyleChange, { signal });
        styleSelect.addEventListener('input', renderSubtitlePreview, { signal });
        secStyleSelect?.addEventListener('change', onUserSecStyleChange, { signal });
        secFontSizeSelect?.addEventListener('change', onUserSecStyleChange, { signal });
        fontSizeSelect?.addEventListener('change', onUserStyleChange, { signal });
        fontSizeSelect?.addEventListener('input', renderSubtitlePreview, { signal });
        targetLangSelect?.addEventListener('change', renderSubtitlePreview, { signal });
        targetLangSelect?.addEventListener('input', renderSubtitlePreview, { signal });
        outputFormat?.addEventListener('change', renderSubtitlePreview, { signal });
        togglePickerBtn?.addEventListener('click', () => setTimeout(renderSubtitlePreview, 0), { signal });
        dialog.querySelectorAll('.process-inspector-tab').forEach(tab => {
            tab.addEventListener('click', () => setTimeout(renderSubtitlePreview, 0), { signal });
        });
        [cardRoot, showcaseBar].forEach(el => {
            el?.addEventListener('mouseenter', () => { previewHovering = true; }, { signal });
            el?.addEventListener('mouseleave', () => { previewHovering = false; }, { signal });
        });

        const cycleTimer = setInterval(() => {
            const subTabOpen = Boolean(subPanel && !subPanel.hidden);
            if (!isCurrent() || previewHovering || (!showOnVideoStage && !subTabOpen)) return;
            const totalSamples = sampleLinesForLanguage(targetLangSelect?.value || 'vi').length;
            activeSample = (activeSample + 1) % totalSamples;
            renderSubtitlePreview();
        }, 2600);
        signal.addEventListener('abort', () => clearInterval(cycleTimer), { once: true });

        dialog._renderSubtitleStylePreview = renderSubtitlePreview;
        renderSubtitlePreview();
    };
    bindSubtitleStylePreview();
    set('processOriginalVolume', defaults.original_volume ?? 0.15);
    set('processVoiceVolume', defaults.voice_volume ?? 1);
    set('processTtsSpeed', defaults.tts_speed ?? 1.00);
    set('processVoice', defaults.voice || 'Trúc Ly');
    const targetLangSelect = dialog.querySelector('#processTargetLanguage');
    const voiceSelect = dialog.querySelector('#processVoice');
    const summaryVoiceSelect = dialog.querySelector('#processSummaryVoice');
    const syncTargetLanguageVoices = (targetLang = 'vi', { preferredVoice = null } = {}) => {
        const lang = String(targetLang || 'vi').trim().toLowerCase() || 'vi';
        const optionsHtml = renderVoiceOptionsHtml(lang);
        const currentVoice = preferredVoice ?? voiceSelect?.value ?? '';
        const nextVoice = isVoiceCompatibleWithLanguage(currentVoice, lang)
            ? currentVoice
            : defaultVoiceForLanguage(lang);
        if (voiceSelect) {
            voiceSelect.innerHTML = optionsHtml;
            voiceSelect.value = nextVoice;
        }
        if (summaryVoiceSelect) {
            summaryVoiceSelect.innerHTML = optionsHtml;
            summaryVoiceSelect.value = nextVoice;
        }
        dialog._renderSubtitleStylePreview?.();
        outputSummary.refresh();
    };
    syncTargetLanguageVoices(targetLangSelect?.value || 'vi', { preferredVoice: defaults.voice || 'Trúc Ly' });
    targetLangSelect?.addEventListener('change', () => {
        syncTargetLanguageVoices(targetLangSelect.value);
    }, { signal });
    if (summaryVoiceSelect && voiceSelect) {
        summaryVoiceSelect.value = voiceSelect.value || 'Trúc Ly';
        summaryVoiceSelect.onchange = () => {
            voiceSelect.value = summaryVoiceSelect.value;
            voiceSelect.dispatchEvent(new Event('change', { bubbles: true }));
            if ((targetLangSelect?.value || 'vi') === 'vi') {
                try { localStorage.setItem('reupai:default-voice', voiceSelect.value || 'Trúc Ly'); } catch {}
            }
        };
        voiceSelect.addEventListener('change', () => {
            if (summaryVoiceSelect.value !== voiceSelect.value) {
                summaryVoiceSelect.value = voiceSelect.value;
            }
            if ((targetLangSelect?.value || 'vi') === 'vi') {
                try { localStorage.setItem('reupai:default-voice', voiceSelect.value || 'Trúc Ly'); } catch {}
            }
        });
    }
    const wizardBtn = dialog.querySelector('#processFlowWizardBtn');
    const quickBtn = dialog.querySelector('#processFlowQuickBtn');
    const wizardBar = dialog.querySelector('#processWizardBar');
    const wizardPrev = dialog.querySelector('#processWizardPrev');
    const wizardNext = dialog.querySelector('#processWizardNext');
    const runBtn = dialog.querySelector('#runProcessConfig');
    const wizardGuideTitle = dialog.querySelector('#processWizardGuideTitle');
    const wizardGuideText = dialog.querySelector('#processWizardGuideText');
    const wizardReview = dialog.querySelector('#processWizardReview');
    let flowMode = 'quick';
    try {
        flowMode = localStorage.getItem('reupai:process-flow-mode') === 'wizard' ? 'wizard' : 'quick';
    } catch {}
    let wizardStep = 1;

    const selectInspectorTab = (tabName) => {
        const tabBtn = dialog.querySelector(`.process-inspector-tab[data-inspector-tab="${tabName}"]`);
        tabBtn?.click();
    };

    const buildWizardReviewHtml = () => {
        const val = (id) => dialog.querySelector(`#${id}`)?.value ?? '';
        const blurCoords = ['processBlurX', 'processBlurY', 'processBlurWidth', 'processBlurHeight'].some((id) => val(id) !== '');
        const customCoords = ['processCustomBlurX', 'processCustomBlurY', 'processCustomBlurWidth', 'processCustomBlurHeight'].some((id) => val(id) !== '');
        const autoWatermark = dialog.querySelector('#processAutoBrandBlur')?.checked;
        const boostGpuOn = dialog.querySelector('#processBoostGpu')?.checked;
        const origPct = Math.round((Number(val('processOriginalVolume') || 0.15)) * 100);
        const voicePct = Math.round((Number(val('processVoiceVolume') || 1)) * 100);
        const musicPct = Math.round((Number(val('processMusicVolume') || 0.25)) * 100);
        const musicUrl = val('processMusicUrl').trim();
        const musicFile = dialog.querySelector('#processMusicFile')?.files?.[0]?.name || '';
        const blurText = [
            blurCoords ? 'Đã chọn vùng mờ phụ đề' : 'Mờ phụ đề: Tự động / mặc định',
            customCoords ? 'Có thêm vùng mờ phụ' : null,
            autoWatermark ? 'Làm mờ watermark tự động' : null,
        ].filter(Boolean).join(' · ');
        const rows = [
            [1, '1. Video nguồn', video.downloaded ? 'Đã tải sẵn trên máy' : 'Sẽ tự tải khi xuất'],
            [2, '2. Vùng mờ & Giọng', `${blurText} · Giọng ${val('processVoice') || 'Trúc Ly'} (${Number(val('processTtsSpeed') || 1).toFixed(2)}x)${boostGpuOn ? ' · Boost GPU' : ''}`],
            [3, '3. Âm lượng & Nhạc', `Gốc ${origPct}% · Voice ${voicePct}% · Nhạc nền ${musicFile || musicUrl ? `${musicPct}% (${musicFile || 'Link'})` : 'Không thêm'}`],
            [4, '4. Tỷ lệ & Phụ đề', `Tỷ lệ: ${val('processAspectRatio') || 'Giữ gốc'} · Phong cách: ${val('processSubtitleStyle') || 'minimal'}`],
        ];
        return `
            <div class="process-wizard-review-head"><strong>Kiểm tra lại các thay đổi trước khi xuất video</strong><span>Bấm vào từng bước để sửa lại nếu cần</span></div>
            <div class="process-wizard-review-grid">
                ${rows.map(([s, label, summary]) => `
                    <button type="button" class="process-wizard-review-item" data-jump-step="${s}">
                        <strong>${label}</strong>
                        <span>${summary}</span>
                    </button>
                `).join('')}
            </div>
        `;
    };

    const STEP_COPY = {
        1: ['Bước 1: Tải video nguồn', 'Bấm “Tải video để xem trước” nếu muốn xem khung hình gốc trên máy, hoặc bấm “Bước tiếp” để hệ thống tự tải khi xuất.'],
        2: ['Bước 2: Chọn vùng mờ & Giọng đọc AI', 'Bấm “AI dò vùng mờ” hoặc “Kéo chọn vùng” trên video, sau đó chọn Giọng đọc AI và bấm Nghe thử ngay bên phải.'],
        3: ['Bước 3: Âm lượng video & Nhạc nền', 'Điều chỉnh âm lượng tiếng gốc, âm lượng giọng đọc và gắn link/tệp nhạc nền nếu muốn ở bảng bên phải.'],
        4: ['Bước 4: Xem lại toàn bộ thay đổi trước khi xuất', 'Kiểm tra kỹ thông số bạn đã chỉnh ở Bước 1–3 dưới đây trước khi chuyển sang Bước 5 xuất video.'],
        5: ['Bước 5: Xuất video thành phẩm', 'Mọi thiết lập đã sẵn sàng. Bấm “Xuất video ngay” để ReupAI xử lý video của bạn!'],
    };

    const syncWizardUi = () => {
        const isWizard = flowMode === 'wizard';
        dialog.classList.toggle('is-wizard-mode', isWizard);
        if (wizardBtn) {
            wizardBtn.className = `btn ${isWizard ? 'primary' : 'secondary'}`;
            wizardBtn.setAttribute('aria-pressed', String(isWizard));
        }
        if (quickBtn) {
            quickBtn.className = `btn ${!isWizard ? 'primary' : 'secondary'}`;
            quickBtn.setAttribute('aria-pressed', String(!isWizard));
        }
        if (wizardBar) wizardBar.hidden = !isWizard;
        if (wizardPrev) wizardPrev.hidden = !isWizard || wizardStep <= 1;
        if (wizardNext) wizardNext.hidden = !isWizard || wizardStep >= 5;
        if (runBtn) {
            runBtn.hidden = isWizard && wizardStep < 5;
            if (isWizard && wizardStep === 5) {
                runBtn.textContent = outputFormat?.value === 'srt' ? 'Bước 5 · Xuất file SRT' : 'Bước 5 · Xuất video ngay';
            } else {
                const hasTranscript = manualOcrRows.some(Boolean);
                runBtn.textContent = hasTranscript
                    ? (outputFormat?.value === 'srt' ? 'Dịch & xuất SRT' : 'Tiếp tục dịch & xử lý')
                    : (outputFormat?.value === 'srt' ? 'Xuất file SRT' : 'Bắt đầu xử lý');
            }
        }
        if (!isWizard) return;

        dialog.querySelectorAll('.process-wizard-step').forEach((el) => {
            const s = Number(el.dataset.wizardStep);
            el.classList.toggle('is-active', s === wizardStep);
            el.classList.toggle('is-done', s < wizardStep);
        });
        const [title, desc] = STEP_COPY[wizardStep] || STEP_COPY[1];
        if (wizardGuideTitle) wizardGuideTitle.textContent = title;
        if (wizardGuideText) wizardGuideText.textContent = desc;
        if (wizardReview) {
            const showReview = wizardStep === 4 || wizardStep === 5;
            wizardReview.hidden = !showReview;
            if (showReview) {
                wizardReview.innerHTML = buildWizardReviewHtml();
                wizardReview.querySelectorAll('[data-jump-step]').forEach((btn) => {
                    btn.onclick = () => {
                        wizardStep = Number(btn.dataset.jumpStep) || 1;
                        applyWizardStepFocus();
                        syncWizardUi();
                    };
                });
            }
        }
    };

    const applyWizardStepFocus = () => {
        if (flowMode !== 'wizard') return;
        if (wizardStep === 1) {
            selectInspectorTab('video');
        } else if (wizardStep === 2) {
            selectInspectorTab('audio');
        } else if (wizardStep === 3) {
            selectInspectorTab('audio');
            const adv = dialog.querySelector('.process-disclosure:not(.process-ai-disclosure)');
            if (adv) adv.open = true;
        } else if (wizardStep === 4 || wizardStep === 5) {
            selectInspectorTab('video');
        }
    };

    if (wizardBtn) {
        wizardBtn.onclick = () => {
            flowMode = 'wizard';
            wizardStep = 1;
            try { localStorage.setItem('reupai:process-flow-mode', 'wizard'); } catch {}
            applyWizardStepFocus();
            syncWizardUi();
        };
    }
    if (quickBtn) {
        quickBtn.onclick = () => {
            flowMode = 'quick';
            try { localStorage.setItem('reupai:process-flow-mode', 'quick'); } catch {}
            syncWizardUi();
        };
    }

    const bindProcessOnboardingTour = () => {
        const guide = dialog.querySelector('#processTourGuide');
        const toggleBtn = dialog.querySelector('#processTourToggleBtn');
        const autoBtn = dialog.querySelector('#processTourAutoBtn');
        const doneBtn = dialog.querySelector('#processTourDoneBtn');
        if (!guide) return;
        const TOUR_KEY = 'reupai:process-tour-done';
        let spotlightTimer = null;
        const readTourDone = () => {
            try {
                if (typeof window !== 'undefined' && window.localStorage?.getItem(TOUR_KEY) === '1') return true;
            } catch {}
            try {
                return localStorage.getItem(TOUR_KEY) === '1';
            } catch {}
            return false;
        };
        const markTourDone = () => {
            try { localStorage.setItem(TOUR_KEY, '1'); } catch {}
            try {
                if (typeof window !== 'undefined') window.localStorage?.setItem(TOUR_KEY, '1');
            } catch {}
        };

        const clearSpotlight = () => {
            if (spotlightTimer) {
                clearTimeout(spotlightTimer);
                spotlightTimer = null;
            }
            dialog.querySelectorAll('.reupai-tour-spotlight').forEach((el) => {
                el.classList.remove('reupai-tour-spotlight');
            });
        };

        const setTourOpen = (open, persistDone = false) => {
            guide.hidden = !open;
            dialog.classList.toggle('tour-active', open);
            if (toggleBtn) {
                toggleBtn.classList.toggle('active', open);
                toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            }
            if (!open) clearSpotlight();
            if (persistDone) markTourDone();
        };

        if (toggleBtn) {
            toggleBtn.onclick = () => {
                const nextOpen = guide.hidden;
                setTourOpen(nextOpen, true);
            };
        }
        if (doneBtn) {
            doneBtn.onclick = () => setTourOpen(false, true);
        }
        const tourForm = dialog.querySelector('form');
        if (tourForm) {
            tourForm.addEventListener('submit', markTourDone, { once: true });
        }
        dialog.addEventListener('close', markTourDone, { once: true });
        if (autoBtn) {
            autoBtn.onclick = () => {
                const autoBrand = dialog.querySelector('#processAutoBrandBlur');
                if (autoBrand) {
                    autoBrand.checked = true;
                    autoBrand.dispatchEvent(new Event('change', { bubbles: true }));
                }
                const boostGpu = dialog.querySelector('#processBoostGpu');
                if (boostGpu) {
                    boostGpu.checked = true;
                    boostGpu.dispatchEvent(new Event('change', { bubbles: true }));
                }
                set('processPreviewSeconds', '');
                set('processAspectRatio', '');
                set('processOriginalVolume', 0.15);
                set('processVoiceVolume', 1);
                set('processTtsSpeed', 1);
                set('processVoice', 'Trúc Ly');
                if (summaryVoiceSelect) summaryVoiceSelect.value = 'Trúc Ly';
                flowMode = 'quick';
                try {
                    localStorage.setItem('reupai:process-flow-mode', 'quick');
                    localStorage.setItem(TOUR_KEY, '1');
                } catch {}
                syncWizardUi();
                setTourOpen(false, true);
                const statusEl = dialog.querySelector('#processAutoBlurStatus');
                if (statusEl) {
                    statusEl.textContent = 'AI đã tự cài đặt tối ưu: Giọng Trúc Ly · Tự làm mờ watermark · Boost GPU · Xử lý nhanh. Bạn chỉ cần bấm Bắt đầu xử lý!';
                }
            };
        }

        guide.querySelectorAll('.process-tour-step[data-tour-target]').forEach((stepBtn) => {
            stepBtn.onclick = () => {
                clearSpotlight();
                guide.querySelectorAll('.process-tour-step.is-active').forEach((b) => b.classList.remove('is-active'));
                stepBtn.classList.add('is-active');
                if (stepBtn.dataset.tourTab) {
                    selectInspectorTab(stepBtn.dataset.tourTab);
                }
                const selectors = (stepBtn.dataset.tourTarget || '').split(',').map((s) => s.trim()).filter(Boolean);
                let firstTarget = null;
                selectors.forEach((sel) => {
                    const matched = dialog.querySelector(sel);
                    if (matched) {
                        matched.classList.add('reupai-tour-spotlight');
                        if (!firstTarget) firstTarget = matched;
                    }
                });
                if (firstTarget) {
                    firstTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    if (typeof firstTarget.focus === 'function' && (firstTarget.tagName === 'INPUT' || firstTarget.tagName === 'SELECT' || firstTarget.tagName === 'BUTTON')) {
                        firstTarget.focus({ preventScroll: true });
                    }
                }
                spotlightTimer = setTimeout(clearSpotlight, 2600);
            };
        });

        const isDone = readTourDone();
        // Auto-open only on the user's very first visit, and mark it seen right away
        // so closing via Esc/Cancel or submitting never causes it to keep popping up.
        setTourOpen(!isDone, !isDone);
    };
    bindProcessOnboardingTour();
    if (wizardPrev) {
        wizardPrev.onclick = () => {
            wizardStep = Math.max(1, wizardStep - 1);
            applyWizardStepFocus();
            syncWizardUi();
        };
    }
    if (wizardNext) {
        wizardNext.onclick = () => {
            wizardStep = Math.min(5, wizardStep + 1);
            applyWizardStepFocus();
            syncWizardUi();
        };
    }
    dialog.querySelectorAll('.process-wizard-step').forEach((btn) => {
        btn.onclick = () => {
            wizardStep = Number(btn.dataset.wizardStep) || 1;
            applyWizardStepFocus();
            syncWizardUi();
        };
    });
    applyWizardStepFocus();
    syncWizardUi();

    const bindVoicePreviewButton = (btn) => {
        if (!btn) return;
        btn.onclick = () => {
            const pickedVoice = summaryVoiceSelect?.value || voiceSelect?.value || 'Trúc Ly';
            playVoicePreview(pickedVoice, {
                button: btn,
                onError: (msg) => window.alert?.(msg),
            });
        };
    };
    bindVoicePreviewButton(dialog.querySelector('#processVoicePreviewBtn'));
    bindVoicePreviewButton(dialog.querySelector('#processSummaryVoicePreviewBtn'));
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
    set('processLogoWidth', defaults.logo_width ?? '');
    set('processLogoHeight', defaults.logo_height ?? '');
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
        row.querySelector('.remove-blur-interval').onclick = () => {
            row.remove();
            intervalRoot.dispatchEvent(new Event('change', { bubbles: true }));
        };
        intervalRoot.appendChild(row);
    };
    (defaults.blur_intervals || []).forEach(addInterval);
    dialog.querySelector('#addBlurInterval').onclick = () => addInterval();

    let logoAspectRatio = 1;
    const resolveVideoPixelSpace = () => {
        if (preview?.videoWidth > 0 && preview?.videoHeight > 0) {
            return { w: preview.videoWidth, h: preview.videoHeight, isExact: true };
        }
        return {
            w: sourceWidth > 0 ? sourceWidth : 1280,
            h: sourceHeight > 0 ? sourceHeight : 720,
            isExact: sourceWidth > 0 && sourceHeight > 0,
        };
    };

    const probeLogoRatioFromData = (dataUrl, { ensureReasonableSize = false } = {}) => {
        if (!dataUrl || typeof window.Image !== 'function') return;
        const img = new window.Image();
        img.onload = () => {
            if (!isCurrent()) return;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                logoAspectRatio = img.naturalWidth / img.naturalHeight;
                const widthInput = dialog.querySelector('#processLogoWidth');
                const heightInput = dialog.querySelector('#processLogoHeight');
                const sizeInput = dialog.querySelector('#processLogoSize');
                const { w: vidW, h: vidH } = resolveVideoPixelSpace();
                const shortSide = Math.min(vidW, vidH);

                if (ensureReasonableSize) {
                    const maxAutoW = Math.max(72, Math.min(180, Math.round(shortSide * 0.14)));
                    const curW = Number(widthInput?.value || 0);
                    const curH = Number(heightInput?.value || 0);
                    const isEmpty = !curW && !curH;
                    const isOversized = curW > Math.round(vidW * 0.35) || curH > Math.round(vidH * 0.35);
                    if (isEmpty || isOversized) {
                        const targetW = logoAspectRatio >= 1
                            ? maxAutoW
                            : Math.max(48, Math.round(maxAutoW * logoAspectRatio));
                        const targetH = Math.max(24, Math.round(targetW / logoAspectRatio));
                        if (widthInput) widthInput.value = String(targetW);
                        if (heightInput) heightInput.value = String(targetH);
                        if (sizeInput) sizeInput.value = String(Math.max(targetW, targetH));
                    }
                } else if (widthInput && heightInput && !widthInput.value && heightInput.value) {
                    widthInput.value = String(Math.round(Number(heightInput.value) * logoAspectRatio));
                } else if (widthInput && heightInput && widthInput.value && !heightInput.value && logoShape?.value !== 'circle') {
                    heightInput.value = String(Math.round(Number(widthInput.value) / logoAspectRatio));
                }
                dialog._syncLogoOverlay?.();
            }
        };
        img.src = dataUrl;
    };

    const syncLogoSavedBadge = () => {
        const inlineBox = dialog.querySelector('#processLogoInlinePreview');
        const thumbImg = dialog.querySelector('#processLogoThumbImg');
        const badge = dialog.querySelector('#processLogoSavedBadge');
        const mode = dialog.querySelector('#processLogoMode')?.value || 'none';
        const hasImage = Boolean(dialog._logoData && mode === 'custom');
        if (inlineBox) inlineBox.hidden = !hasImage;
        if (thumbImg) {
            if (hasImage) thumbImg.src = dialog._logoData;
            else thumbImg.removeAttribute('src');
        }
        if (badge) {
            badge.textContent = dialog._logoFilename ? `Đã chọn: ${dialog._logoFilename}` : 'Đã chọn logo từ máy';
        }
    };

    const logoMode = dialog.querySelector('#processLogoMode');
    const logoShape = dialog.querySelector('#processLogoShape');
    const updateLogoFields = () => {
        const mode = logoMode.value;
        dialog.querySelector('#processLogoPathField').style.display = mode === 'custom' ? '' : 'none';
        dialog.querySelector('#processLogoFileField').style.display = mode === 'custom' ? '' : 'none';
        dialog.querySelector('#processLogoTextField').style.display = mode === 'text' ? '' : 'none';
        const shapeField = dialog.querySelector('#processLogoShapeField');
        if (shapeField) shapeField.style.display = (mode === 'custom' || mode === 'default') ? '' : 'none';
        syncLogoSavedBadge();
        dialog._syncLogoOverlay?.();
    };
    set('processLogoMode', defaults.logo_mode || 'none');
    if (logoShape) logoShape.value = defaults.logo_shape || 'rect';
    set('processLogoPath', defaults.logo_path || '');
    set('processLogoText', defaults.logo_text || '');
    logoMode.onchange = () => {
        if (logoMode.value && logoMode.value !== 'none') {
            logoSessionEnabled = true;
        }
        updateLogoFields();
    };
    if (logoShape) {
        logoShape.onchange = () => {
            dialog._syncLogoOverlay?.();
            syncSelectionFromFields?.();
        };
    }
    updateLogoFields();

    const downloadButton = dialog.querySelector('#processDownloadSource');
    downloadButton.disabled = false;
    downloadButton.innerHTML = `${uiIcon('download', 16)} Tải video để xem trước`;
    downloadButton.hidden = !!video.downloaded;
    downloadButton.onclick = async () => {
        downloadButton.disabled = true;
        downloadButton.textContent = 'Đang tải video...';
        setPreviewState('downloading');
        try {
            await downloadVideo(video, card, { localOnly: true });
            if (!isCurrent()) return;
            if (!video.downloaded) { setPreviewState('empty'); return; }
            setPreviewState('loading');
            const sourceUrl = await window.reupEngineClient.mediaUrl(`/api/preview/source/${encodeURIComponent(video.video_id)}?channel=${encodeURIComponent(video.channel || 'default')}`, { refresh: true });
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
        const ocrPickButton = dialog.querySelector('#processOcrPickRegion');
        if (ocrPickButton) ocrPickButton.disabled = !ready;
        pickerToggle.disabled = !ready;
        autoBlurButton.disabled = !ready;
        downloadButton.hidden = ready || state === 'loading';
        const manualLoadButton = dialog.querySelector('#processOcrLoadPreview');
        if (manualLoadButton) {
            manualLoadButton.hidden = ready;
            manualLoadButton.disabled = state === 'downloading' || state === 'loading';
            manualLoadButton.textContent = state === 'downloading' ? 'Đang tải video…' : 'Tải video để bắt đầu';
        }
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

    const showcaseEl = dialog.querySelector('#processConfigShowcase');
    const expandStageBtn = dialog.querySelector('#processExpandStageBtn');
    const collapseStageBtn = dialog.querySelector('#processCollapseStageBtn');
    const expandedLogoBar = dialog.querySelector('#processExpandedLogoBar');
    const stageMetricBadge = dialog.querySelector('#processStageMetricBadge');
    const stageLogoOverlay = dialog.querySelector('#processStageLogoOverlay');
    const stageLogoImg = dialog.querySelector('#processStageLogoImg');
    const stageLogoTextPreview = dialog.querySelector('#processStageLogoTextPreview');
    const stageLogoDims = dialog.querySelector('#processStageLogoDims');
    const stageLogoHandle = dialog.querySelector('#processStageLogoHandle');
    const quickLogoScaleInput = dialog.querySelector('#processQuickLogoScale');
    const quickLogoScaleText = dialog.querySelector('#processQuickLogoScaleText');
    const quickLogoKeepRect = dialog.querySelector('#processQuickLogoKeepRect');

    const computeLogoLayoutPixels = (vidW, vidH) => {
        const readNum = id => {
            const raw = dialog.querySelector(`#${id}`)?.value ?? '';
            if (raw === '') return null;
            const n = Number(raw);
            return Number.isFinite(n) ? n : null;
        };
        const clampNum = (v, min, max) => Math.max(min, Math.min(max, v));
        const mode = logoMode.value || 'none';
        const shape = logoShape?.value || 'rect';
        const shortSide = Math.min(vidW, vidH);
        const aspect = mode === 'custom' && logoAspectRatio > 0 ? logoAspectRatio : 1;
        const sizeIn = readNum('processLogoSize');
        const wIn = readNum('processLogoWidth');
        const hIn = readNum('processLogoHeight');
        let w;
        let h;

        if (mode === 'text') {
            const textStr = (dialog.querySelector('#processLogoText')?.value || '').trim() || 'Logo';
            const fontPx = Math.max(18, Math.round((sizeIn || 96) * 0.28));
            w = Math.round(clampNum(textStr.length * fontPx * 0.62 + 24, 60, vidW));
            h = Math.round(clampNum(fontPx + 18, 28, vidH));
        } else if (shape === 'circle') {
            const circleSize = Math.round(clampNum(
                sizeIn || (wIn && hIn ? Math.min(wIn, hIn) : 0) || clampNum(shortSide * 0.10, 72, 140),
                20,
                shortSide,
            ));
            w = circleSize;
            h = circleSize;
        } else {
            if (wIn && hIn) {
                if (mode === 'custom' && dialog._logoData) {
                    const scale = Math.min(wIn / aspect, hIn);
                    w = Math.max(1, Math.round(scale * aspect));
                    h = Math.max(1, Math.round(scale));
                } else {
                    w = Math.max(1, Math.round(wIn));
                    h = Math.max(1, Math.round(hIn));
                }
            } else if (wIn) {
                w = Math.max(1, Math.round(wIn));
                h = Math.max(1, Math.round(w / aspect));
            } else if (sizeIn) {
                if (aspect >= 1) {
                    w = Math.max(1, Math.round(sizeIn));
                    h = Math.max(1, Math.round(sizeIn / aspect));
                } else {
                    h = Math.max(1, Math.round(sizeIn));
                    w = Math.max(1, Math.round(sizeIn * aspect));
                }
            } else {
                const defaultCap = Math.min(180, Math.max(76, Math.round(vidW * 0.24)));
                w = Math.round(clampNum(shortSide * (aspect > 1.25 ? 0.15 : 0.12), 72, defaultCap));
                h = Math.max(1, Math.round(w / aspect));
            }
            if (w > vidW) {
                const s = vidW / w;
                w = Math.round(vidW);
                h = Math.max(1, Math.round(h * s));
            }
            if (h > vidH) {
                const s = vidH / h;
                h = Math.round(vidH);
                w = Math.max(1, Math.round(w * s));
            }
        }

        const xIn = readNum('processLogoX');
        const yIn = readNum('processLogoY');
        const x = Math.round(clampNum(xIn !== null ? xIn : vidW * 0.025, 0, Math.max(0, vidW - w)));
        const y = Math.round(clampNum(yIn !== null ? yIn : vidH * 0.025, 0, Math.max(0, vidH - h)));
        return { x, y, width: w, height: h, shape };
    };

    const syncStageMetricsReadout = (vidW, vidH, layout) => {
        if (!stageMetricBadge) return;
        const videoText = vidW > 0 && vidH > 0 ? `Video thật: ${vidW}×${vidH}` : 'Xem trước video';
        if (layout) {
            stageMetricBadge.textContent = `${videoText} · Logo: ${layout.width}×${layout.height} px (X:${layout.x}, Y:${layout.y}) · ${layout.shape === 'circle' ? 'Tròn' : 'Vuông/Chữ nhật'}`;
        } else {
            stageMetricBadge.textContent = videoText;
        }
    };

    const syncLogoOverlay = () => {
        if (!stageLogoOverlay) return;
        const mode = logoMode.value || 'none';
        const textValue = (dialog.querySelector('#processLogoText')?.value || '').trim();
        const ready = dialog.dataset.previewState === 'ready' && preview.videoWidth > 0 && preview.videoHeight > 0;
        const posterReady = !ready && poster && !poster.hidden && poster.naturalWidth > 0;
        const hasLogoContent = (mode === 'custom' && Boolean(dialog._logoData))
            || (mode === 'text' && Boolean(textValue))
            || mode === 'default';
        const shouldShow = (ready || posterReady) && hasLogoContent;
        stageLogoOverlay.hidden = !shouldShow;

        const { w: vidW, h: vidH } = resolveVideoPixelSpace();
        if (!shouldShow) {
            syncStageMetricsReadout(preview.videoWidth || sourceWidth, preview.videoHeight || sourceHeight, null);
            return;
        }

        const targetEl = ready ? preview : poster;
        const rect = targetEl.getBoundingClientRect();
        const stageRect = stage.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const layout = computeLogoLayoutPixels(vidW, vidH);
        stageLogoOverlay.dataset.shape = mode === 'text' ? 'rect' : layout.shape;
        stageLogoOverlay.style.left = `${rect.left - stageRect.left + (layout.x / vidW) * rect.width}px`;
        stageLogoOverlay.style.top = `${rect.top - stageRect.top + (layout.y / vidH) * rect.height}px`;
        stageLogoOverlay.style.width = `${Math.max(18, (layout.width / vidW) * rect.width)}px`;
        stageLogoOverlay.style.height = `${Math.max(18, (layout.height / vidH) * rect.height)}px`;
        stageLogoOverlay.style.pointerEvents = (pickingEnabled && pickMode !== 'logo') ? 'none' : 'auto';

        if (stageLogoDims) {
            stageLogoDims.textContent = `${layout.width}×${layout.height} px`;
        }
        syncStageMetricsReadout(vidW, vidH, layout);

        if (quickLogoScaleInput && quickLogoScaleText) {
            const pct = Math.max(3, Math.min(35, Math.round((layout.width / Math.max(1, Math.min(vidW, vidH))) * 100)));
            quickLogoScaleInput.value = String(pct);
            quickLogoScaleText.textContent = `${pct}%`;
        }
        if (quickLogoKeepRect && logoShape) {
            quickLogoKeepRect.checked = logoShape.value !== 'circle';
        }

        if (stageLogoImg && stageLogoTextPreview) {
            if (mode === 'custom' && dialog._logoData) {
                stageLogoImg.hidden = false;
                if (stageLogoImg.src !== dialog._logoData) stageLogoImg.src = dialog._logoData;
                stageLogoTextPreview.hidden = true;
            } else {
                stageLogoImg.hidden = true;
                stageLogoTextPreview.hidden = false;
                stageLogoTextPreview.textContent = mode === 'text' ? textValue : 'LOGO';
                const displayScale = rect.width / vidW;
                stageLogoTextPreview.style.fontSize = `${Math.max(11, Math.round(Math.max(18, (Number(dialog.querySelector('#processLogoSize')?.value) || 96) * 0.28) * displayScale))}px`;
            }
        }
        if (stageLogoHandle) {
            stageLogoHandle.hidden = mode === 'text';
        }
    };
    dialog._syncLogoOverlay = syncLogoOverlay;

    const setStageExpanded = (expanded) => {
        if (!showcaseEl) return;
        const next = Boolean(expanded);
        showcaseEl.classList.toggle('is-stage-expanded', next);
        if (expandedLogoBar) expandedLogoBar.hidden = !next;
        if (expandStageBtn) {
            expandStageBtn.innerHTML = next
                ? `${uiIcon('expand', 14)}<span>Thu nhỏ khung</span>`
                : `${uiIcon('expand', 14)}<span>Phóng to chỉnh kích thước thật</span>`;
        }
        window.requestAnimationFrame(() => {
            if (isCurrent()) {
                drawSelection();
                syncLogoOverlay();
            }
        });
    };

    if (expandStageBtn) {
        expandStageBtn.onclick = () => {
            setStageExpanded(!showcaseEl?.classList.contains('is-stage-expanded'));
        };
    }
    if (collapseStageBtn) {
        collapseStageBtn.onclick = () => setStageExpanded(false);
    }
    if (quickLogoKeepRect && logoShape) {
        quickLogoKeepRect.onchange = () => {
            logoShape.value = quickLogoKeepRect.checked ? 'rect' : 'circle';
            logoShape.dispatchEvent(new Event('change', { bubbles: true }));
        };
    }
    if (quickLogoScaleInput) {
        quickLogoScaleInput.oninput = () => {
            const pct = Math.max(3, Math.min(35, Number(quickLogoScaleInput.value || 12)));
            if (quickLogoScaleText) quickLogoScaleText.textContent = `${pct}%`;
            const { w: vidW, h: vidH } = resolveVideoPixelSpace();
            const shortSide = Math.min(vidW, vidH);
            const shape = logoShape?.value || 'rect';
            const mode = logoMode.value || 'none';
            const aspect = mode === 'custom' && logoAspectRatio > 0 ? logoAspectRatio : 1;
            const lw = Math.max(24, Math.round((shortSide * pct) / 100));
            const lh = shape === 'circle' ? lw : Math.max(16, Math.round(lw / aspect));
            set('processLogoWidth', lw);
            set('processLogoHeight', lh);
            set('processLogoSize', shape === 'circle' ? lw : Math.max(lw, lh));
            syncLogoOverlay();
            if (pickMode === 'logo') syncSelectionFromFields();
        };
    }
    dialog.querySelectorAll('[data-logo-corner]').forEach(btn => {
        btn.onclick = () => {
            const { w: vidW, h: vidH } = resolveVideoPixelSpace();
            const layout = computeLogoLayoutPixels(vidW, vidH);
            const marginX = Math.max(12, Math.round(vidW * 0.02));
            const marginY = Math.max(12, Math.round(vidH * 0.02));
            const corner = btn.dataset.logoCorner;
            const nx = (corner === 'tr' || corner === 'br') ? Math.max(0, vidW - layout.width - marginX) : marginX;
            const ny = (corner === 'bl' || corner === 'br') ? Math.max(0, vidH - layout.height - marginY) : marginY;
            set('processLogoX', nx);
            set('processLogoY', ny);
            syncLogoOverlay();
            if (pickMode === 'logo') syncSelectionFromFields();
            dialog._presetMarkDirty?.(dialog.querySelector('#processLogoX'));
        };
    });

    if (stageLogoOverlay) {
        let logoDragState = null;
        stageLogoOverlay.onpointerdown = event => {
            if (!preview.videoWidth || !preview.videoHeight || (pickingEnabled && pickMode !== 'logo')) return;
            event.preventDefault();
            event.stopPropagation();
            const rect = preview.getBoundingClientRect();
            const layout = computeLogoLayoutPixels(preview.videoWidth, preview.videoHeight);
            logoDragState = {
                type: event.target === stageLogoHandle ? 'resize' : 'move',
                startX: event.clientX,
                startY: event.clientY,
                initX: layout.x,
                initY: layout.y,
                initW: layout.width,
                initH: layout.height,
                scaleX: preview.videoWidth / Math.max(1, rect.width),
                scaleY: preview.videoHeight / Math.max(1, rect.height),
            };
            stageLogoOverlay.setPointerCapture(event.pointerId);
        };
        stageLogoOverlay.onpointermove = event => {
            if (!logoDragState || !preview.videoWidth) return;
            const dx = (event.clientX - logoDragState.startX) * logoDragState.scaleX;
            const dy = (event.clientY - logoDragState.startY) * logoDragState.scaleY;
            const shape = logoShape?.value || 'rect';
            const mode = logoMode.value || 'none';
            const aspect = (mode === 'custom' && logoAspectRatio > 0) ? logoAspectRatio : (logoDragState.initW / Math.max(1, logoDragState.initH));
            if (logoDragState.type === 'move') {
                const nx = Math.round(Math.max(0, Math.min(preview.videoWidth - logoDragState.initW, logoDragState.initX + dx)));
                const ny = Math.round(Math.max(0, Math.min(preview.videoHeight - logoDragState.initH, logoDragState.initY + dy)));
                set('processLogoX', nx);
                set('processLogoY', ny);
            } else {
                const maxW = Math.max(24, preview.videoWidth - logoDragState.initX);
                const maxH = Math.max(24, preview.videoHeight - logoDragState.initY);
                let nw = Math.round(Math.max(24, Math.min(maxW, logoDragState.initW + dx)));
                let nh = shape === 'circle' ? nw : Math.max(16, Math.round(nw / aspect));
                if (nh > maxH) {
                    nh = Math.round(maxH);
                    nw = shape === 'circle' ? nh : Math.max(16, Math.round(nh * aspect));
                }
                set('processLogoWidth', nw);
                set('processLogoHeight', nh);
                set('processLogoSize', shape === 'circle' ? nw : Math.max(nw, nh));
            }
            syncLogoOverlay();
            if (pickMode === 'logo') syncSelectionFromFields();
        };
        const endLogoDrag = event => {
            if (!logoDragState) return;
            logoDragState = null;
            dialog._presetMarkDirty?.(dialog.querySelector('#processLogoX'));
            try { stageLogoOverlay.releasePointerCapture(event.pointerId); } catch {}
        };
        stageLogoOverlay.onpointerup = endLogoDrag;
        stageLogoOverlay.onpointercancel = endLogoDrag;
    }

    ['processLogoWidth', 'processLogoHeight', 'processLogoSize', 'processLogoX', 'processLogoY', 'processLogoText'].forEach(id => {
        dialog.querySelector(`#${id}`)?.addEventListener('input', syncLogoOverlay, { signal });
    });

    const syncSelectionFromFields = () => {
        const value = id => dialog.querySelector(`#${id}`)?.value || '';
        const prefix = pickMode === 'logo'
            ? 'processLogo'
            : pickMode === 'custom'
                ? 'processCustomBlur'
                : pickMode === 'sub_novoice'
                    ? 'processSecondarySub'
                    : 'processBlur';
        const read = suffix => Number(value(`${prefix}${suffix}`));
        if (pickMode === 'logo') {
            if (preview.videoWidth > 0 && preview.videoHeight > 0 && (value('processLogoWidth') || value('processLogoSize'))) {
                const layout = computeLogoLayoutPixels(preview.videoWidth, preview.videoHeight);
                selectedRect = { x: layout.x, y: layout.y, width: layout.width, height: layout.height };
            } else {
                selectedRect = null;
            }
            drawSelection();
            return;
        }
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

    const drawLabeledRegion = (context, regionRect, strokeColor, fillColor, labelText) => {
        if (!regionRect || regionRect.width <= 0 || regionRect.height <= 0) return;
        const lineW = Math.max(2.5, canvas.width / 420);
        context.save();
        context.fillStyle = fillColor;
        context.strokeStyle = strokeColor;
        context.lineWidth = lineW;
        context.fillRect(regionRect.x, regionRect.y, regionRect.width, regionRect.height);
        context.strokeRect(regionRect.x, regionRect.y, regionRect.width, regionRect.height);

        if (labelText) {
            const fontPx = Math.max(13, Math.round(canvas.width / 54));
            context.font = `600 ${fontPx}px system-ui, -apple-system, sans-serif`;
            const padX = Math.round(fontPx * 0.55);
            const boxH = Math.round(fontPx * 1.48);
            const textW = Math.ceil(context.measureText(labelText).width);
            const boxW = textW + padX * 2;
            const lx = Math.max(0, Math.min(canvas.width - boxW, regionRect.x));
            const ly = regionRect.y >= boxH + 4 ? regionRect.y - boxH - 4 : Math.min(canvas.height - boxH, regionRect.y + 4);
            context.fillStyle = strokeColor;
            context.fillRect(lx, ly, boxW, boxH);
            context.fillStyle = '#ffffff';
            context.textBaseline = 'middle';
            context.fillText(labelText, lx + padX, ly + boxH / 2);
        }
        context.restore();
    };

    const readBoxFromPrefix = (prefix) => {
        const vals = ['X', 'Y', 'Width', 'Height'].map(s => Number(dialog.querySelector(`#${prefix}${s}`)?.value || ''));
        if (vals.every(Number.isFinite) && vals[2] > 0 && vals[3] > 0) {
            return { x: Math.max(0, vals[0]), y: Math.max(0, vals[1]), width: vals[2], height: vals[3] };
        }
        return null;
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
        syncLogoOverlay();

        const mainSubBox = pickMode === 'sub' && selectedRect ? selectedRect : readBoxFromPrefix('processBlur');
        const secSubBox = pickMode === 'sub_novoice' && selectedRect ? selectedRect : readBoxFromPrefix('processSecondarySub');
        const customBox = pickMode === 'custom' && selectedRect ? selectedRect : readBoxFromPrefix('processCustomBlur');

        drawLabeledRegion(context, mainSubBox, '#ef4444', 'rgba(239,68,68,.18)', 'Chữ chính (Phụ đề)');
        drawLabeledRegion(context, secSubBox, '#38bdf8', 'rgba(56,189,248,.20)', 'Chữ phụ (Không Voice)');
        drawLabeledRegion(context, customBox, '#fbbf24', 'rgba(251,191,36,.18)', 'Vùng mờ');

        if (selectedRect && (pickMode === 'logo' || pickMode === 'ocr')) {
            const label = pickMode === 'logo' ? 'Logo' : 'Vùng OCR';
            const color = pickMode === 'logo' ? '#9b91ff' : '#2dd4bf';
            const fill = pickMode === 'logo' ? 'rgba(124,108,255,.20)' : 'rgba(45,212,191,.20)';
            drawLabeledRegion(context, selectedRect, color, fill, label);
        }
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
            const shape = logoShape?.value || 'rect';
            const mode = logoMode.value || 'none';
            let lw = Math.round(rect.width);
            let lh = Math.round(rect.height);
            if (shape === 'circle') {
                const s = Math.round(Math.min(rect.width, rect.height));
                lw = s;
                lh = s;
            } else if (mode === 'custom' && dialog._logoData && logoAspectRatio > 0) {
                const scale = Math.min(rect.width / logoAspectRatio, rect.height);
                lw = Math.max(1, Math.round(scale * logoAspectRatio));
                lh = Math.max(1, Math.round(scale));
            }
            set('processLogoWidth', lw);
            set('processLogoHeight', lh);
            set('processLogoSize', shape === 'circle' ? lw : Math.max(lw, lh));
            set('processLogoX', Math.round(rect.x));
            set('processLogoY', Math.round(rect.y));
            syncLogoOverlay();
        } else if (pickMode === 'custom') {
            set('processCustomBlurX', Math.round(rect.x));
            set('processCustomBlurY', Math.round(rect.y));
            set('processCustomBlurWidth', Math.round(rect.width));
            set('processCustomBlurHeight', Math.round(rect.height));
        } else if (pickMode === 'sub_novoice') {
            set('processSecondarySubX', Math.round(rect.x));
            set('processSecondarySubY', Math.round(rect.y));
            set('processSecondarySubWidth', Math.round(rect.width));
            set('processSecondarySubHeight', Math.round(rect.height));
            secondarySubRows = [];
            renderSecondarySubPreview();
        } else if (pickMode === 'ocr') {
            selectedRect = { ...rect };
        } else {
            rect = { ...rect, x: 0, width: preview.videoWidth || rect.width };
            selectedRect = rect;
            set('processBlurX', 0);
            set('processBlurY', Math.round(rect.y));
            set('processBlurWidth', Math.round(rect.width));
            set('processBlurHeight', Math.round(rect.height));
            set('processBlurPreset', '');
        }
        const dirtyField = pickMode === 'logo' ? '#processLogoX' : pickMode === 'custom' ? '#processCustomBlurX' : '#processBlurY';
        dialog._presetMarkDirty?.(dialog.querySelector(dirtyField));
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
                logoMode.value = dialog._logoData ? 'custom' : 'default';
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
        syncLogoOverlay();
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

    const ocrPickButton = dialog.querySelector('#processOcrPickRegion');
    const ocrStatus = dialog.querySelector('#processOcrManualStatus');
    if (ocrPickButton) ocrPickButton.onclick = () => {
        if (dialog.dataset.previewState !== 'ready') {
            if (ocrStatus) ocrStatus.textContent = 'Tải video về máy trước để chọn vùng phụ đề.';
            downloadButton.click();
            return;
        }
        stopBlurPreview();
        pickMode = 'ocr';
        syncPickButtons();
        setPickingEnabled(true);
        if (ocrStatus) ocrStatus.textContent = 'Kéo khung quanh phụ đề trên video, rồi bấm “Bắt đầu xử lý” để quét và duyệt câu.';
    };

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
                if (pickMode === 'ocr' && ocrStatus) ocrStatus.textContent = 'Đã chọn vùng. Bấm “Bắt đầu xử lý” để nhận diện và mở bước duyệt phụ đề.';
            }
            try { canvas.releasePointerCapture(event.pointerId); } catch {}
        };
    }

    const ocrLines = reviewDialog?.querySelector('#processTranscriptReviewLines');
    const reviewStatus = reviewDialog?.querySelector('#processTranscriptReviewStatus');
    const reviewConfirm = reviewDialog?.querySelector('#processTranscriptReviewConfirm');
    const reviewSkip = reviewDialog?.querySelector('#processTranscriptReviewSkip');
    const reviewPause = reviewDialog?.querySelector('#processTranscriptReviewPause');
    const reviewFootnote = reviewDialog?.querySelector('.process-transcript-review-footnote');
    if (reviewConfirm) reviewConfirm.hidden = true;
    if (reviewPause) reviewPause.hidden = false;
    if (reviewFootnote) reviewFootnote.textContent = 'Tự tiếp tục xuất khi dịch xong. Bạn có thể tạm dừng để chỉnh bản dịch.';
    const pauseReviewForEditing = () => {
        reviewPaused = true;
        if (reviewPause) reviewPause.hidden = true;
        if (reviewConfirm) reviewConfirm.hidden = false;
        if (reviewFootnote) reviewFootnote.textContent = 'Đã tạm dừng tự xuất. Sửa câu hoặc thời gian, rồi bấm “Tiếp tục xuất”.';
    };
    if (reviewPause) reviewPause.onclick = pauseReviewForEditing;
    const maybeAutoContinueReview = () => {
        if (autoContinueScheduled || reviewPaused || !translationReady || translatingReview || submitting || !isCurrent() || !reviewDialog?.open) return;
        autoContinueScheduled = true;
        // Leave the current form submission before requesting the next one.
        window.setTimeout(() => {
            autoContinueScheduled = false;
            if (!reviewPaused && translationReady && !submitting && isCurrent() && reviewDialog?.open) reviewConfirm.onclick?.();
        }, 0);
    };
    const reviewPreviewLoading = reviewDialog?.querySelector('#processTranscriptPreviewLoading');
    const reviewPreviewRetry = reviewDialog?.querySelector('#processTranscriptPreviewRetry');
    const translationRetry = reviewDialog?.querySelector('#processTranscriptTranslationRetry');
    if (translationRetry) translationRetry.hidden = true;
    const reviewEngineUpdate = reviewDialog?.querySelector('#processTranscriptEngineUpdate');
    if (reviewEngineUpdate) reviewEngineUpdate.hidden = true;
    const reviewStages = [
        reviewDialog?.querySelector('#processTranscriptStepRecognize'),
        reviewDialog?.querySelector('#processTranscriptStepReview'),
        reviewDialog?.querySelector('#processTranscriptStepExport'),
    ];
    const reviewProgressFill = reviewDialog?.querySelector('#processTranscriptProgressFill');
    const setReviewProgress = (index, percent) => {
        const stage = reviewStages[index];
        const label = stage?.querySelector('small');
        const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
        if (label) label.textContent = `${value}%`;
        if (index === 0 && reviewProgressFill) {
            reviewProgressFill.style.width = `${value}%`;
            reviewDialog?.querySelector('.process-transcript-progress')?.setAttribute('aria-valuenow', String(value));
        }
    };
    const setReviewStage = currentIndex => reviewStages.forEach((stage, index) => {
        if (!stage) return;
        stage.classList.toggle('is-complete', index < currentIndex);
        stage.classList.toggle('is-current', index === currentIndex);
        stage.classList.toggle('is-error', currentIndex < 0 && index === 0);
        if (index === currentIndex) stage.setAttribute('aria-current', 'step');
        else stage.removeAttribute('aria-current');
        if (index < currentIndex) setReviewProgress(index, 100);
    });
    if (reviewPreview) {
        reviewPreview.crossOrigin = 'anonymous';
        reviewPreview.onloadeddata = () => {
            if (reviewPreviewLoading) reviewPreviewLoading.hidden = true;
            if (reviewPreviewRetry) reviewPreviewRetry.hidden = true;
        };
        reviewPreview.onerror = () => {
            if (reviewPreviewLoading) {
                reviewPreviewLoading.hidden = false;
                reviewPreviewLoading.textContent = 'Chưa mở được video xem trước. Bấm thử tải lại để kết nối lại với file trên máy.';
            }
            if (reviewPreviewRetry) reviewPreviewRetry.hidden = false;
        };
    }
    const currentTranscriptSignature = () => JSON.stringify({
        model: dialog.querySelector('#processTranslationModel')?.value || 'gemini-3.1-flash-lite',
        source: transcriptSource?.value || 'audio',
        language: transcriptSource?.value === 'video_subtitles'
            ? dialog.querySelector('#processOcrLanguage')?.value || 'auto'
            : dialog.querySelector('#processSourceLanguage')?.value || 'auto',
        region: selectedRect ? [selectedRect.x, selectedRect.y, selectedRect.width, selectedRect.height].map(value => Math.round(value)) : null,
        fps: Number(dialog.querySelector('#processOcrFps')?.value || 2),
        confidence: Number(dialog.querySelector('#processOcrConfidence')?.value || .45),
    });
    const syncReviewPreview = async (refresh = false) => {
        let source;
        try {
            source = await window.reupEngineClient.mediaUrl(`/api/preview/source/${encodeURIComponent(video.video_id)}?channel=${encodeURIComponent(video.channel || 'default')}`, { refresh });
        } catch { reviewPreview?.onerror?.(); return; }
        if (!isCurrent()) return;
        if (reviewPreview && source && reviewPreview.dataset.sourceUrl !== source) {
            reviewPreview.dataset.sourceUrl = source;
            if (reviewPreviewLoading) {
                reviewPreviewLoading.hidden = false;
                reviewPreviewLoading.textContent = 'Đang mở video xem trước…';
            }
            reviewPreview.src = source;
            reviewPreview.load();
        }
    };
    if (reviewPreviewRetry) reviewPreviewRetry.onclick = () => { void syncReviewPreview(true); };
    if (reviewPreview) {
        reviewPreview.addEventListener('loadedmetadata', () => {
            const pending = Number(reviewPreview.dataset.seekTo);
            if (Number.isFinite(pending)) {
                try { reviewPreview.currentTime = Math.max(0, pending); } catch {}
                delete reviewPreview.dataset.seekTo;
            }
        });
    }
    const ocrErrorMessage = error => {
        const detail = String(error?.message || '').trim();
        if (error?.status === 404 && /^not found$/i.test(detail)) {
            return 'Local Engine đang dùng chưa hỗ trợ mục này. Hãy thoát hẳn Local Engine, cập nhật bản mới rồi mở lại.';
        }
        if (error?.status === 422) {
            return `Local Engine không thể hoàn tất yêu cầu quét${detail && !/^Local Engine HTTP 422$/i.test(detail) ? `: ${detail}` : '. Kiểm tra video đã tải về và ngôn ngữ nguồn, sau đó thử lại.'}`;
        }
        if (error?.name === 'AbortError') return 'Đã dừng thao tác quét.';
        return detail || 'Không hoàn tất được thao tác OCR.';
    };
    const renderManualOcrRows = (emptyMessage = '') => {
        const lines = manualOcrRows.map((line, index) => line ? { line, index } : null).filter(Boolean);
        if (!lines.length) {
            const empty = document.createElement('tr'); empty.className = 'process-ocr-empty';
            const cell = document.createElement('td'); cell.colSpan = 4; cell.textContent = emptyMessage || (transcriptSource?.value === 'video_subtitles'
                ? 'Chưa có phụ đề. Khoanh vùng trên video rồi bắt đầu xử lý để nhận diện.'
                : 'Chưa có lời thoại. Bắt đầu xử lý để nhận diện bằng Whisper.');
            empty.append(cell); ocrLines.replaceChildren(empty);
            const tableWrap = reviewDialog?.querySelector('.process-ocr-table-wrap');
            if (tableWrap) tableWrap.scrollTop = 0;
            return;
        }
        ocrLines.replaceChildren(...lines.map(({ line, index }, visibleIndex) => {
            const row = document.createElement('tr'); row.className = 'process-ocr-line'; row.dataset.index = String(index); row.dataset.id = String(line.id);
            const seekToLine = () => {
                const start = Number(row.querySelector('.ocr-line-start')?.value);
                if (reviewPreview && Number.isFinite(start)) {
                    if (reviewPreview.readyState >= 1) {
                        try { reviewPreview.currentTime = Math.max(0, start); } catch {}
                    } else {
                        reviewPreview.dataset.seekTo = String(Math.max(0, start));
                    }
                }
            };
            const number = document.createElement('td'); number.className = 'process-ocr-row-number'; number.textContent = String(visibleIndex + 1);
            const timing = document.createElement('td'); timing.className = 'process-ocr-line-timing';
            const timeFields = document.createElement('div'); timeFields.className = 'process-ocr-line-time-fields';
            const startInput = document.createElement('input'); startInput.className = 'ocr-line-start'; startInput.type = 'number'; startInput.min = '0'; startInput.step = '0.01'; startInput.value = Number(line.start).toFixed(2); startInput.setAttribute('aria-label', 'Thời gian bắt đầu, giây');
            const endInput = document.createElement('input'); endInput.className = 'ocr-line-end'; endInput.type = 'number'; endInput.min = '0'; endInput.step = '0.01'; endInput.value = Number(line.end).toFixed(2); endInput.setAttribute('aria-label', 'Thời gian kết thúc, giây');
            startInput.addEventListener('focus', seekToLine);
            startInput.oninput = () => { line.start = Number(startInput.value); pauseReviewForEditing(); };
            endInput.oninput = () => { line.end = Number(endInput.value); pauseReviewForEditing(); };
            row.addEventListener('click', event => {
                if (!event.target.closest('input, textarea, button')) seekToLine();
            });
            timeFields.append(startInput, endInput); timing.append(timeFields);
            const sourceCell = document.createElement('td');
            const sourceInput = document.createElement('textarea'); sourceInput.className = 'ocr-line-translation'; sourceInput.rows = 2;
            sourceInput.value = String(line.translated_text ?? ''); sourceInput.readOnly = line.translated_text == null;
            sourceInput.setAttribute('aria-label', 'Bản dịch tiếng Việt'); sourceInput.placeholder = 'Đang chờ dịch sang tiếng Việt…';
            sourceInput.oninput = () => { line.translated_text = sourceInput.value; pauseReviewForEditing(); };
            const original = document.createElement('details'); original.className = 'process-transcript-original';
            const originalLabel = document.createElement('summary'); originalLabel.textContent = 'Câu gốc';
            const originalText = document.createElement('p'); originalText.textContent = line.text || '';
            original.append(originalLabel, originalText); sourceCell.append(sourceInput, original);
            const actions = document.createElement('td'); actions.className = 'process-ocr-line-actions';
            const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = 'Xóa câu phụ đề'; remove.setAttribute('aria-label', 'Xóa câu phụ đề');
            remove.onclick = () => { pauseReviewForEditing(); deletedTranscriptIds.add(String(line.id)); manualOcrRows[index] = null; renderManualOcrRows(); };
            actions.append(remove); row.append(number, timing, sourceCell, actions);
            return row;
        }));
        const tableWrap = reviewDialog?.querySelector('.process-ocr-table-wrap');
        if (tableWrap && !renderManualOcrRows.followTail) tableWrap.scrollTop = 0;
        if (tableWrap) renderManualOcrRows.followTail = false;
    };
    const mergeLiveTranscriptLines = incoming => {
        if (!Array.isArray(incoming) || !incoming.length) return;
        const tableWrap = reviewDialog?.querySelector('.process-ocr-table-wrap');
        const followTail = !tableWrap || tableWrap.scrollHeight - tableWrap.scrollTop - tableWrap.clientHeight < 90;
        const previousLines = new Map(manualOcrRows.filter(Boolean).map(line => [String(line.id), line]));
        for (const row of ocrLines?.querySelectorAll('.process-ocr-line') || []) {
            const line = previousLines.get(String(row.dataset.id));
            if (!line) continue;
            line.start = Number(row.querySelector('.ocr-line-start')?.value ?? line.start);
            line.end = Number(row.querySelector('.ocr-line-end')?.value ?? line.end);
            const edited = row.querySelector('.ocr-line-translation');
            if (edited && !edited.readOnly) line.translated_text = edited.value;
        }
        const merged = [...manualOcrRows];
        let added = false;
        incoming.forEach((line, index) => {
            const id = Number(line.id ?? index + 1);
            if (deletedTranscriptIds.has(String(id))) return;
            const previous = previousLines.get(String(id));
            if (!previous) added = true;
            merged[id - 1] = { ...line, ...previous, id };
        });
        if (!added) return;
        manualOcrRows = merged;
        renderManualOcrRows.followTail = followTail;
        renderManualOcrRows();
        if (followTail && tableWrap) tableWrap.scrollTop = tableWrap.scrollHeight;
    };
    const translateReviewRows = async () => {
        if (translatingReview || !recognitionComplete) return;
        translatingReview = true;
        translationReady = false;
        reviewConfirm.disabled = true;
        if (translationRetry) translationRetry.hidden = true;
        setReviewStage(1);
        try {
            const lines = manualOcrRows.filter(Boolean);
            const pending = lines.filter(line => line.translated_text == null);
            const sourceLanguage = transcriptSource?.value === 'video_subtitles'
                ? dialog.querySelector('#processOcrLanguage')?.value || 'auto'
                : dialog.querySelector('#processSourceLanguage')?.value || 'auto';
            const targetLanguage = dialog.querySelector('#processTargetLanguage')?.value || 'vi';
            const targetLanguageLabel = dialog.querySelector('#processTargetLanguage')?.selectedOptions?.[0]?.textContent?.replace(/\s*\(Mặc định\)\s*/gi, '').trim() || 'Tiếng Việt';
            for (let offset = 0; offset < pending.length; offset += 16) {
                if (!isCurrent() || skipReviewRequested) return;
                const batch = pending.slice(offset, offset + 16);
                const done = lines.filter(line => line.translated_text != null).length;
                reviewStatus.textContent = `Đang dịch sang ${targetLanguageLabel} · ${done}/${lines.length} câu. Bạn có thể sửa các câu đã dịch.`;
                setReviewProgress(1, done / lines.length * 100);
                const result = (sourceLanguage !== 'auto' && sourceLanguage === targetLanguage)
                    ? { translations: batch.map(line => ({ id: line.id, text: line.text })) }
                    : await requestJson('/api/preview/subtitle-translation', {
                        method: 'POST', timeoutMs: 180000, headers: { 'Content-Type': 'application/json' },
                        signal: previewAbortController?.signal,
                        body: JSON.stringify({
                            source_language: sourceLanguage,
                            target_language: targetLanguage,
                            translation_model: dialog.querySelector('#processTranslationModel')?.value || 'gemini-3.1-flash-lite',
                            lines: batch.map(line => ({ id: line.id, text: line.text })),
                        }),
                    });
                if (!isCurrent() || skipReviewRequested) return;
                const translated = new Map((result.translations || []).map(item => [String(item.id), String(item.text || '').trim()]));
                for (const line of batch) {
                    const text = translated.get(String(line.id));
                    if (!text) throw new Error('Có câu chưa dịch được. Bấm “Thử dịch lại” để hoàn tất các câu còn lại.');
                    line.translated_text = text;
                    const input = ocrLines.querySelector(`.process-ocr-line[data-id="${line.id}"] .ocr-line-translation`);
                    if (input) { input.value = text; input.readOnly = false; }
                }
            }
            if (skipReviewRequested) return;
            setReviewProgress(1, 100);
            translationReady = true;
            reviewStatus.textContent = reviewPaused
                ? `${lines.length} câu đã dịch sang tiếng Việt. Sửa nếu cần, rồi bấm “Tiếp tục xuất”.`
                : `${lines.length} câu đã dịch sang tiếng Việt. Đang tiếp tục xuất thành phẩm…`;
            reviewConfirm.disabled = false;
        } catch (error) {
            if (!isCurrent() || skipReviewRequested) return;
            reviewStatus.textContent = `Chưa dịch xong: ${ocrErrorMessage(error)}`;
            if (translationRetry) translationRetry.hidden = false;
        } finally { translatingReview = false; if (!skipReviewRequested) maybeAutoContinueReview(); }
    };
    if (translationRetry) translationRetry.onclick = () => { void translateReviewRows(); };
    if (reviewDialog) {
        reviewDialog.oncancel = pauseReviewForEditing;
        reviewDialog.querySelector('#processTranscriptReviewClose').onclick = () => { pauseReviewForEditing(); reviewDialog.close(); };
        reviewSkip.onclick = () => {
            reviewPaused = false;
            if (reviewPause) reviewPause.hidden = false;
            if (reviewConfirm) reviewConfirm.hidden = true;
            if (translationReady) {
                reviewConfirm.onclick?.();
                return;
            }
            skipReviewRequested = true;
            if (previewAbortController) {
                try { previewAbortController.abort(); } catch {}
            }
            if (statusTimer) window.clearInterval(statusTimer);
            transcriptConfirmed = true;
            if (!recognitionComplete) {
                manualOcrRows = [];
            }
            submitting = false;
            reviewDialog.close();
            window.setTimeout(() => {
                if (isCurrent()) {
                    configForm.requestSubmit();
                }
            }, 0);
        };
        reviewConfirm.onclick = () => {
            const validRows = [...ocrLines.querySelectorAll('.process-ocr-line')].filter(row => {
                const start = Number(row.querySelector('.ocr-line-start')?.value);
                const end = Number(row.querySelector('.ocr-line-end')?.value);
                const text = row.querySelector('.ocr-line-translation')?.value.trim();
                return text && Number.isFinite(start) && Number.isFinite(end) && end > start;
            });
            if (!validRows.length || validRows.length !== manualOcrRows.filter(Boolean).length) {
                pauseReviewForEditing();
                reviewStatus.textContent = 'Mỗi câu cần có bản dịch tiếng Việt và thời gian kết thúc lớn hơn thời gian bắt đầu.';
                return;
            }
            if (!window.reupEngineClient.health?.capabilities?.reviewed_translations) {
                pauseReviewForEditing();
                reviewStatus.textContent = 'Cần cập nhật Local Engine 0.2.51 trở lên để xuất đúng bản dịch bạn đã sửa. Bản dịch vẫn được giữ ở đây.';
                if (reviewEngineUpdate) reviewEngineUpdate.hidden = false;
                return;
            }
            setReviewProgress(1, 100); setReviewProgress(2, 0);
            transcriptConfirmed = true;
            reviewDialog.close();
            configForm.requestSubmit();
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
        dialog._renderSubtitleStylePreview?.();
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
            const channel = encodeURIComponent(video.channel || 'default');
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
        window.reupEngineClient.mediaUrl(`/api/preview/source/${encodeURIComponent(video.video_id)}?channel=${encodeURIComponent(video.channel || 'default')}`)
            .then(url => { if (isCurrent()) preview.src = url; })
            .catch(() => { if (isCurrent()) preview.onerror(); });
    }

    dialog.querySelector('#resetProcessConfig').onclick = () => {
        dialog.dataset.presetApplying = '1';
        try {
            manualOcrRows = [];
            recognitionComplete = false;
            translationReady = false;
            reviewPaused = false;
            if (reviewPause) reviewPause.hidden = false;
            if (reviewConfirm) reviewConfirm.hidden = true;
            if (reviewFootnote) reviewFootnote.textContent = 'Tự tiếp tục xuất khi dịch xong. Bạn có thể tạm dừng để chỉnh bản dịch.';
            transcriptConfirmed = false;
            transcriptSignature = '';
            if (reviewConfirm) reviewConfirm.disabled = true;
            if (reviewStatus) reviewStatus.textContent = 'Đang nhận diện lời thoại…';
            renderManualOcrRows();
            set('processPreviewSeconds', '');
            set('processFontSize', '');
            set('processSourceLanguage', 'auto');
            set('processTargetLanguage', 'vi');
            set('processTranslationModel', 'gemini-3.1-flash-lite');
            set('processTranscriptSource', 'audio');
            set('processOutputFormat', 'video');
            set('processOcrLanguage', 'auto');
            set('processOcrFps', 2);
            set('processOcrConfidence', 0.45);
            set('processOcrParallelism', 2);
            set('processOcrSimilarity', 0.82);
            dialog.querySelector('#processOcrUseGpu').checked = false;
            const modalBoost = dialog.querySelector('#processBoostGpu');
            if (modalBoost) modalBoost.checked = false;
            dialog.querySelector('#processOcrMergeSimilar').checked = true;
            syncOcrOptions();
            syncOutputLabel();
            set('processSubtitleStyle', 'minimal');
            set('processOriginalVolume', 0.15);
            set('processVoiceVolume', 1);
            set('processTtsSpeed', 1.00);
            syncTargetLanguageVoices('vi', { preferredVoice: 'Trúc Ly' });
            set('processAspectRatio', '');
            set('processMusicUrl', '');
            set('processMusicVolume', 0.25);
            dialog.querySelector('#processMusicFile').value = '';
            dialog.querySelector('#processAutoBrandBlur').checked = false;
            dialog.querySelector('#processSourceNoSub').checked = false;
            if (dialog.querySelector('#processAntiReuse')) dialog.querySelector('#processAntiReuse').checked = false;
            if (dialog.querySelector('#processAntiReuseMirror')) dialog.querySelector('#processAntiReuseMirror').checked = false;
            if (dialog.querySelector('#processAntiReuseColor')) dialog.querySelector('#processAntiReuseColor').checked = false;
            if (dialog.querySelector('#processVocalSeparation')) dialog.querySelector('#processVocalSeparation').checked = false;
            set('processEraseMode', 'blur');
            set('processGlossary', '');
            set('processBlurPreset', '');
            ['processBlurX', 'processBlurY', 'processBlurWidth', 'processBlurHeight',
                'processCustomBlurX', 'processCustomBlurY', 'processCustomBlurWidth', 'processCustomBlurHeight',
                'processLogoWidth', 'processLogoHeight', 'processLogoSize', 'processLogoX', 'processLogoY', 'processLogoPath', 'processLogoText']
                .forEach(id => set(id, ''));
            set('processLogoMode', 'none');
            if (logoShape) logoShape.value = 'rect';
            logoAspectRatio = 1;
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
            if (presetSelect) presetSelect.value = '';
            dialog._presetDirtySections.clear();
            hasUserEditedSinceOpen = true;
            const rememberOn = autoRememberCheckbox?.checked !== false;
            writeActivePresetPref(localStorage, { name: '', autoRemember: rememberOn });
            clearTimeout(lastConfigSaveTimer);
            void clearLastConfig(localStorage, requestJson);
            updatePresetDirtyStatus();
            if (presetStatus) presetStatus.textContent = 'Đã khôi phục cấu hình mặc định sạch.';
        } finally {
            dialog.dataset.presetApplying = '0';
        }
    };

    // Preset & Auto-remember: tự lưu thao tác gần nhất và đồng bộ với Engine.
    const presetSelect = dialog.querySelector('#processPresetSelect');
    const presetNameInput = dialog.querySelector('#processPresetName');
    const presetStatus = dialog.querySelector('#processPresetStatus');
    const updatePresetBtn = dialog.querySelector('#updateProcessPreset');
    const autoRememberCheckbox = dialog.querySelector('#processAutoRememberConfig');
    let activePref = readActivePresetPref(localStorage);
    if (autoRememberCheckbox) {
        autoRememberCheckbox.checked = activePref.autoRemember;
    }

    const collectPresetConfig = () => {
        const value = id => dialog.querySelector(`#${id}`)?.value || '';
        const fields = [
            'processPreviewSeconds', 'processFontSize', 'processSourceLanguage', 'processTargetLanguage', 'processTranslationModel', 'processTranscriptSource', 'processOutputFormat',
            'processOcrLanguage', 'processOcrFps', 'processOcrConfidence', 'processOcrParallelism', 'processOcrSimilarity', 'processSubtitleStyle', 'processOriginalVolume',
            'processVoiceVolume', 'processTtsSpeed', 'processVoice',
            'processAspectRatio', 'processMusicUrl', 'processMusicVolume',
            'processBlurPreset', 'processLogoMode', 'processLogoShape', 'processLogoPath',
            'processLogoText', 'processLogoWidth', 'processLogoHeight', 'processLogoSize', 'processLogoX', 'processLogoY',
            'processCustomBlurX', 'processCustomBlurY', 'processCustomBlurWidth',
            'processCustomBlurHeight', 'processBlurX', 'processBlurY',
            'processBlurWidth', 'processBlurHeight',
            'processSecondarySubX', 'processSecondarySubY', 'processSecondarySubWidth', 'processSecondarySubHeight',
            'processSecondarySubStyle', 'processSecondarySubFontSize', 'processEraseMode', 'processGlossary',
        ];
        return {
            ...Object.fromEntries(fields.map(id => [id, value(id)])),
            boost_gpu: !!dialog.querySelector('#processBoostGpu')?.checked,
            auto_brand_blur: !!dialog.querySelector('#processAutoBrandBlur')?.checked,
            anti_reuse: !!dialog.querySelector('#processAntiReuse')?.checked,
            anti_reuse_mirror: !!dialog.querySelector('#processAntiReuseMirror')?.checked,
            anti_reuse_color: !!dialog.querySelector('#processAntiReuseColor')?.checked,
            vocal_separation: !!dialog.querySelector('#processVocalSeparation')?.checked,
            secondary_sub_blur: dialog.querySelector('#processSecondarySubBlur')?.checked !== false,
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

    const persistLastConfigNow = async (syncRemote = true) => {
        if (!isCurrent() || autoRememberCheckbox?.checked === false) return;
        await writeLastConfig(localStorage, requestJson, {
            config: collectPresetConfig(),
            presetName: presetSelect?.value || '',
        }, { syncRemote });
    };

    dialog._scheduleSaveLastConfig = () => {
        if (dialog.dataset.presetApplying === '1' || autoRememberCheckbox?.checked === false) return;
        clearTimeout(lastConfigSaveTimer);
        lastConfigSaveTimer = setTimeout(() => {
            void persistLastConfigNow(true);
        }, 400);
    };

    const REGION_FIELD_IDS = new Set([
        'processBlurPreset', 'processBlurX', 'processBlurY', 'processBlurWidth', 'processBlurHeight',
        'processCustomBlurX', 'processCustomBlurY', 'processCustomBlurWidth', 'processCustomBlurHeight',
        'processSecondarySubX', 'processSecondarySubY', 'processSecondarySubWidth', 'processSecondarySubHeight',
    ]);

    const applyPresetConfig = (preset, name = '', { statusText = '', markClean = true, restoreLogo = false, restoreRegions = false } = {}) => {
        if (!preset || typeof preset !== 'object') return;
        const allowLogoRestore = Boolean(restoreLogo || logoSessionEnabled);
        if (restoreLogo && (preset.processLogoMode && preset.processLogoMode !== 'none')) {
            logoSessionEnabled = true;
        }
        dialog.dataset.presetApplying = '1';
        try {
            if (!restoreRegions) {
                REGION_FIELD_IDS.forEach(fid => set(fid, ''));
            }
            Object.entries(preset).forEach(([id, value]) => {
                if (!allowLogoRestore && (id.startsWith('processLogo') || id === 'logo_data' || id === 'logo_filename')) {
                    return;
                }
                if (!restoreRegions && REGION_FIELD_IDS.has(id)) {
                    return;
                }
                if (id === 'auto_brand_blur') {
                    const el = dialog.querySelector('#processAutoBrandBlur');
                    if (el) el.checked = !!value;
                } else if (id === 'secondary_sub_blur') {
                    const el = dialog.querySelector('#processSecondarySubBlur');
                    if (el) el.checked = value !== false;
                } else if (id === 'boost_gpu') {
                    const el = dialog.querySelector('#processBoostGpu');
                    if (el) el.checked = !!value;
                    const barBoost = document.getElementById('boostGpuToggle');
                    if (barBoost) barBoost.checked = !!value;
                    try { localStorage.setItem('reupai:boost-gpu', value ? '1' : '0'); } catch {}
                } else if (id === 'ocr_use_gpu') {
                    const el = dialog.querySelector('#processOcrUseGpu');
                    if (el) el.checked = !!value;
                } else if (id === 'ocr_merge_similar') {
                    const el = dialog.querySelector('#processOcrMergeSimilar');
                    if (el) el.checked = !!value;
                } else if (id === 'anti_reuse') {
                    const el = dialog.querySelector('#processAntiReuse');
                    if (el) el.checked = !!value;
                } else if (id === 'anti_reuse_mirror') {
                    const el = dialog.querySelector('#processAntiReuseMirror');
                    if (el) el.checked = !!value;
                } else if (id === 'anti_reuse_color') {
                    const el = dialog.querySelector('#processAntiReuseColor');
                    if (el) el.checked = !!value;
                } else if (id === 'vocal_separation') {
                    const el = dialog.querySelector('#processVocalSeparation');
                    if (el) el.checked = !!value;
                } else if (id === 'source_subtitle_mode') {
                    const el = dialog.querySelector('#processSourceNoSub');
                    if (el) el.checked = value === 'none';
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
            syncTargetLanguageVoices(
                preset.processTargetLanguage || targetLangSelect?.value || 'vi',
                { preferredVoice: preset.processVoice },
            );
            intervalRoot.innerHTML = '';
            if (restoreRegions) {
                (Array.isArray(preset.blur_intervals) ? preset.blur_intervals : []).forEach(addInterval);
            }
            if (['sub', 'custom', 'logo'].includes(preset.active_pick_mode)) {
                pickMode = preset.active_pick_mode;
                pickButtons.forEach(button => button.classList.toggle('active', button.dataset.pickMode === pickMode));
            }
            logoMode.dispatchEvent(new Event('change'));
            if (dialog._logoData) probeLogoRatioFromData(dialog._logoData);
            syncLogoSavedBadge();
            syncOcrOptions();
            syncOutputLabel();
            syncSelectionFromFields();
            syncLogoOverlay();
            if (markClean) {
                dialog._presetDirtySections.clear();
            }
            updatePresetDirtyStatus();
            if (statusText && presetStatus) {
                presetStatus.textContent = statusText;
            } else if (presetStatus) {
                presetStatus.textContent = name
                    ? `Đang dùng preset: ${name}`
                    : 'Đã khôi phục cấu hình thao tác gần nhất.';
            }
            outputSummary.refresh();
            dialog._renderSubtitleStylePreview?.();
        } finally {
            dialog.dataset.presetApplying = '0';
        }
    };

    const refreshPresetOptions = (presetMap, selected = '') => {
        if (!presetSelect) return;
        presetSelect.innerHTML = '<option value="">Không dùng preset</option>';
        Object.keys(presetMap).sort((a, b) => a.localeCompare(b, 'vi')).forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            presetSelect.appendChild(option);
        });
        presetSelect.value = selected && presetMap[selected] ? selected : '';
        updatePresetDirtyStatus();
    };

    let presets = readPresetsLocal(localStorage);
    const initialLastSaved = activePref.autoRemember ? readLastConfigLocal(localStorage) : null;
    const initialSelectedPreset = (activePref.name && presets[activePref.name])
        ? activePref.name
        : (initialLastSaved?.presetName && presets[initialLastSaved.presetName] ? initialLastSaved.presetName : '');
    refreshPresetOptions(presets, initialSelectedPreset);

    if (activePref.autoRemember) {
        if (initialSelectedPreset && (!initialLastSaved || initialLastSaved.presetName === initialSelectedPreset)) {
            const useLastSnapshot = initialLastSaved && initialLastSaved.config;
            applyPresetConfig(
                useLastSnapshot ? initialLastSaved.config : presets[initialSelectedPreset],
                initialSelectedPreset,
                { statusText: `Đã tự khôi phục preset “${initialSelectedPreset}” từ lần trước.` },
            );
        } else if (initialLastSaved?.config) {
            applyPresetConfig(
                initialLastSaved.config,
                initialSelectedPreset,
                { statusText: 'Đã tự khôi phục cấu hình thao tác gần nhất.' },
            );
        } else {
            dialog.dataset.presetApplying = '0';
            updatePresetDirtyStatus();
        }
    } else {
        dialog.dataset.presetApplying = '0';
        updatePresetDirtyStatus();
    }

    // Đồng bộ ngầm từ Local Engine để giữ cấu hình qua mọi phiên/trình duyệt.
    void (async () => {
        const [{ presets: syncedPresets, updated }, syncedLast] = await Promise.all([
            syncPresetsFromEngine(localStorage, requestJson),
            activePref.autoRemember ? syncLastConfigFromEngine(localStorage, requestJson) : Promise.resolve(null),
        ]);
        if (!isCurrent()) return;
        presets = syncedPresets;
        const currentName = presetSelect?.value || activePref.name || syncedLast?.presetName || '';
        const resolvedName = currentName && presets[currentName] ? currentName : '';
        if (updated || resolvedName !== (presetSelect?.value || '')) {
            refreshPresetOptions(presets, resolvedName);
        }
        if (hasUserEditedSinceOpen || !activePref.autoRemember) return;
        const initialTs = Number(initialLastSaved?.savedAt || 0);
        if (syncedLast?.config && Number(syncedLast.savedAt || 0) > initialTs) {
            applyPresetConfig(
                syncedLast.config,
                resolvedName,
                { statusText: 'Đã đồng bộ cấu hình gần nhất từ Local Engine.' },
            );
        } else if (!initialSelectedPreset && resolvedName && presets[resolvedName]) {
            applyPresetConfig(
                presets[resolvedName],
                resolvedName,
                { statusText: `Đã đồng bộ preset “${resolvedName}” từ Local Engine.` },
            );
        }
    })();

    if (autoRememberCheckbox) {
        autoRememberCheckbox.onchange = () => {
            const enabled = !!autoRememberCheckbox.checked;
            activePref = writeActivePresetPref(localStorage, {
                name: presetSelect?.value || '',
                autoRemember: enabled,
            });
            if (enabled) {
                void persistLastConfigNow(true);
            }
            updatePresetDirtyStatus();
        };
    }

    presetSelect.onchange = () => {
        const name = presetSelect.value;
        activePref = writeActivePresetPref(localStorage, {
            name,
            autoRemember: autoRememberCheckbox?.checked !== false,
        });
        if (!name || !presets[name]) {
            dialog._presetDirtySections.clear();
            updatePresetDirtyStatus();
            void persistLastConfigNow(true);
            return;
        }
        applyPresetConfig(presets[name], name, { restoreLogo: true, restoreRegions: true });
        void persistLastConfigNow(true);
    };

    const persistPresetByName = async (name, { clearNameInput = false } = {}) => {
        presets[name] = collectPresetConfig();
        const result = await writePresets(localStorage, requestJson, presets);
        refreshPresetOptions(presets, name);
        activePref = writeActivePresetPref(localStorage, {
            name,
            autoRemember: autoRememberCheckbox?.checked !== false,
        });
        applyPresetConfig(presets[name], name, {
            statusText: result.synced
                ? `Đã lưu preset “${name}” lên máy & Engine.`
                : `Đã lưu preset “${name}” trên trình duyệt.`,
        });
        void persistLastConfigNow(result.synced);
        if (clearNameInput) presetNameInput.value = '';
    };

    if (updatePresetBtn) {
        updatePresetBtn.onclick = async () => {
            const name = presetSelect.value;
            if (!name) return;
            await persistPresetByName(name);
        };
    }

    dialog.querySelector('#saveProcessPreset').onclick = async () => {
        const name = presetNameInput.value.trim();
        if (!name) {
            presetStatus.textContent = 'Hãy nhập tên preset mới trước.';
            presetNameInput.focus();
            return;
        }
        await persistPresetByName(name, { clearNameInput: true });
    };

    dialog.querySelector('#deleteProcessPreset').onclick = async () => {
        const name = presetSelect.value;
        if (!name || !presets[name]) return;
        delete presets[name];
        const result = await writePresets(localStorage, requestJson, presets);
        activePref = writeActivePresetPref(localStorage, {
            name: '',
            autoRemember: autoRememberCheckbox?.checked !== false,
        });
        refreshPresetOptions(presets);
        dialog._presetDirtySections.clear();
        presetStatus.textContent = result.synced
            ? `Đã xóa preset: ${name}`
            : `Đã xóa preset trên trình duyệt: ${name}`;
    };

    const saveSection = async (section, label) => {
        const name = presetSelect.value;
        const current = collectPresetConfig();
        if (name && presets[name]) {
            presets[name] = mergeSectionIntoConfig(presets[name], current, section);
            await writePresets(localStorage, requestJson, presets);
        }
        await writeLastConfig(localStorage, requestJson, {
            config: current,
            presetName: name,
        });
        dialog._presetDirtySections.delete(section);
        updatePresetDirtyStatus();
        presetStatus.textContent = name
            ? `Đã lưu ${label} vào preset “${name}”.`
            : `Đã nhớ ${label} cho lần mở video sau.`;
    };
    dialog.querySelector('#saveSubSelection').onclick = () => saveSection('sub', 'vùng mờ sub');
    dialog.querySelector('#saveCustomSelection').onclick = () => saveSection('custom', 'vùng mờ tùy chỉnh');
    dialog.querySelector('#saveLogoSelection').onclick = () => saveSection('logo', 'logo');
    const rasterizeSvgToPngDataUrl = (svgDataUrl, targetSize = 512) => {
        if (!svgDataUrl || !/^data:image\/svg\+xml/i.test(svgDataUrl) || typeof window.Image !== 'function') {
            return Promise.resolve(svgDataUrl);
        }
        return new Promise((resolve) => {
            const img = new window.Image();
            img.onload = () => {
                try {
                    const w = img.naturalWidth > 0 ? img.naturalWidth : targetSize;
                    const h = img.naturalHeight > 0 ? img.naturalHeight : targetSize;
                    const scale = Math.max(1, Math.min(8, targetSize / Math.max(w, h)));
                    const c = document.createElement('canvas');
                    c.width = Math.max(64, Math.round(w * scale));
                    c.height = Math.max(64, Math.round(h * scale));
                    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                    resolve(c.toDataURL('image/png'));
                } catch {
                    resolve(svgDataUrl);
                }
            };
            img.onerror = () => resolve(svgDataUrl);
            img.src = svgDataUrl;
        });
    };

    dialog.querySelector('#processLogoFile').onchange = async event => {
        const file = event.target.files?.[0];
        if (!file) {
            dialog._logoData = null;
            dialog._logoFilename = null;
            logoAspectRatio = 1;
            syncLogoSavedBadge();
            syncLogoOverlay();
            dialog._scheduleSaveLastConfig?.();
            return;
        }
        let logoData = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        });
        if (!isCurrent()) return;
        let logoFilename = file.name;
        if (logoData && /^data:image\/svg\+xml/i.test(logoData)) {
            logoData = await rasterizeSvgToPngDataUrl(logoData);
            if (!isCurrent()) return;
            logoFilename = logoFilename.replace(/\.svg$/i, '.png');
        }
        dialog._logoData = logoData;
        dialog._logoFilename = logoFilename;
        logoSessionEnabled = true;
        if (logoMode.value !== 'custom') logoMode.value = 'custom';
        if (logoShape && logoShape.value !== 'rect') logoShape.value = 'rect';
        updateLogoFields();
        probeLogoRatioFromData(logoData, { ensureReasonableSize: true });
        dialog._scheduleSaveLastConfig?.();
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

    const copyrightCard = dialog.querySelector('#processCopyrightCard');
    const copyrightBadge = dialog.querySelector('#processCopyrightBadge');
    const copyrightMusicPill = dialog.querySelector('#processCopyrightMusicPill');
    const copyrightVisualPill = dialog.querySelector('#processCopyrightVisualPill');
    const copyrightMusicNote = dialog.querySelector('#processCopyrightMusicNote');
    const copyrightWarnings = dialog.querySelector('#processCopyrightWarnings');
    const copyrightScanBtn = dialog.querySelector('#processCopyrightScanBtn');
    const copyrightFixBtn = dialog.querySelector('#processCopyrightFixBtn');
    let latestAiCopyrightReport = null;

    const captureCopyrightPreviewFrame = () => {
        if (!preview || !preview.videoWidth || !preview.videoHeight) return null;
        try {
            const frame = document.createElement('canvas');
            const scale = Math.min(1, 960 / preview.videoWidth);
            frame.width = Math.max(1, Math.round(preview.videoWidth * scale));
            frame.height = Math.max(1, Math.round(preview.videoHeight * scale));
            frame.getContext('2d').drawImage(preview, 0, 0, frame.width, frame.height);
            return frame.toDataURL('image/jpeg', 0.78);
        } catch {
            return null;
        }
    };

    const collectCopyrightCheckPayload = ({ includeFrame = false } = {}) => {
        const origVol = Number(dialog.querySelector('#processOriginalVolume')?.value ?? 0.15);
        const hasBlurCoords = ['X', 'Y', 'Width', 'Height'].some(
            suffix => String(dialog.querySelector(`#processBlur${suffix}`)?.value || '').trim() !== '',
        );
        return {
            video_id: video.video_id,
            channel: video.channel || video.channel_key || 'default',
            title: video.title || video.video_id || '',
            description: video.description || '',
            url: video.url || '',
            track: video.track || video.music_title || '',
            artist: video.artist || video.music_author || '',
            license: video.license || '',
            mode,
            original_volume: Number.isFinite(origVol) ? origVol : 0.15,
            music_url: dialog.querySelector('#processMusicUrl')?.value || '',
            auto_brand_blur: Boolean(dialog.querySelector('#processAutoBrandBlur')?.checked),
            has_blur_region: hasBlurCoords,
            aspect_ratio: dialog.querySelector('#processAspectRatio')?.value || '',
            duration_seconds: Number(video.duration_seconds || video.duration || preview.duration || 0) || undefined,
            width: preview.videoWidth || sourceWidth || undefined,
            height: preview.videoHeight || sourceHeight || undefined,
            image_data: includeFrame ? captureCopyrightPreviewFrame() : null,
            preview_url: includeFrame ? (preview?.currentSrc || preview?.src || '') : '',
            fingerprintConfig: readCopyrightFingerprintConfig(localStorage),
        };
    };

    const renderCopyrightReport = (report) => {
        if (!copyrightCard || !report) return;
        copyrightCard.dataset.risk = report.overall_risk || 'low';
        if (copyrightBadge) {
            copyrightBadge.dataset.risk = report.overall_risk || 'low';
            copyrightBadge.innerHTML = `<i class="cr-status-dot"></i><span>${report.badge_label || 'An toàn'}</span>`;
        }
        const riskVi = level => (level === 'high' ? 'Nguy cơ cao' : level === 'medium' ? 'Cần lưu ý' : 'An toàn');
        if (copyrightMusicPill) {
            copyrightMusicPill.dataset.risk = report.music_risk || 'low';
            copyrightMusicPill.innerHTML = `${copyrightIconSvg('music', 13)}<span>Nhạc: ${riskVi(report.music_risk)} (${report.music_score || 0}%)</span>`;
        }
        if (copyrightVisualPill) {
            copyrightVisualPill.dataset.risk = report.visual_risk || 'low';
            copyrightVisualPill.innerHTML = `${copyrightIconSvg('film', 13)}<span>Hình ảnh: ${riskVi(report.visual_risk)} (${report.visual_score || 0}%)</span>`;
        }
        if (copyrightMusicNote) {
            const noteText = report.scan_note || report.detected_music || '';
            copyrightMusicNote.textContent = noteText ? `· ${noteText}` : '';
        }
        if (copyrightWarnings) {
            copyrightWarnings.replaceChildren();
            const items = [
                ...(Array.isArray(report.warnings) ? report.warnings : []),
                ...(Array.isArray(report.recommendations) ? report.recommendations.slice(0, 2) : []),
            ];
            items.slice(0, 4).forEach(msg => {
                const li = document.createElement('li');
                li.textContent = msg;
                copyrightWarnings.appendChild(li);
            });
        }
        if (copyrightFixBtn) {
            copyrightFixBtn.hidden = report.overall_risk === 'low' && mode === 'voiceover';
        }
    };

    const refreshCopyrightEvaluation = () => {
        const localReport = analyzeVideoCopyrightRisk(collectCopyrightCheckPayload());
        if (latestAiCopyrightReport?.ai_scanned) {
            renderCopyrightReport({
                ...localReport,
                detected_music: latestAiCopyrightReport.detected_music || localReport.detected_music,
                scan_note: latestAiCopyrightReport.scan_note || '',
                warnings: [
                    ...(Array.isArray(latestAiCopyrightReport.warnings) ? latestAiCopyrightReport.warnings.slice(0, 1) : []),
                    ...localReport.warnings,
                ],
            });
        } else {
            renderCopyrightReport(localReport);
        }
    };

    const secondarySubStatus = dialog.querySelector('#processSecondarySubStatus');
    const secondarySubPreviewList = dialog.querySelector('#processSecondarySubPreviewList');
    const autoSecondarySubBtn = dialog.querySelector('#processAutoSecondarySubBtn');
    const scanSecondarySubBtn = dialog.querySelector('#processScanSecondarySubBtn');
    const clearSecondarySubBtn = dialog.querySelector('#processClearSecondarySubBtn');

    const readSecondarySubRegion = () => {
        const read = suffix => Number(dialog.querySelector(`#processSecondarySub${suffix}`)?.value || '');
        const raw = ['X', 'Y', 'Width', 'Height'].map(read);
        if (!raw.every(Number.isFinite) || raw[2] <= 0 || raw[3] <= 0) return null;
        return { x: Math.max(0, raw[0]), y: Math.max(0, raw[1]), width: raw[2], height: raw[3] };
    };

    const renderSecondarySubPreview = () => {
        if (!secondarySubPreviewList) return;
        if (!secondarySubRows.length) {
            secondarySubPreviewList.hidden = true;
            secondarySubPreviewList.replaceChildren();
            return;
        }
        secondarySubPreviewList.hidden = false;
        secondarySubPreviewList.replaceChildren(
            ...secondarySubRows.slice(0, 20).map((row, idx) => {
                const item = document.createElement('div');
                item.className = 'process-secondary-sub-row';
                const time = document.createElement('small');
                time.textContent = `${Number(row.start || 0).toFixed(1)}s–${Number(row.end || 0).toFixed(1)}s`;
                const textInput = document.createElement('input');
                textInput.type = 'text';
                textInput.value = String(row.translated_text || row.text || '');
                textInput.setAttribute('aria-label', `Chữ phụ ${idx + 1}`);
                textInput.oninput = () => {
                    secondarySubRows[idx].translated_text = textInput.value;
                };
                item.append(time, textInput);
                return item;
            }),
        );
    };

    const scanSecondarySubRegion = async () => {
        const secRegion = readSecondarySubRegion();
        const { w: vidW, h: vidH } = resolveVideoPixelSpace();
        if (!secRegion || !vidW || !vidH) {
            if (secondarySubStatus) secondarySubStatus.textContent = 'Hãy kéo chọn vùng chữ phụ (No Voice) hoặc bấm AI dò vùng chữ phụ trước.';
            return [];
        }
        if (!video.downloaded) {
            if (secondarySubStatus) secondarySubStatus.textContent = 'Hãy bấm "Tải video để xem trước" trước khi quét chữ phụ.';
            return [];
        }
        if (scanSecondarySubBtn) {
            scanSecondarySubBtn.disabled = true;
            scanSecondarySubBtn.textContent = 'Đang quét & dịch…';
        }
        if (secondarySubStatus) secondarySubStatus.textContent = 'Đang đọc chữ phụ trong vùng đã chọn (chỉ tạo chữ dịch, không đọc Voice)…';
        try {
            const ocrRes = await requestJson(`/api/preview/subtitles/${encodeURIComponent(video.video_id)}`, {
                method: 'POST',
                timeoutMs: 15 * 60 * 1000,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    channel: video.channel || 'default',
                    region: {
                        x: Math.min(1, Math.max(0, secRegion.x / vidW)),
                        y: Math.min(1, Math.max(0, secRegion.y / vidH)),
                        width: Math.min(1, Math.max(0.02, secRegion.width / vidW)),
                        height: Math.min(1, Math.max(0.02, secRegion.height / vidH)),
                    },
                    language: dialog.querySelector('#processOcrLanguage')?.value || 'auto',
                    fps: Number(dialog.querySelector('#processOcrFps')?.value || 2),
                    min_confidence: Number(dialog.querySelector('#processOcrConfidence')?.value || 0.45),
                    parallelism: Number(dialog.querySelector('#processOcrParallelism')?.value || 2),
                    use_gpu: !!dialog.querySelector('#processOcrUseGpu')?.checked,
                }),
            });
            const lines = Array.isArray(ocrRes?.lines) ? ocrRes.lines.filter(l => l && String(l.text || '').trim()) : [];
            if (!lines.length) {
                secondarySubRows = [];
                renderSecondarySubPreview();
                if (secondarySubStatus) secondarySubStatus.textContent = 'Không thấy chữ nào trong vùng đã chọn.';
                return [];
            }
            const sourceLanguage = dialog.querySelector('#processOcrLanguage')?.value || 'auto';
            const targetLanguage = dialog.querySelector('#processTargetLanguage')?.value || 'vi';
            const translatedRows = [];
            for (let offset = 0; offset < lines.length; offset += 16) {
                const batch = lines.slice(offset, offset + 16);
                const transRes = (sourceLanguage !== 'auto' && sourceLanguage === targetLanguage)
                    ? { translations: batch.map(l => ({ id: l.id, text: l.text })) }
                    : await requestJson('/api/preview/subtitle-translation', {
                        method: 'POST',
                        timeoutMs: 180000,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            source_language: sourceLanguage,
                            target_language: targetLanguage,
                            translation_model: dialog.querySelector('#processTranslationModel')?.value || 'gemini-3.1-flash-lite',
                            lines: batch.map(l => ({ id: l.id, text: l.text })),
                        }),
                    });
                const map = new Map((transRes?.translations || []).map(item => [String(item.id), String(item.text || '').trim()]));
                batch.forEach(line => {
                    translatedRows.push({
                        start: Number(line.start || 0),
                        end: Number(line.end || 0),
                        text: String(line.text || '').trim(),
                        translated_text: map.get(String(line.id)) || String(line.text || '').trim(),
                    });
                });
            }
            secondarySubRows = translatedRows;
            renderSecondarySubPreview();
            if (secondarySubStatus) {
                secondarySubStatus.textContent = `Đã dịch ${translatedRows.length} câu chữ phụ (chỉ hiện chữ, không đọc Voice).`;
            }
            return translatedRows;
        } catch (err) {
            if (secondarySubStatus) secondarySubStatus.textContent = err?.message || 'Chưa quét được vùng chữ phụ.';
            return [];
        } finally {
            if (scanSecondarySubBtn) {
                scanSecondarySubBtn.disabled = false;
                scanSecondarySubBtn.innerHTML = `${uiIcon('captions', 15)} Quét &amp; dịch thử`;
            }
        }
    };

    if (autoSecondarySubBtn) {
        autoSecondarySubBtn.onclick = async () => {
            if (!preview.videoWidth || !video.downloaded) {
                if (secondarySubStatus) secondarySubStatus.textContent = 'Hãy tải video về máy trước khi AI dò vùng chữ phụ.';
                return;
            }
            const frameData = captureCopyrightPreviewFrame();
            if (!frameData) {
                if (secondarySubStatus) secondarySubStatus.textContent = 'Chưa chụp được khung hình. Hãy phát video tới đoạn có chữ phụ rồi thử lại.';
                return;
            }
            autoSecondarySubBtn.disabled = true;
            autoSecondarySubBtn.textContent = 'AI đang dò chữ phụ…';
            if (secondarySubStatus) secondarySubStatus.textContent = 'Đang nhờ Gemini Vision loại trừ vùng chữ chính và tìm vùng chữ phụ / chữ bay…';
            try {
                const mainBox = readBoxFromPrefix('processBlur');
                const mainZonePct = mainBox
                    ? {
                        x: Math.round((mainBox.x / preview.videoWidth) * 100),
                        y: Math.round((mainBox.y / preview.videoHeight) * 100),
                        w: Math.round((mainBox.width / preview.videoWidth) * 100),
                        h: Math.round((mainBox.height / preview.videoHeight) * 100),
                    }
                    : { x: 5, y: 70, w: 90, h: 26 };

                const res = await requestJson('/api/assistant', {
                    method: 'POST',
                    timeoutMs: 45000,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: `Vùng CHỮ CHÍNH (phụ đề chính) ĐÃ ĐƯỢC XÁC ĐỊNH ở vùng: x=${mainZonePct.x}%, y=${mainZonePct.y}%, width=${mainZonePct.w}%, height=${mainZonePct.h}%.\nHÃY BỎ QUA HOÀN TOÀN chữ nằm trong vùng chữ chính đó!\nChỉ tìm DÒNG CHỮ PHỤ / CHÚ THÍCH / THOẠI BAY CÒN LẠI nằm NGOÀI vùng chữ chính (ví dụ: ở góc trên, giữa màn hình, bên trái/phải, bảng hiệu, chú thích nhân vật). Trả về đúng 4 số phần trăm: x%, y%, width%, height% (ví dụ: 12, 10, 45, 12). Nếu ngoài vùng chữ chính ra không còn chữ nào khác, trả lời đúng chữ "khong_co".`,
                        kind: 'question',
                        mode: 'subtitle',
                        image_data: frameData,
                        video_context: {
                            title: video.title || video.video_id,
                            width: preview.videoWidth,
                            height: preview.videoHeight,
                        },
                    }),
                });
                const answer = String(res?.answer || '');
                const nums = answer.match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
                if (nums.length >= 4 && !/khong_co|không có/i.test(answer)) {
                    const [xp, yp, wp, hp] = nums;
                    const overlapX = Math.max(0, Math.min(xp + wp, mainZonePct.x + mainZonePct.w) - Math.max(xp, mainZonePct.x));
                    const overlapY = Math.max(0, Math.min(yp + hp, mainZonePct.y + mainZonePct.h) - Math.max(yp, mainZonePct.y));
                    const overlapRatio = (overlapX * overlapY) / Math.max(1, wp * hp);
                    if (overlapRatio > 0.55) {
                        if (secondarySubStatus) secondarySubStatus.textContent = 'AI chỉ thấy chữ nằm trong vùng chữ chính phía dưới, chưa thấy chữ phụ ở vị trí khác. Hãy tua tới đoạn có chữ bay rồi thử lại hoặc tự kéo vùng.';
                        return;
                    }
                    const rx = Math.round((Math.max(0, Math.min(95, xp)) / 100) * preview.videoWidth);
                    const ry = Math.round((Math.max(0, Math.min(95, yp)) / 100) * preview.videoHeight);
                    const rw = Math.round((Math.max(5, Math.min(100 - xp, wp)) / 100) * preview.videoWidth);
                    const rh = Math.round((Math.max(4, Math.min(100 - yp, hp)) / 100) * preview.videoHeight);
                    set('processSecondarySubX', rx);
                    set('processSecondarySubY', ry);
                    set('processSecondarySubWidth', rw);
                    set('processSecondarySubHeight', rh);
                    pickMode = 'sub_novoice';
                    syncPickButtons();
                    syncSelectionFromFields();
                    if (secondarySubStatus) secondarySubStatus.textContent = `AI đã chọn vùng chữ phụ ngoài vùng chính (${rx}, ${ry}, ${rw}×${rh}). Bấm "Quét & dịch thử" hoặc kéo chỉnh lại khung xanh dương.`;
                } else {
                    if (secondarySubStatus) secondarySubStatus.textContent = 'Ngoài vùng chữ chính ra AI chưa thấy chữ phụ ở khung hình này. Tua tới đoạn có chữ bay rồi thử lại hoặc tự kéo vùng.';
                }
            } catch (err) {
                if (secondarySubStatus) secondarySubStatus.textContent = err?.message || 'Chưa kết nối Gemini để AI tự dò vùng.';
            } finally {
                autoSecondarySubBtn.disabled = false;
                autoSecondarySubBtn.innerHTML = `${uiIcon('sparkles', 15)} AI dò vùng chữ phụ`;
            }
        };
    }

    if (scanSecondarySubBtn) {
        scanSecondarySubBtn.onclick = () => { void scanSecondarySubRegion(); };
    }
    if (clearSecondarySubBtn) {
        clearSecondarySubBtn.onclick = () => {
            ['X', 'Y', 'Width', 'Height'].forEach(s => set(`processSecondarySub${s}`, ''));
            secondarySubRows = [];
            renderSecondarySubPreview();
            if (pickMode === 'sub_novoice') {
                selectedRect = null;
                drawSelection();
            }
            if (secondarySubStatus) secondarySubStatus.textContent = 'Đã xóa vùng chữ phụ.';
        };
    }

    if (copyrightScanBtn) {
        copyrightScanBtn.onclick = async () => {
            if (!isCurrent()) return;
            copyrightScanBtn.disabled = true;
            copyrightScanBtn.innerHTML = `${copyrightIconSvg('scan', 14)}<span>Đang quét Nhạc &amp; Hình…</span>`;
            if (copyrightMusicNote) {
                copyrightMusicNote.textContent = '· Đang gửi AI Gemini phân tích bản quyền…';
            }
            try {
                const report = await checkVideoCopyrightWithEngine(requestJson, {
                    ...collectCopyrightCheckPayload({ includeFrame: true }),
                    use_ai: true,
                });
                if (!isCurrent()) return;
                latestAiCopyrightReport = report;
                renderCopyrightReport(report);
            } finally {
                if (isCurrent()) {
                    copyrightScanBtn.disabled = false;
                    copyrightScanBtn.innerHTML = `${copyrightIconSvg('scan', 14)}<span>Quét sâu Nhạc &amp; Hình (AI)</span>`;
                }
            }
        };
    }

    if (copyrightFixBtn) {
        copyrightFixBtn.onclick = () => {
            mode = 'voiceover';
            dialog.dataset.mode = 'voiceover';
            const modeBadge = dialog.querySelector('#processConfigMode');
            if (modeBadge) modeBadge.textContent = 'Voice + Vietsub';
            const voiceField = dialog.querySelector('#processVoiceField');
            if (voiceField) voiceField.style.display = '';
            set('processOriginalVolume', 0.05);
            dialog.querySelector('#processOriginalVolume')?.dispatchEvent(new Event('input', { bubbles: true }));
            dialog.querySelector('#processOriginalVolume')?.dispatchEvent(new Event('change', { bubbles: true }));
            set('processVoiceVolume', 1.15);
            dialog.querySelector('#processVoiceVolume')?.dispatchEvent(new Event('input', { bubbles: true }));
            dialog.querySelector('#processVoiceVolume')?.dispatchEvent(new Event('change', { bubbles: true }));
            const brandBlur = dialog.querySelector('#processAutoBrandBlur');
            if (brandBlur) {
                brandBlur.checked = true;
                brandBlur.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const antiReuse = dialog.querySelector('#processAntiReuse');
            if (antiReuse) {
                antiReuse.checked = true;
                antiReuse.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const vocalSep = dialog.querySelector('#processVocalSeparation');
            if (vocalSep) {
                vocalSep.checked = true;
                vocalSep.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const eraseSel = dialog.querySelector('#processEraseMode');
            if (eraseSel && eraseSel.value === 'blur') {
                eraseSel.value = 'delogo';
                eraseSel.dispatchEvent(new Event('change', { bubbles: true }));
            }
            outputSummary.refresh?.();
            refreshCopyrightEvaluation();
            if (copyrightMusicNote) {
                copyrightMusicNote.textContent = '· Đã bật Né Bản Quyền (Âm gốc 5% · Tách SFX · Delogo không mờ · Anti-Reuse).';
            }
            dialog._scheduleSaveLastConfig?.();
        };
    }

    const shortsQuickBtn = dialog.querySelector('#processShortsQuickBtn');
    if (shortsQuickBtn) {
        shortsQuickBtn.onclick = () => {
            set('processAspectRatio', '9:16');
            set('processSubtitleStyle', 'bold');
            set('processEraseMode', 'delogo');
            const antiReuse = dialog.querySelector('#processAntiReuse');
            if (antiReuse) antiReuse.checked = true;
            ['processAspectRatio', 'processSubtitleStyle', 'processEraseMode'].forEach(id => {
                dialog.querySelector(`#${id}`)?.dispatchEvent(new Event('change', { bubbles: true }));
            });
            outputSummary.refresh?.();
            refreshCopyrightEvaluation();
            dialog._scheduleSaveLastConfig?.();
            if (copyrightMusicNote) {
                copyrightMusicNote.textContent = '· Đã áp dụng nhanh Preset Shorts 9:16 Viral (Chữ Bold · Delogo · Anti-Reuse).';
            }
        };
    }

    configForm.addEventListener('change', refreshCopyrightEvaluation);
    configForm.addEventListener('input', refreshCopyrightEvaluation);
    refreshCopyrightEvaluation();

    dialog.querySelector('form').onsubmit = async event => {
        event.preventDefault();
        if (submitting || !isCurrent()) return;
        submitting = true;
        const submitButton = dialog.querySelector('#runProcessConfig');
        submitButton.disabled = true;
        configForm.setAttribute('aria-busy', 'true');
        try {
        if (!transcriptConfirmed) {
            const scanVideoSubtitles = transcriptSource?.value === 'video_subtitles';
            if (manualOcrRows.length && (!recognitionComplete || transcriptSignature !== currentTranscriptSignature())) { manualOcrRows = []; recognitionComplete = false; }
            if (scanVideoSubtitles && (dialog.dataset.previewState !== 'ready' || !preview.videoWidth || !selectedRect)) {
                inspector.select('ocr');
                if (ocrStatus) ocrStatus.textContent = 'Để quét phụ đề gắn trên hình, hãy tải video, chọn “Chọn vùng phụ đề trên video” và khoanh vùng trước.';
                return;
            }
            if (!manualOcrRows.length) {
                deletedTranscriptIds.clear();
                skipReviewRequested = false;
                previewAbortController = new AbortController();
                const originalButtonLabel = submitButton.textContent;
                submitButton.textContent = 'Đang nhận diện…';
                setReviewProgress(0, 0); setReviewProgress(1, 0); setReviewProgress(2, 0);
                if (reviewStatus) reviewStatus.textContent = scanVideoSubtitles
                    ? 'Đang đọc chữ phụ đề trong vùng đã chọn…'
                    : 'Đang nhận diện lời thoại từ âm thanh. Video dài có thể mất vài phút…';
                if (reviewConfirm) reviewConfirm.disabled = true;
                if (reviewSkip) reviewSkip.hidden = false;
                setReviewStage(0);
                translationReady = false;
                renderManualOcrRows('Đang nhận diện. Bản dịch tiếng Việt sẽ xuất hiện sau bước này.');
                void syncReviewPreview();
                reviewDialog.showModal();
                const recognitionStartedAt = Date.now();
                statusTimer = window.setInterval(() => {
                    if (!reviewStatus) return;
                    const elapsedSeconds = Math.floor((Date.now() - recognitionStartedAt) / 1000);
                    const elapsed = elapsedSeconds >= 60
                        ? `${Math.floor(elapsedSeconds / 60)} phút ${elapsedSeconds % 60} giây`
                        : `${elapsedSeconds} giây`;
                    reviewStatus.textContent = scanVideoSubtitles
                        ? `Local Engine đang quét phụ đề bằng OCR · ${elapsed}. Thời gian tùy độ dài video và FPS.`
                        : `Local Engine đang nhận diện lời thoại bằng Whisper · ${elapsed}. Các câu sẽ hiện dần khi được quét.`;
                }, 5000);
                try {
                    let result;
                    if (scanVideoSubtitles) {
                        result = await requestJson(`/api/preview/subtitles/${encodeURIComponent(video.video_id)}`, {
                            method: 'POST', timeoutMs: 30 * 60 * 1000,
                            signal: previewAbortController.signal,
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                channel: video.channel || 'default',
                                region: { x: selectedRect.x / preview.videoWidth, y: selectedRect.y / preview.videoHeight,
                                    width: selectedRect.width / preview.videoWidth, height: selectedRect.height / preview.videoHeight },
                                language: dialog.querySelector('#processOcrLanguage')?.value || 'auto',
                                fps: Number(dialog.querySelector('#processOcrFps')?.value || 2),
                                min_confidence: Number(dialog.querySelector('#processOcrConfidence')?.value || .45),
                                parallelism: Number(dialog.querySelector('#processOcrParallelism')?.value || 2),
                                use_gpu: !!dialog.querySelector('#processOcrUseGpu')?.checked,
                            }),
                        });
                        if (skipReviewRequested) return;
                        setReviewProgress(0, 100);
                    } else {
                        result = await requestJson(`/api/preview/transcript/${encodeURIComponent(video.video_id)}`, {
                            method: 'POST', timeoutMs: 30 * 60 * 1000,
                            signal: previewAbortController.signal,
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ channel: video.channel || 'default', source_language: dialog.querySelector('#processSourceLanguage')?.value || 'auto' }),
                        });
                        if (skipReviewRequested) return;
                        if (result.task_id) {
                            const taskPath = `/api/preview/transcript/${encodeURIComponent(video.video_id)}/${encodeURIComponent(result.task_id)}`;
                            let task = result;
                            while (task.status === 'processing') {
                                if (skipReviewRequested) return;
                                mergeLiveTranscriptLines(task.lines);
                                const percent = Number(task.progress) || 0;
                                setReviewProgress(0, percent);
                                const processed = Number(task.processed_seconds) || 0;
                                const total = Number(task.total_seconds) || Number(video.duration_seconds || video.duration) || 0;
                                const formatClock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
                                const positionText = total > 0 ? `Đã quét ${formatClock(processed)} / ${formatClock(total)}` : 'Đang đọc audio';
                                const lineCount = Number(task.line_count ?? task.lines?.length) || 0;
                                const elapsedSeconds = Math.floor((Date.now() - recognitionStartedAt) / 1000);
                                const elapsed = elapsedSeconds >= 60 ? `${Math.floor(elapsedSeconds / 60)} phút ${elapsedSeconds % 60} giây` : `${elapsedSeconds} giây`;
                                if (reviewStatus) reviewStatus.textContent = `${task.message || 'Đang nhận diện lời thoại'} · ${percent}% · ${lineCount} câu · ${positionText} · ${elapsed}`;
                                const positionLabel = reviewDialog?.querySelector('#processTranscriptScanPosition');
                                if (positionLabel) positionLabel.textContent = `${positionText} · ${percent}%`;
                                if (reviewPreview?.readyState >= 1 && processed > 1 && Math.abs(reviewPreview.currentTime - processed) > 3) {
                                    try { reviewPreview.currentTime = Math.max(0, processed - 0.2); } catch {}
                                }
                                task = await requestJson(taskPath, { method: 'GET', timeoutMs: 15000, signal: previewAbortController.signal });
                            }
                            if (skipReviewRequested) return;
                            mergeLiveTranscriptLines(task.lines);
                            if (task.status === 'error') throw new Error(task.error || 'Không nhận diện được lời thoại.');
                            result = task;
                        } else {
                            // Older Local Engine versions return all recognized lines in one response.
                            setReviewProgress(0, 100);
                        }
                    }
                    if (skipReviewRequested) return;
                    if (Array.isArray(result.lines) && !manualOcrRows.length) {
                        manualOcrRows = result.lines.map((line, index) => ({ ...line, id: Number(line.id ?? index + 1) }));
                    }
                    transcriptSignature = currentTranscriptSignature();
                    renderManualOcrRows();
                    if (!manualOcrRows.length) throw new Error('Không tìm thấy câu thoại/phụ đề để duyệt. Kiểm tra âm thanh hoặc thử OCR.');
                    setReviewProgress(0, 100); setReviewProgress(1, 0);
                    if (statusTimer) window.clearInterval(statusTimer);
                    recognitionComplete = true;
                    if (reviewStatus) reviewStatus.textContent = `${manualOcrRows.length} câu đã nhận diện bằng ${scanVideoSubtitles ? 'OCR' : 'Whisper'}. Đang chuẩn bị bản dịch tiếng Việt…`;
                    setReviewStage(1);
                    if (ocrStatus) ocrStatus.textContent = `Đã nhận diện ${manualOcrRows.length} câu. Bạn có thể sửa ở bước kiểm tra phụ đề.`;
                    await translateReviewRows();
                } catch (error) {
                    if (skipReviewRequested) return;
                    const message = ocrErrorMessage(error);
                    renderManualOcrRows('Chưa có câu thoại để duyệt. Kiểm tra lỗi phía trên, rồi thử lại hoặc bỏ qua bước kiểm tra.');
                    setReviewStage(-1);
                    if (reviewStatus) reviewStatus.textContent = `Chưa nhận diện được: ${message}`;
                    if (ocrStatus) ocrStatus.textContent = message;
                    if (reviewSkip) reviewSkip.hidden = false;
                } finally {
                    if (statusTimer) window.clearInterval(statusTimer);
                    submitButton.textContent = originalButtonLabel;
                }
                if (!manualOcrRows.length) return;
                return;
            }
            renderManualOcrRows();
            setReviewStage(1);
            if (reviewStatus) reviewStatus.textContent = `${manualOcrRows.length} câu đã nhận diện. Đang mở bản dịch để duyệt.`;
            void syncReviewPreview();
            reviewDialog.showModal();
            await translateReviewRows();
            return;
        }
        clearTimeout(lastConfigSaveTimer);
        if (autoRememberCheckbox?.checked !== false) {
            void writeLastConfig(localStorage, requestJson, {
                config: collectPresetConfig(),
                presetName: presetSelect?.value || '',
            });
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
        let logoFilename = logoFile?.name || dialog._logoFilename || null;
        if (logoData && /^data:image\/svg\+xml/i.test(logoData)) {
            logoData = await rasterizeSvgToPngDataUrl(logoData);
            if (!isCurrent()) return;
            dialog._logoData = logoData;
            if (logoFilename) logoFilename = logoFilename.replace(/\.svg$/i, '.png');
            dialog._logoFilename = logoFilename;
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
        const reviewedTranscript = manualOcrRows.length ? [...ocrLines.querySelectorAll('.process-ocr-line')].map(row => ({
            start: Number(row.querySelector('.ocr-line-start')?.value),
            end: Number(row.querySelector('.ocr-line-end')?.value),
            text: manualOcrRows[Number(row.dataset.index)]?.text || '',
            translated_text: row.querySelector('.ocr-line-translation')?.value.trim() || '',
        })).filter(line => line.text && line.translated_text && Number.isFinite(line.start) && Number.isFinite(line.end) && line.end > line.start) : [];
        const secSubRegion = readSecondarySubRegion();
        let finalSecondarySubtitles = secondarySubRows.filter(line => line && (line.translated_text || line.text));
        if (secSubRegion && !finalSecondarySubtitles.length && video.downloaded && (value('processOutputFormat') || 'video') !== 'srt') {
            finalSecondarySubtitles = await scanSecondarySubRegion();
        }
        const config = {
            preview_seconds: value('processPreviewSeconds') ? Number(value('processPreviewSeconds')) : null,
            subtitle_font_size: value('processFontSize') ? Number(value('processFontSize')) : null,
            source_language: value('processSourceLanguage') || 'auto',
            target_language: value('processTargetLanguage') || 'vi',
            translation_model: value('processTranslationModel') || 'gemini-3.1-flash-lite',
            transcript_source: value('processTranscriptSource') || 'audio',
            manual_transcript: reviewedTranscript.length ? reviewedTranscript : null,
            output_format: value('processOutputFormat') || 'video',
            ocr_language: value('processOcrLanguage') || 'auto',
            ocr_fps: Number(value('processOcrFps') || 2),
            ocr_min_confidence: Number(value('processOcrConfidence') || 0.45),
            ocr_parallelism: Number(value('processOcrParallelism') || 2),
            ocr_use_gpu: !!dialog.querySelector('#processOcrUseGpu')?.checked,
            boost_gpu: Boolean(dialog.querySelector('#processBoostGpu')?.checked || document.getElementById('boostGpuToggle')?.checked || dialog.querySelector('#processOcrUseGpu')?.checked),
            stability_mode: true,
            ocr_merge_similar: !!dialog.querySelector('#processOcrMergeSimilar')?.checked,
            ocr_similarity_threshold: Number(value('processOcrSimilarity') || 0.82),
            subtitle_style: value('processSubtitleStyle') || 'minimal',
            original_volume: Number(value('processOriginalVolume') || 0.15),
            voice_volume: Number(value('processVoiceVolume') || 1),
            tts_speed: Number(value('processTtsSpeed') || 1.00),
            voice: value('processVoice'),
            music_url: musicUrl || null,
            music_data: musicData,
            music_filename: musicFile?.name || null,
            music_volume: (() => {
                const selected = Number(value('processMusicVolume'));
                return Number.isFinite(selected) ? Math.min(2, Math.max(0, selected)) : 0.25;
            })(),
            auto_brand_blur: !!dialog.querySelector('#processAutoBrandBlur')?.checked,
            anti_reuse: !!dialog.querySelector('#processAntiReuse')?.checked,
            anti_reuse_zoom: 1.04,
            anti_reuse_speed: 1.03,
            anti_reuse_mirror: !!dialog.querySelector('#processAntiReuseMirror')?.checked,
            anti_reuse_color: !!dialog.querySelector('#processAntiReuseColor')?.checked,
            vocal_separation: !!dialog.querySelector('#processVocalSeparation')?.checked,
            blur_mode: value('processEraseMode') || 'blur',
            glossary: value('processGlossary')?.trim() || null,
            source_subtitle_mode: dialog.querySelector('#processSourceNoSub')?.checked ? 'none' : 'auto',
            aspect_ratio: value('processAspectRatio') || null,
            blur_preset: value('processBlurPreset') || null,
            logo_size: value('processLogoSize') ? Number(value('processLogoSize')) : null,
            logo_width: value('processLogoWidth') ? Number(value('processLogoWidth')) : null,
            logo_height: value('processLogoHeight') ? Number(value('processLogoHeight')) : null,
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
            secondary_sub_region: secSubRegion,
            secondary_sub_blur: !!dialog.querySelector('#processSecondarySubBlur')?.checked,
            secondary_sub_style: value('processSecondarySubStyle') || 'box',
            secondary_sub_font_size: value('processSecondarySubFontSize') ? Number(value('processSecondarySubFontSize')) : null,
            secondary_subtitles: finalSecondarySubtitles.length ? finalSecondarySubtitles : null,
            blur_intervals,
            logo_mode: value('processLogoMode') || 'none',
            logo_shape: value('processLogoShape') || 'rect',
            logo_path: value('processLogoPath') || null,
            logo_text: value('processLogoText') || null,
            logo_data: logoData,
            logo_filename: logoFilename,
            regenerate_voice: Boolean(video.has_voice_result && mode === 'voiceover'),
        };
        if (!isCurrent()) return;
        dialog.close();
        processVideo(video, card, config.output_format === 'srt' ? 'subtitle' : mode, config);
        } finally {
            submitting = false;
            submitButton.disabled = false;
            configForm.removeAttribute('aria-busy');
            maybeAutoContinueReview();
        }
    };
    outputSummary.refresh();
    dialog._renderSubtitleStylePreview?.();
    dialog.showModal();
    resetScrollPositions();
}
