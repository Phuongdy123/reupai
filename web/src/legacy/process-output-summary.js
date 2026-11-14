// Shows the current output settings without changing the processing configuration.
export function bindProcessOutputSummary(dialog, { mode, signal }) {
    const summary = dialog.querySelector('#processOutputSummary');
    const form = dialog.querySelector('form');
    if (!summary || signal?.aborted) return { refresh: () => {} };

    const value = id => dialog.querySelector(`#${id}`)?.value ?? '';
    const selectedLabel = (id, fallback = '') => {
        const select = dialog.querySelector(`#${id}`);
        return select?.selectedOptions?.[0]?.textContent?.trim().replace(/\s+/g, ' ') || fallback;
    };
    const write = (name, text) => {
        const field = summary.querySelector(`[data-output-summary="${name}"]`);
        if (field && field.textContent !== text) field.textContent = text;
    };
    const refresh = () => {
        if (signal?.aborted) return;
        const language = value('processSourceLanguage') || 'auto';
        const transcriptSource = value('processTranscriptSource') || 'audio';
        const sourceLabel = transcriptSource === 'video_subtitles'
            ? `Chữ trên video · ${value('processOcrLanguage') === 'auto' ? 'đa ngôn ngữ' : selectedLabel('processOcrLanguage', 'Tự nhận diện')}`
            : 'Tự nhận diện lời thoại';
        const languageLabel = language === 'auto'
            ? `${sourceLabel} → Tiếng Việt`
            : language === 'vi'
                ? `${sourceLabel} → Tiếng Việt`
                : `${sourceLabel} · ${selectedLabel('processSourceLanguage', language)} → Tiếng Việt`;
        const width = Number(value('processBlurWidth'));
        const height = Number(value('processBlurHeight'));
        const blurPreset = value('processBlurPreset');
        const speed = Number(value('processTtsSpeed'));
        const voice = selectedLabel('processVoice', 'Giọng mặc định').replace(/\s*\(mặc định\)\s*/gi, '').trim();
        const hasSelectedRegion = Number.isFinite(width) && width > 0
            && Number.isFinite(height) && height > 0;

        write('mode', value('processOutputFormat') === 'srt' ? 'Chỉ SRT' : mode === 'subtitle' ? 'Vietsub' : 'Vietsub + Voice');
        write('frame', value('processAspectRatio')
            ? selectedLabel('processAspectRatio', 'Giữ tỷ lệ gốc')
            : 'Giữ tỷ lệ gốc');
        write('language', languageLabel);
        write('voice', Number.isFinite(speed) && speed > 0 ? `${voice} · ${speed.toFixed(2)}x` : voice);
        write('style', selectedLabel('processSubtitleStyle', 'Minimal Clean'));
        write('duration', value('processPreviewSeconds')
            ? selectedLabel('processPreviewSeconds', 'Toàn bộ video')
            : 'Toàn bộ video');
        write('blur', dialog.querySelector('#processSourceNoSub')?.checked
            ? 'Không làm mờ'
            : hasSelectedRegion ? 'Vùng đã chọn'
                : blurPreset ? selectedLabel('processBlurPreset', 'Theo vị trí đã chọn') : 'Tự nhận diện');
        summary.querySelectorAll('[data-output-summary-row="voice"]').forEach(row => {
            const hidden = mode === 'subtitle' || value('processOutputFormat') === 'srt';
            if (row.hidden !== hidden) row.hidden = hidden;
        });
    };

    form?.addEventListener('input', refresh, { signal, capture: true });
    form?.addEventListener('change', refresh, { signal, capture: true });
    refresh();
    return { refresh };
}
