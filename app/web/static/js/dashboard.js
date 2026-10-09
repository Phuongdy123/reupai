function escapeHtml(value) {
    return String(
        value ?? ''
    )
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}


function stageLabel(stage) {
    const value = String(
        stage || ''
    ).toLowerCase();

    const map = {
        queued: 'Hàng đợi',
        starting: 'Khởi động',
        download: 'Tải video',
        downloading: 'Tải video',
        audio: 'Tách audio',
        extract_audio: 'Tách audio',
        transcribe: 'Whisper',
        transcription: 'Whisper',
        whisper: 'Whisper',
        translate: 'Gemini Translate',
        translation: 'Gemini Translate',
        tts: 'Voice TTS',
        voice: 'Voice TTS',
        detect_subtitle: 'Nhận diện subtitle',
        subtitle_detect: 'Nhận diện subtitle',
        render: 'Render video',
        rendering: 'Render video',
        completed: 'Hoàn tất',
        failed: 'Lỗi'
    };

    return (
        map[value]
        || stage
        || 'Processing'
    );
}


function modeLabel(mode) {
    return (
        mode === 'voiceover'
        ? 'Voice AI'
        : 'Vietsub AI'
    );
}


function renderActiveJobs(jobs) {
    const root = (
        document.getElementById(
            'activeJobs'
        )
    );

    const count = (
        document.getElementById(
            'activeJobCount'
        )
    );

    const badge = (
        document.getElementById(
            'activeJobsBadge'
        )
    );

    count.textContent =
        String(jobs.length);

    badge.textContent =
        `${jobs.length} job`;

    if (!jobs.length) {
        root.innerHTML = `
            <div class="empty-state compact">
                Hiện không có pipeline nào đang chạy.
            </div>
        `;
        return;
    }

    root.innerHTML = (
        jobs.map(job => {
            const percent = Math.max(
                0,
                Math.min(
                    100,
                    Number(job.progress || 0)
                )
            );

            return `
                <article class="live-job">

                    <div class="live-job-head">

                        <div>
                            <strong>
                                ${escapeHtml(job.platform_video_id)}
                            </strong>

                            <span>
                                ${escapeHtml(modeLabel(job.mode))}
                                · ${escapeHtml(job.channel_key)}
                            </span>
                        </div>

                        <span class="status ${escapeHtml(job.status)}">
                            ${escapeHtml(job.status)}
                        </span>

                    </div>


                    <div class="live-job-stage">

                        <span>
                            ${escapeHtml(stageLabel(job.stage))}
                        </span>

                        <strong>
                            ${percent}%
                        </strong>

                    </div>


                    <div class="live-progress">
                        <div
                            class="live-progress-bar"
                            style="width:${percent}%"
                        ></div>
                    </div>

                </article>
            `;
        }).join('')
    );
}


async function refreshActiveJobs() {
    try {
        const response = await fetch(
            '/api/jobs/active',
            {
                cache: 'no-store'
            }
        );

        if (!response.ok) {
            return;
        }

        const data = (
            await response.json()
        );

        renderActiveJobs(
            data.jobs || []
        );

    } catch {
        // Keep dashboard usable if polling temporarily fails.
    }
}


refreshActiveJobs();

setInterval(
    refreshActiveJobs,
    2000
);
