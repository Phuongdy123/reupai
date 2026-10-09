let currentVideos = [];
let currentSort = 'new';
let currentPage = 1;
let sourceTotal = null;
let totalPages = null;
let remoteHasMore = true;
let loadingPage = false;
const PAGE_SIZE = 10;
const pageCache = {};

// =========================================================
// V13 PERSISTENT LIBRARY STATE
// =========================================================

let currentView = 'source';
let savedSources = [];
let collections = [];
let seriesGroups = [];

const UI_STATE_KEY = 'reup.sources.v13';
const activePollKeys = new Set();

let uiStateTimer = null;
let serverStateTimer = null;

// =========================================================
// V13.1 MANUAL SELECTION / QUEUE
// =========================================================

const selectedVideoIds = new Set();
let batchRunning = false;


function escapeHtml(
    value
) {

    return String(
        value ?? ''
    )
    .replaceAll(
        '&',
        '&amp;'
    )
    .replaceAll(
        '<',
        '&lt;'
    )
    .replaceAll(
        '>',
        '&gt;'
    )
    .replaceAll(
        '"',
        '&quot;'
    )
    .replaceAll(
        "'",
        '&#039;'
    );
}


function formatViews(
    value
) {

    return (
        new Intl.NumberFormat(
            'vi-VN'
        )
        .format(
            Number(
                value
                || 0
            )
        )
    );
}


function formatDate(
    value
) {

    if (!value) {
        return '';
    }

    try {

        return (
            new Date(
                value
            )
            .toLocaleString(
                'vi-VN'
            )
        );

    } catch {

        return String(
            value
        );
    }
}


function coverUrl(
    url
) {

    if (!url) {
        return '';
    }

    return (
        '/api/cover?url='
        + encodeURIComponent(
            url
        )
    );
}


function getVideoById(
    videoId
) {

    return (
        currentVideos.find(
            item =>
                item.video_id
                === videoId
        )
    );
}


function getFilteredVideos() {

    const keyword = (
        document
        .getElementById(
            'searchInput'
        )
        .value
        .trim()
        .toLowerCase()
    );

    const status = (
        document
        .getElementById(
            'statusFilter'
        )
        .value
    );

    let videos = [
        ...currentVideos
    ];

    if (keyword) {

        videos = (
            videos.filter(
                video => {

                    const haystack = (
                        String(
                            video.title
                            || ''
                        )
                        + ' '
                        + String(
                            video.video_id
                            || ''
                        )
                    )
                    .toLowerCase();

                    return (
                        haystack.includes(
                            keyword
                        )
                    );
                }
            )
        );
    }

    if (
        status
        !== 'all'
    ) {

        videos = (
            videos.filter(
                video => {

                    if (
                        status
                        === 'not_downloaded'
                    ) {
                        return (
                            !video.downloaded
                        );
                    }

                    if (
                        status
                        === 'downloaded'
                    ) {
                        return (
                            !!video.downloaded
                        );
                    }

                    if (
                        status
                        === 'processing'
                    ) {
                        return (
                            !!video.processing
                        );
                    }

                    if (
                        status
                        === 'subtitle'
                    ) {
                        return (
                            !!video
                            .has_subtitle_result
                        );
                    }

                    if (
                        status
                        === 'voiceover'
                    ) {
                        return (
                            !!video
                            .has_voice_result
                        );
                    }

                    if (
                        status
                        === 'failed'
                    ) {
                        return (
                            video.db_status
                            === 'failed'
                        );
                    }

                    if (
                        status
                        === 'favorite'
                    ) {
                        return (
                            !!video.favorite
                        );
                    }

                    return true;
                }
            )
        );
    }

    if (
        currentSort
        === 'view'
    ) {

        videos.sort(
            (a, b) =>
                Number(
                    b.play_count
                    || 0
                )
                -
                Number(
                    a.play_count
                    || 0
                )
        );

    } else {

        videos.sort(
            (a, b) =>
                String(
                    b.published_at
                    || ''
                )
                .localeCompare(
                    String(
                        a.published_at
                        || ''
                    )
                )
        );
    }

    return videos;
}


function setSort(
    type
) {

    currentSort = type;

    renderVideos();
}


function resetAndRender() {

    renderVideos();
}


function refreshDisplay() {

    renderVideos();
}


function updateTotalPages() {

    if (
        Number.isFinite(
            sourceTotal
        )
        && sourceTotal >= 0
    ) {

        totalPages = Math.max(
            1,
            Math.ceil(
                sourceTotal
                / PAGE_SIZE
            )
        );

    } else {

        totalPages = null;
    }
}


function pageItems(
    current,
    total
) {

    if (
        !total
        || total <= 1
    ) {
        return [1];
    }

    if (
        total <= 9
    ) {

        return Array.from(
            {
                length: total
            },
            (
                _,
                index
            ) => index + 1
        );
    }

    const pages = new Set([
        1,
        2,
        total - 1,
        total,
        current - 2,
        current - 1,
        current,
        current + 1,
        current + 2,
    ]);

    const sorted = (
        Array.from(
            pages
        )
        .filter(
            page =>
                page >= 1
                && page <= total
        )
        .sort(
            (a, b) =>
                a - b
        )
    );

    const result = [];

    for (
        let index = 0;
        index < sorted.length;
        index++
    ) {

        if (
            index > 0
            && sorted[index]
                - sorted[index - 1]
                > 1
        ) {

            result.push(
                'dots'
            );
        }

        result.push(
            sorted[index]
        );
    }

    return result;
}


function renderPagination() {

    const root = (
        document
        .getElementById(
            'bottomPages'
        )
    );

    const pageInfo = (
        document
        .getElementById(
            'pageInfo'
        )
    );

    root.innerHTML =
        '';

    let effectiveTotalPages = (
        totalPages
    );

    if (
        !effectiveTotalPages
    ) {

        const cachedPages = (
            Object.keys(
                pageCache
            )
            .map(
                value =>
                    Number(
                        value
                    )
            )
            .filter(
                value =>
                    Number.isFinite(
                        value
                    )
            )
        );

        const highestCached = (
            cachedPages.length
            ? Math.max(
                ...cachedPages
            )
            : 1
        );

        effectiveTotalPages = (
            highestCached
            + (
                remoteHasMore
                ? 1
                : 0
            )
        );
    }

    effectiveTotalPages = Math.max(
        1,
        effectiveTotalPages
    );

    root.style.display =
        'flex';

    for (
        const item
        of pageItems(
            currentPage,
            effectiveTotalPages
        )
    ) {

        if (
            item === 'dots'
        ) {

            const dots = (
                document
                .createElement(
                    'span'
                )
            );

            dots.className =
                'bottom-page-dots';

            dots.textContent =
                '…';

            root.appendChild(
                dots
            );

            continue;
        }

        const button = (
            document
            .createElement(
                'button'
            )
        );

        button.className =
            (
                'bottom-page-btn'
                + (
                    Number(item)
                    === Number(currentPage)
                    ? ' active'
                    : ''
                )
            );

        button.dataset.page =
            String(
                item
            );

        button.textContent =
            String(
                item
            );

        button.disabled =
            loadingPage;

        button.onclick =
            () => loadPage(
                Number(
                    item
                )
            );

        root.appendChild(
            button
        );
    }

    const firstVideo = (
        (
            currentPage - 1
        )
        * PAGE_SIZE
        + 1
    );

    const lastVideo = (
        firstVideo
        + currentVideos.length
        - 1
    );

    if (
        Number.isFinite(
            sourceTotal
        )
    ) {

        pageInfo.textContent =
            (
                `Trang ${currentPage}`
                + ` / ${effectiveTotalPages}`
                + ` · video ${firstVideo}-${lastVideo}`
                + ` / ${sourceTotal}`
            );

    } else {

        pageInfo.textContent =
            (
                `Trang ${currentPage}`
                + ` · ${currentVideos.length} video`
            );
    }
}


function updateSourceInfo(
    extraMessage = ''
) {

    const info = (
        document
        .getElementById(
            'info'
        )
    );

    let text = (
        `Trang ${currentPage}`
    );

    if (
        Number.isFinite(
            sourceTotal
        )
    ) {

        text += (
            ` · tổng ${sourceTotal} video`
        );
    }

    if (
        extraMessage
    ) {

        text += (
            ` · ${extraMessage}`
        );
    }

    info.className =
        'info-line';

    info.textContent =
        text;
}


async function loadPage(
    page,
    force = false
) {

    page = Math.max(
        1,
        Number(
            page
        )
        || 1
    );

    if (
        totalPages
        && page > totalPages
    ) {
        page = totalPages;
    }

    if (
        !force
        && pageCache[
            page
        ]
    ) {

        currentPage =
            page;

        currentVideos = [
            ...pageCache[
                page
            ]
        ];

        renderVideos();

        updateSourceInfo(
            'đọc từ cache'
        );

        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });

        return;
    }

    if (
        loadingPage
    ) {
        return;
    }

    const sourceUrl = (
        document
        .getElementById(
            'sourceUrl'
        )
        .value
        .trim()
    );

    const info = (
        document
        .getElementById(
            'info'
        )
    );

    loadingPage =
        true;

    renderPagination();

    const startNumber = (
        (page - 1)
        * PAGE_SIZE
        + 1
    );

    const endNumber = (
        page
        * PAGE_SIZE
    );

    info.className =
        'info-line';

    info.textContent =
        (
            `Đang lấy trang ${page}`
            + ` · video ${startNumber}-${endNumber}...`
        );

    try {

        const response = (
            await fetch(
                '/api/videos/page',
                {
                    method:
                        'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({
                            url:
                                sourceUrl,

                            page:
                                page,

                            page_size:
                                PAGE_SIZE
                        })
                }
            )
        );

        const data = (
            await response.json()
        );

        if (
            !response.ok
        ) {

            throw new Error(
                data.detail
                || (
                    `Không lấy được trang ${page}.`
                )
            );
        }

        const videos = (
            data.videos
            || []
        );

        if (
            data.total
            !== null
            && data.total
            !== undefined
        ) {

            sourceTotal = Number(
                data.total
            );

            updateTotalPages();
        }

        remoteHasMore =
            !!data.has_more;

        if (
            videos.length
            === 0
        ) {

            if (
                !totalPages
                || page >= totalPages
            ) {

                remoteHasMore =
                    false;
            }

            throw new Error(
                `Trang ${page} không có video.`
            );
        }

        pageCache[
            page
        ] = videos;

        currentPage =
            page;

        currentVideos = [
            ...videos
        ];

        renderVideos();

        updateSourceInfo(
            data.from_cache
            ? 'cache SQLite'
            : 'Bilibili'
        );

        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });

    } catch (
        error
    ) {

        info.className =
            'info-line warning';

        info.textContent =
            (
                'Lỗi: '
                + error.message
            );

    } finally {

        loadingPage =
            false;

        renderPagination();
    }
}


async function loadVideos() {

    const sourceUrl = (
        document
        .getElementById(
            'sourceUrl'
        )
        .value
        .trim()
    );

    const info = (
        document
        .getElementById(
            'info'
        )
    );

    info.className =
        'info-line';

    info.textContent =
        'Đang đồng bộ nguồn và đếm tổng video...';

    currentPage =
        1;

    currentVideos =
        [];

    sourceTotal =
        null;

    totalPages =
        null;

    remoteHasMore =
        true;

    for (
        const key
        of Object.keys(
            pageCache
        )
    ) {

        delete pageCache[
            key
        ];
    }

    try {

        const response = (
            await fetch(
                '/api/videos',
                {
                    method:
                        'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({
                            url:
                                sourceUrl,

                            limit:
                                PAGE_SIZE
                        })
                }
            )
        );

        const data = (
            await response.json()
        );

        if (!response.ok) {

            throw new Error(
                data.detail
                || 'Không lấy được video.'
            );
        }

        sourceTotal = (
            data.total
            !== null
            && data.total
            !== undefined
            ? Number(
                data.total
            )
            : null
        );

        updateTotalPages();

        remoteHasMore = (
            data.has_more
            !== undefined
            ? !!data.has_more
            : true
        );

        const videos = (
            data.videos
            || []
        );

        // /api/videos có thể trả cả cache cũ.
        // Trang 1 chỉ lấy đúng 10 video đầu tiên.
        const pageOne = (
            videos.slice(
                0,
                PAGE_SIZE
            )
        );

        pageCache[
            1
        ] = pageOne;

        currentVideos = [
            ...pageOne
        ];

        currentPage =
            1;

        renderVideos();

        let extra = '';

        if (
            data.warning
        ) {

            extra =
                data.warning;
        }

        updateSourceInfo(
            extra
        );

    } catch (
        error
    ) {

        currentVideos = [];

        renderVideos();

        info.className =
            'info-line warning';

        info.textContent =
            'Lỗi: '
            + error.message;
    }
}


function renderVideos() {

    const root = (
        document
        .getElementById(
            'videos'
        )
    );

    const filtered = (
        getFilteredVideos()
    );

    root.innerHTML =
        '';

    if (
        filtered.length
        === 0
    ) {

        root.innerHTML = `
            <div class="empty">
                Không có video phù hợp ở trang này.
            </div>
        `;

        renderPagination();

        return;
    }

    for (
        const video
        of filtered
    ) {

        root.appendChild(
            buildCard(
                video
            )
        );
    }

    renderPagination();
}


function buildBadges(
    video
) {

    const badges = [];

    if (
        video.downloaded
    ) {

        badges.push(
            '<span class="badge ok">✓ Đã tải</span>'
        );

    } else {

        badges.push(
            '<span class="badge">Chưa tải</span>'
        );
    }

    if (
        video.has_subtitle_result
    ) {

        badges.push(
            '<span class="badge ok">🇻🇳 Vietsub</span>'
        );
    }

    if (
        video.has_voice_result
    ) {

        badges.push(
            '<span class="badge ok">🎙 Voice</span>'
        );
    }

    if (
        video.processing
    ) {

        badges.push(
            '<span class="badge work">⏳ Đang xử lý</span>'
        );
    }

    if (
        video.db_status
        === 'failed'
    ) {

        badges.push(
            '<span class="badge fail">Lỗi</span>'
        );
    }

    if (
        video.series_name
    ) {

        const episode = (
            video.episode_number
            !== null
            && video.episode_number
            !== undefined
            ? ` · P${video.episode_number}`
            : ''
        );

        badges.push(
            '<span class="badge series">'
            + ''
            + escapeHtml(
                video.series_name
            )
            + escapeHtml(
                episode
            )
            + '</span>'
        );
    }

    return (
        badges.join('')
    );
}


function buildCard(
    video
) {

    const card = (
        document.createElement(
            'div'
        )
    );

    card.className =
        'card compact-video-card';

    card.dataset.videoId =
        video.video_id;

    const channel = (
        video.channel_key
        || '2d_animation'
    );

    let resultButtons =
        '';

    if (
        video.has_subtitle_result
    ) {

        resultButtons += `
            <button
                class="secondary mini-result"
                data-result-mode="subtitle"
                title="Xem Vietsub"
            >
                ▶ SUB
            </button>
        `;
    }

    if (
        video.has_voice_result
    ) {

        resultButtons += `
            <button
                class="secondary mini-result"
                data-result-mode="voiceover"
                title="Xem bản lồng tiếng"
            >
                ▶ VOICE
            </button>
        `;
    }

    const checked = (
        selectedVideoIds.has(
            String(
                video.video_id
            )
        )
    );

    card.innerHTML = `

        <label
            class="select-box"
            title="Chọn video"
        >
            <input
                type="checkbox"
                class="video-select"
                ${checked ? 'checked' : ''}
            >
            <span></span>
        </label>

        <div class="cover-wrap compact-cover">

            <div class="cover-fallback">
                No image
            </div>

            <img
                class="cover"
                src="${escapeHtml(coverUrl(video.cover_url || ''))}"
                alt="${escapeHtml(video.title || '')}"
                loading="lazy"
                onerror="this.style.display='none'"
            >

        </div>


        <div class="content compact-content">

            <div class="compact-head">

                <div class="compact-title-wrap">

                    <div class="title compact-title">
                        ${escapeHtml(video.title || video.video_id)}
                    </div>

                    <div class="meta compact-meta">
                        ${escapeHtml(video.video_id)}
                        · ${formatViews(video.play_count)} views
                        ${
                            video.published_at
                            ? ' · '
                              + escapeHtml(
                                    formatDate(
                                        video.published_at
                                    )
                                )
                            : ''
                        }
                    </div>

                </div>

                <button
                    class="icon-button favorite-btn ${
                        video.favorite
                        ? 'is-favorite'
                        : ''
                    }"
                    title="${
                        video.favorite
                        ? 'Bỏ lưu'
                        : 'Lưu video'
                    }"
                    aria-label="Lưu video"
                >
                    ${
                        video.favorite
                        ? '♥'
                        : '♡'
                    }
                </button>

            </div>


            <div class="badges compact-badges">
                ${buildBadges(video)}
            </div>


            <div class="compact-actions">

                <button
                    class="green sub-btn compact-primary"
                >
                    Vietsub
                </button>

                <button
                    class="orange voice-btn compact-primary"
                >
                    Voice
                </button>

                ${resultButtons}

                <details class="more-menu">

                    <summary
                        title="Thao tác khác"
                        aria-label="Thao tác khác"
                    >
                        •••
                    </summary>

                    <div class="more-menu-panel">

                        <button
                            class="menu-action open-btn"
                        >
                            ↗ Mở video gốc
                        </button>

                        <button
                            class="menu-action download-btn"
                        >
                            ↓ Tải video gốc
                        </button>

                        <button
                            class="menu-action collection-add-btn"
                        >
                            ＋ Thêm vào danh mục
                        </button>

                        <div class="menu-divider"></div>

                        <label class="menu-channel-label">
                            Kênh xử lý

                            <select class="channel">
                                <option
                                    value="2d_animation"
                                    ${
                                        channel
                                        === '2d_animation'
                                        ? 'selected'
                                        : ''
                                    }
                                >
                                    2D Animation
                                </option>

                                <option
                                    value="3d_animation"
                                    ${
                                        channel
                                        === '3d_animation'
                                        ? 'selected'
                                        : ''
                                    }
                                >
                                    3D Animation
                                </option>

                                <option
                                    value="comedy"
                                    ${
                                        channel
                                        === 'comedy'
                                        ? 'selected'
                                        : ''
                                    }
                                >
                                    Comedy
                                </option>
                            </select>
                        </label>

                    </div>

                </details>

            </div>


            <div class="result-actions compact-result-actions"></div>


            <div class="progress-wrap">

                <div class="progress">
                    <div class="progress-bar"></div>
                </div>

                <div class="progress-text">
                    Chưa xử lý.
                </div>

                <div class="result-actions dynamic-results"></div>

                <div class="log"></div>

            </div>

        </div>
    `;


    card
    .querySelector(
        '.video-select'
    )
    .addEventListener(
        'change',
        event => {

            setVideoSelected(
                video.video_id,
                !!event.target.checked
            );
        }
    );


    card
    .querySelector(
        '.open-btn'
    )
    .onclick = () => {

        window.open(
            video.url,
            '_blank'
        );
    };


    card
    .querySelector(
        '.download-btn'
    )
    .onclick = () => {

        downloadVideo(
            video,
            card
        );
    };


    card
    .querySelector(
        '.sub-btn'
    )
    .onclick = () => {

        processVideo(
            video,
            card,
            'subtitle'
        );
    };


    card
    .querySelector(
        '.voice-btn'
    )
    .onclick = () => {

        processVideo(
            video,
            card,
            'voiceover'
        );
    };


    card
    .querySelector(
        '.favorite-btn'
    )
    .onclick = async () => {

        await toggleFavorite(
            video,
            card
        );
    };


    card
    .querySelector(
        '.collection-add-btn'
    )
    .onclick = async () => {

        await addVideoToSelectedCollection(
            video,
            card
        );

        const details = (
            card.querySelector(
                '.more-menu'
            )
        );

        if (details) {
            details.open =
                false;
        }
    };


    for (
        const button
        of card
        .querySelectorAll(
            '[data-result-mode]'
        )
    ) {

        button.onclick = () => {

            const mode = (
                button.dataset
                .resultMode
            );

            openPlayer(
                video,
                mode,
                card
                .querySelector(
                    '.channel'
                )
                .value
            );
        };
    }


    return card;
}


async function downloadVideo(
    video,
    card
) {

    const button = (
        card
        .querySelector(
            '.download-btn'
        )
    );

    const oldText = (
        button.textContent
    );

    button.disabled =
        true;

    button.textContent =
        'Đang tải...';

    try {

        const response = (
            await fetch(
                '/api/download',
                {
                    method:
                        'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({
                            url:
                                video.url,

                            video_id:
                                video.video_id
                        })
                }
            )
        );

        if (
            !response.ok
        ) {

            let message =
                'Tải video thất bại.';

            try {

                const data = (
                    await response.json()
                );

                message = (
                    data.detail
                    || message
                );

            } catch {}

            throw new Error(
                message
            );
        }

        const blob = (
            await response.blob()
        );

        const objectUrl = (
            URL.createObjectURL(
                blob
            )
        );

        const anchor = (
            document
            .createElement(
                'a'
            )
        );

        anchor.href =
            objectUrl;

        anchor.download =
            (
                video.video_id
                + '_source.mp4'
            );

        document.body.appendChild(
            anchor
        );

        anchor.click();

        anchor.remove();

        URL.revokeObjectURL(
            objectUrl
        );

        video.downloaded =
            true;

        button.textContent =
            '✓ Đã tải';

        renderVideos();

    } catch (
        error
    ) {

        alert(
            error.message
        );

        button.textContent =
            oldText;

    } finally {

        button.disabled =
            false;
    }
}


async function processVideo(
    video,
    card,
    mode
) {

    const channel = (
        card
        .querySelector(
            '.channel'
        )
        .value
    );

    const subButton = (
        card
        .querySelector(
            '.sub-btn'
        )
    );

    const voiceButton = (
        card
        .querySelector(
            '.voice-btn'
        )
    );

    const progressWrap = (
        card
        .querySelector(
            '.progress-wrap'
        )
    );

    const progressBar = (
        card
        .querySelector(
            '.progress-bar'
        )
    );

    const progressText = (
        card
        .querySelector(
            '.progress-text'
        )
    );

    const logBox = (
        card
        .querySelector(
            '.log'
        )
    );

    const dynamicResults = (
        card
        .querySelector(
            '.dynamic-results'
        )
    );

    subButton.disabled =
        true;

    voiceButton.disabled =
        true;

    progressWrap.style.display =
        'block';

    logBox.style.display =
        'none';

    dynamicResults.innerHTML =
        '';

    progressBar.style.width =
        '1%';

    progressText.textContent =
        (
            mode === 'subtitle'
            ? 'Đang khởi động Vietsub AI...'
            : 'Đang khởi động Voice AI...'
        );

    try {

        const response = (
            await fetch(
                '/api/process',
                {
                    method:
                        'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({
                            url:
                                video.url,

                            video_id:
                                video.video_id,

                            channel:
                                channel,

                            mode:
                                mode
                        })
                }
            )
        );

        const data = (
            await response.json()
        );

        if (
            !response.ok
        ) {

            throw new Error(
                data.detail
                || (
                    'Không khởi động '
                    + 'được pipeline.'
                )
            );
        }

        video.processing =
            true;

        saveUiState();

        await pollProcess(
            video,
            card,
            channel,
            mode
        );

    } catch (
        error
    ) {

        progressText.textContent =
            (
                'Lỗi: '
                + error.message
            );

        progressBar.style.width =
            '0%';

        subButton.disabled =
            false;

        voiceButton.disabled =
            false;

        video.processing =
            false;
    }
}


async function pollProcess(
    video,
    card,
    channel,
    mode
) {

    const subButton = (
        card
        .querySelector(
            '.sub-btn'
        )
    );

    const voiceButton = (
        card
        .querySelector(
            '.voice-btn'
        )
    );

    const progressBar = (
        card
        .querySelector(
            '.progress-bar'
        )
    );

    const progressText = (
        card
        .querySelector(
            '.progress-text'
        )
    );

    const logBox = (
        card
        .querySelector(
            '.log'
        )
    );

    const dynamicResults = (
        card
        .querySelector(
            '.dynamic-results'
        )
    );

    while (true) {

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    1500
                )
        );

        const url = (
            `/api/process/${encodeURIComponent(video.video_id)}`
            + `?channel=${encodeURIComponent(channel)}`
            + `&mode=${encodeURIComponent(mode)}`
        );

        const response = (
            await fetch(
                url
            )
        );

        const data = (
            await response.json()
        );

        if (
            !response.ok
        ) {

            throw new Error(
                data.detail
                || (
                    'Không đọc '
                    + 'được tiến độ.'
                )
            );
        }

        const percent = (
            Number(
                data.percent
                || 0
            )
        );

        progressBar.style.width =
            `${percent}%`;

        progressText.textContent =
            (
                `${percent}% · `
                + (
                    data.message
                    || data.stage
                    || ''
                )
            );

        if (
            data.log_tail
            && data.log_tail.length
        ) {

            logBox.style.display =
                'block';

            logBox.textContent =
                data.log_tail.join(
                    '\n'
                );

            logBox.scrollTop =
                logBox.scrollHeight;
        }

        if (
            data.status
            === 'completed'
        ) {

            progressBar.style.width =
                '100%';

            progressText.textContent =
                '100% · Hoàn tất';

            video.processing =
                false;

            if (
                mode
                === 'subtitle'
            ) {

                video.has_subtitle_result =
                    true;

            } else {

                video.has_voice_result =
                    true;
            }

            dynamicResults.innerHTML = `
                <button
                    class="secondary play-finished"
                >
                    ▶ Xem kết quả
                </button>

                <a
                    class="secondary download-finished"
                    style="
                        display:inline-block;
                        text-decoration:none;
                    "
                    href="/api/result/${encodeURIComponent(video.video_id)}?channel=${encodeURIComponent(channel)}&mode=${encodeURIComponent(mode)}"
                >
                    ↓ Tải kết quả
                </a>
            `;

            dynamicResults
            .querySelector(
                '.play-finished'
            )
            .onclick = () => {

                openPlayer(
                    video,
                    mode,
                    channel
                );
            };

            subButton.disabled =
                false;

            voiceButton.disabled =
                false;

            return;
        }

        if (
            data.status
            === 'failed'
        ) {

            video.processing =
                false;

            video.db_status =
                'failed';

            subButton.disabled =
                false;

            voiceButton.disabled =
                false;

            throw new Error(
                data.message
                || 'Pipeline thất bại.'
            );
        }
    }
}


function openPlayer(
    video,
    mode,
    channel
) {

    const modal = (
        document
        .getElementById(
            'playerModal'
        )
    );

    const player = (
        document
        .getElementById(
            'player'
        )
    );

    const title = (
        document
        .getElementById(
            'playerTitle'
        )
    );

    title.textContent =
        (
            (
                mode
                === 'subtitle'
                ? 'Vietsub'
                : 'Vietsub + Voice'
            )
            + ' · '
            + (
                video.title
                || video.video_id
            )
        );

    player.src = (
        `/api/stream/${encodeURIComponent(video.video_id)}`
        + `?channel=${encodeURIComponent(channel)}`
        + `&mode=${encodeURIComponent(mode)}`
    );

    modal.classList.add(
        'open'
    );

    player.load();

    player.play()
    .catch(
        () => {}
    );
}


function closePlayer() {

    const modal = (
        document
        .getElementById(
            'playerModal'
        )
    );

    const player = (
        document
        .getElementById(
            'player'
        )
    );

    player.pause();

    player.removeAttribute(
        'src'
    );

    player.load();

    modal.classList.remove(
        'open'
    );
}


function closePlayerIfBackdrop(
    event
) {

    if (
        event.target.id
        === 'playerModal'
    ) {

        closePlayer();
    }
}


document.addEventListener(
    'keydown',
    event => {

        if (
            event.key
            === 'Escape'
        ) {

            closePlayer();
        }
    }
);



// =========================================================
// V13 - SAVED SOURCES / DIRECT LINK / FAVORITES / COLLECTIONS
// =========================================================

function videoLibraryPayload(
    video
) {

    return {
        video_id:
            String(
                video.video_id
                || ''
            ),

        platform:
            String(
                video.platform
                || detectPlatformClient(
                    video.url
                    || ''
                )
                || 'unknown'
            ),

        url:
            String(
                video.url
                || ''
            ),

        title:
            String(
                video.title
                || ''
            ),

        cover_url:
            String(
                video.cover_url
                || ''
            ),

        source_id:
            (
                video.source_id
                ?? null
            ),

        source_name:
            (
                video.source_name
                ?? null
            ),

        channel_key:
            String(
                video.channel_key
                || '2d_animation'
            ),

        published_at:
            (
                video.published_at
                || null
            ),

        play_count:
            Number(
                video.play_count
                || 0
            ),

        like_count:
            Number(
                video.like_count
                || 0
            ),

        comment_count:
            Number(
                video.comment_count
                || 0
            ),

        share_count:
            Number(
                video.share_count
                || 0
            ),
    };
}


function detectPlatformClient(
    url
) {

    const value = String(
        url
        || ''
    ).toLowerCase();

    if (
        value.includes(
            'bilibili.com'
        )
        || value.includes(
            'b23.tv'
        )
    ) {
        return 'bilibili';
    }

    if (
        value.includes(
            'douyin.com'
        )
    ) {
        return 'douyin';
    }

    return 'unknown';
}


async function apiJson(
    url,
    options = {}
) {

    const response = (
        await fetch(
            url,
            options
        )
    );

    let data = {};

    try {

        data = (
            await response.json()
        );

    } catch {

        data = {};
    }

    if (!response.ok) {

        throw new Error(
            data.detail
            || (
                'HTTP '
                + response.status
            )
        );
    }

    return data;
}


function injectV13Styles() {

    if (
        document.getElementById(
            'v13Styles'
        )
    ) {
        return;
    }

    const style = (
        document.createElement(
            'style'
        )
    );

    style.id =
        'v13Styles';

    style.textContent = `
        :root {
            --ui-bg: #0b101a;
            --ui-panel: #111827;
            --ui-panel-2: #151d2c;
            --ui-panel-3: #1b2435;
            --ui-border: #263247;
            --ui-border-soft: rgba(148, 163, 184, .14);
            --ui-text: #f8fafc;
            --ui-muted: #94a3b8;
            --ui-muted-2: #64748b;
            --ui-accent: #7c6cff;
            --ui-accent-hover: #8c7fff;
            --ui-success: #1fb981;
            --ui-danger: #ef6461;
            --ui-radius: 14px;
            --ui-radius-sm: 10px;
            --ui-shadow: 0 14px 38px rgba(0, 0, 0, .28);
        }

        /* =====================================================
           GLOBAL CLEANUP
           ===================================================== */

        #v13Manager *,
        #batchBar *,
        .compact-video-card * {
            box-sizing: border-box;
        }

        input[type="checkbox"] {
            accent-color: var(--ui-accent);
        }

        .source-bar,
        .control-bar {
            gap: 8px !important;
        }

        .source-bar input,
        .control-bar input,
        .control-bar select {
            min-height: 42px !important;
            border-radius: 10px !important;
            border-color: var(--ui-border) !important;
            background: #0f1624 !important;
            box-shadow: none !important;
        }

        .source-bar input:focus,
        .control-bar input:focus,
        .control-bar select:focus {
            border-color: var(--ui-accent) !important;
            box-shadow: 0 0 0 3px rgba(124, 108, 255, .12) !important;
        }

        .source-bar button,
        .control-bar button,
        .toolbar button {
            min-height: 40px !important;
            border-radius: 10px !important;
            box-shadow: none !important;
        }

        .toolbar {
            gap: 6px !important;
            margin-top: 2px !important;
            margin-bottom: 8px !important;
        }

        .toolbar button {
            padding: 8px 12px !important;
            background: #182132 !important;
            border: 1px solid var(--ui-border) !important;
            color: #dce5f4 !important;
            font-size: 12px !important;
        }

        .toolbar button:hover {
            background: #202b40 !important;
            border-color: #36445e !important;
        }

        .info-line {
            font-size: 12px !important;
            color: var(--ui-muted) !important;
        }

        /* Turn the video area into a spacious 2-column admin grid. */
        #videos.grid {
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            gap: 12px !important;
            align-items: stretch !important;
        }

        /* =====================================================
           TOP TOOLBAR
           ===================================================== */

        .v13-manager {
            margin: 0 0 14px 0;
            padding: 9px 10px;
            border: 1px solid var(--ui-border-soft);
            border-radius: var(--ui-radius);
            background:
                linear-gradient(
                    180deg,
                    rgba(255, 255, 255, .018),
                    rgba(255, 255, 255, 0)
                ),
                var(--ui-panel);
            box-shadow: 0 8px 22px rgba(0, 0, 0, .12);
        }

        .v13-toolbar {
            display: flex;
            align-items: center;
            gap: 7px;
            flex-wrap: wrap;
        }

        .v13-toolbar-main {
            display: flex;
            align-items: center;
            gap: 7px;
            flex: 1 1 500px;
            min-width: 0;
        }

        .v13-toolbar-main select,
        #savedSourceSelect {
            flex: 1 1 260px;
            min-width: 220px;
            max-width: 420px;
            height: 38px !important;
            min-height: 38px !important;
            padding: 0 36px 0 12px !important;
            border: 1px solid var(--ui-border) !important;
            border-radius: 10px !important;
            background: #0e1522 !important;
            color: var(--ui-text) !important;
            font-size: 12.5px !important;
            outline: none;
        }

        #savedSourceSelect:focus {
            border-color: var(--ui-accent) !important;
            box-shadow: 0 0 0 3px rgba(124, 108, 255, .12) !important;
        }

        #openSavedSource,
        #selectVisibleBtn {
            height: 38px !important;
            min-height: 38px !important;
            padding: 0 12px !important;
            border: 1px solid var(--ui-border) !important;
            border-radius: 10px !important;
            background: #182132 !important;
            color: #e7edf8 !important;
            font-size: 12px !important;
            font-weight: 700 !important;
        }

        #openSavedSource:hover,
        #selectVisibleBtn:hover {
            background: #202b40 !important;
            border-color: #3a4964 !important;
        }

        .v13-view-label {
            display: inline-flex;
            align-items: center;
            height: 30px;
            padding: 0 10px;
            border-radius: 999px;
            border: 1px solid rgba(148, 163, 184, .12);
            background: rgba(148, 163, 184, .06);
            color: var(--ui-muted);
            font-size: 11px;
            font-weight: 650;
            white-space: nowrap;
        }

        /* =====================================================
           POPOVERS / DROPDOWNS
           ===================================================== */

        .compact-popover {
            position: relative;
        }

        .compact-popover > summary {
            list-style: none;
            display: inline-flex !important;
            align-items: center;
            justify-content: center;
            height: 38px;
            min-height: 38px;
            padding: 0 11px !important;
            border: 1px solid var(--ui-border) !important;
            border-radius: 10px !important;
            background: #182132 !important;
            color: #e7edf8 !important;
            font-size: 12px !important;
            font-weight: 700 !important;
            line-height: 1;
            cursor: pointer;
            user-select: none;
            white-space: nowrap;
            transition:
                background .15s ease,
                border-color .15s ease,
                transform .15s ease;
        }

        .compact-popover > summary:hover {
            background: #202b40 !important;
            border-color: #3a4964 !important;
        }

        .compact-popover[open] > summary {
            border-color: rgba(124, 108, 255, .7) !important;
            background: rgba(124, 108, 255, .13) !important;
        }

        .compact-popover > summary::-webkit-details-marker {
            display: none;
        }

        .compact-popover-panel {
            position: absolute;
            top: calc(100% + 8px);
            right: 0;
            z-index: 100;
            width: min(420px, calc(100vw - 36px));
            padding: 13px;
            border: 1px solid var(--ui-border);
            border-radius: 14px;
            background: #111827 !important;
            color: var(--ui-text) !important;
            box-shadow: var(--ui-shadow);
        }

        .compact-popover-panel.left {
            left: 0;
            right: auto;
        }

        .compact-popover-title {
            margin-bottom: 9px;
            color: #eef2ff;
            font-size: 12.5px;
            font-weight: 800;
        }

        .compact-row {
            display: flex;
            align-items: center;
            gap: 7px;
            margin-top: 8px;
            flex-wrap: wrap;
        }

        .compact-row:first-of-type {
            margin-top: 0;
        }

        .compact-row input,
        .compact-row select {
            flex: 1 1 150px;
            min-width: 0;
            min-height: 39px !important;
            height: 39px !important;
            border: 1px solid var(--ui-border) !important;
            border-radius: 9px !important;
            background: #0e1522 !important;
            color: var(--ui-text) !important;
            font-size: 12px !important;
        }

        .compact-row button {
            min-height: 38px !important;
            padding: 0 11px !important;
            border: 1px solid var(--ui-border) !important;
            border-radius: 9px !important;
            background: #1a2435 !important;
            color: #e7edf8 !important;
            font-size: 12px !important;
        }

        .compact-row button:hover {
            background: #222f45 !important;
        }

        .compact-help {
            margin-top: 9px;
            color: var(--ui-muted-2);
            font-size: 11px;
            line-height: 1.45;
        }

        /* =====================================================
           VIDEO CARD
           ===================================================== */

        .compact-video-card {
            position: relative;
            display: grid !important;
            grid-template-columns: 22px 156px minmax(0, 1fr);
            align-items: center;
            gap: 11px;
            min-height: 128px;
            padding: 11px !important;
            overflow: visible !important;
            border: 1px solid #243047 !important;
            border-radius: 14px !important;
            background:
                linear-gradient(
                    145deg,
                    rgba(255,255,255,.014),
                    rgba(255,255,255,0)
                ),
                #101725 !important;
            box-shadow: none !important;
            transition:
                transform .16s ease,
                border-color .16s ease,
                background .16s ease;
        }

        .compact-video-card:hover {
            transform: translateY(-1px);
            border-color: #34445f !important;
            background:
                linear-gradient(
                    145deg,
                    rgba(255,255,255,.025),
                    rgba(255,255,255,0)
                ),
                #121a29 !important;
        }

        .compact-video-card .compact-cover {
            width: 156px !important;
            height: 102px !important;
            min-height: 102px !important;
            aspect-ratio: auto !important;
            align-self: center;
            overflow: hidden;
            border: 1px solid rgba(148, 163, 184, .12);
            border-radius: 10px !important;
            background: #080d15;
        }

        .compact-video-card .compact-cover img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            transition: transform .22s ease;
        }

        .compact-video-card:hover .compact-cover img {
            transform: scale(1.018);
        }

        .compact-video-card .compact-content {
            min-width: 0;
            padding: 0 !important;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }

        .compact-head {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            min-width: 0;
        }

        .compact-title-wrap {
            flex: 1;
            min-width: 0;
        }

        .compact-title {
            margin: 0 !important;
            color: #f8fafc !important;
            font-size: 14px !important;
            font-weight: 760 !important;
            line-height: 1.38;
            letter-spacing: -.01em;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .compact-meta {
            margin-top: 4px;
            color: #708096 !important;
            font-size: 10.5px !important;
            line-height: 1.3;
        }

        .compact-badges {
            display: flex;
            gap: 5px;
            flex-wrap: wrap;
            min-height: 20px;
            margin-top: 7px !important;
        }

        .compact-badges .badge {
            padding: 4px 7px !important;
            border: 1px solid rgba(148, 163, 184, .10) !important;
            border-radius: 999px !important;
            background: rgba(148, 163, 184, .08) !important;
            color: #aebbd0 !important;
            font-size: 9.5px !important;
            font-weight: 700 !important;
            line-height: 1 !important;
        }

        .compact-badges .badge.ok {
            color: #71dfb2 !important;
            background: rgba(31, 185, 129, .08) !important;
            border-color: rgba(31, 185, 129, .14) !important;
        }

        .compact-badges .badge.processing {
            color: #b6adff !important;
            background: rgba(124, 108, 255, .09) !important;
            border-color: rgba(124, 108, 255, .18) !important;
        }

        .compact-badges .badge.fail {
            color: #ff9a98 !important;
            background: rgba(239, 100, 97, .08) !important;
            border-color: rgba(239, 100, 97, .14) !important;
        }

        .compact-badges .badge.series {
            max-width: 240px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .compact-actions {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-top: 8px;
            flex-wrap: wrap;
        }

        .compact-actions button,
        .compact-actions .more-menu > summary {
            height: 31px !important;
            min-height: 31px !important;
            padding: 0 10px !important;
            border-radius: 8px !important;
            font-size: 11px !important;
            font-weight: 750 !important;
            line-height: 1 !important;
            box-shadow: none !important;
        }

        .compact-actions .sub-btn {
            min-width: 72px;
            border: 1px solid transparent !important;
            background: var(--ui-accent) !important;
            color: #fff !important;
        }

        .compact-actions .sub-btn:hover {
            background: var(--ui-accent-hover) !important;
        }

        .compact-actions .voice-btn {
            min-width: 66px;
            border: 1px solid #344057 !important;
            background: #1b2536 !important;
            color: #eef2f7 !important;
        }

        .compact-actions .voice-btn:hover {
            background: #263249 !important;
        }

        .mini-result {
            min-width: auto !important;
            border: 1px solid rgba(31, 185, 129, .22) !important;
            background: rgba(31, 185, 129, .08) !important;
            color: #79dfb6 !important;
        }

        .icon-button {
            width: 31px;
            height: 31px;
            min-width: 31px;
            padding: 0 !important;
            display: inline-grid;
            place-items: center;
            border: 1px solid #2b374d !important;
            border-radius: 50% !important;
            background: #151e2d !important;
            color: #9aa8bc !important;
            font-size: 17px !important;
            line-height: 1;
            box-shadow: none !important;
        }

        .icon-button:hover {
            border-color: #495978 !important;
            color: #f1f5f9 !important;
            background: #1d283b !important;
        }

        .favorite-btn.is-favorite {
            border-color: rgba(124, 108, 255, .35) !important;
            background: rgba(124, 108, 255, .11) !important;
            color: #9b90ff !important;
        }

        .select-box {
            align-self: start;
            display: grid;
            place-items: center;
            width: 22px;
            height: 28px;
            margin-top: 0;
            cursor: pointer;
        }

        .select-box input {
            width: 15px;
            height: 15px;
            cursor: pointer;
        }

        /* =====================================================
           MORE MENU
           ===================================================== */

        .more-menu {
            position: relative;
        }

        .more-menu > summary {
            list-style: none;
            min-width: 34px !important;
            display: inline-grid !important;
            place-items: center;
            border: 1px solid #2e3a50 !important;
            background: #172031 !important;
            color: #98a7bc !important;
            cursor: pointer;
            user-select: none;
            letter-spacing: 1px;
        }

        .more-menu > summary:hover,
        .more-menu[open] > summary {
            color: #eef2ff !important;
            background: #222d41 !important;
            border-color: #43526d !important;
        }

        .more-menu > summary::-webkit-details-marker {
            display: none;
        }

        .more-menu-panel {
            position: absolute;
            right: 0;
            bottom: calc(100% + 7px);
            z-index: 90;
            width: 220px;
            padding: 7px;
            border: 1px solid var(--ui-border);
            border-radius: 11px;
            background: #111827 !important;
            color: var(--ui-text) !important;
            box-shadow: var(--ui-shadow);
        }

        .menu-action {
            width: 100%;
            min-height: 34px !important;
            display: block;
            margin: 0 !important;
            padding: 0 9px !important;
            border: 0 !important;
            border-radius: 7px !important;
            background: transparent !important;
            color: #dce5f1 !important;
            text-align: left;
            font-size: 11px !important;
        }

        .menu-action:hover {
            background: #1d2739 !important;
        }

        .menu-divider {
            height: 1px;
            margin: 6px 3px;
            background: rgba(148, 163, 184, .12);
        }

        .menu-channel-label {
            display: block;
            padding: 5px 4px 3px;
            color: var(--ui-muted);
            font-size: 10.5px;
        }

        .menu-channel-label select {
            width: 100%;
            min-height: 34px !important;
            height: 34px !important;
            margin-top: 5px;
            border: 1px solid var(--ui-border) !important;
            border-radius: 8px !important;
            background: #0e1522 !important;
            color: #e5edf8 !important;
            font-size: 11px !important;
        }

        .compact-video-card .channel-row,
        .compact-video-card .ai-actions,
        .compact-video-card > .actions {
            display: none !important;
        }

        .compact-video-card .progress-wrap {
            margin-top: 8px !important;
            padding: 8px !important;
            border-radius: 9px !important;
            background: rgba(148, 163, 184, .045) !important;
        }

        .compact-video-card .progress {
            height: 5px !important;
            border-radius: 999px !important;
            overflow: hidden;
            background: #202a3a !important;
        }

        .compact-video-card .progress-bar {
            border-radius: 999px !important;
            background: var(--ui-accent) !important;
        }

        .compact-video-card .progress-text {
            margin-top: 5px;
            color: var(--ui-muted) !important;
            font-size: 10.5px !important;
        }

        .compact-video-card .log {
            max-height: 90px !important;
            margin-top: 5px;
            color: #8190a6 !important;
            font-size: 9.8px !important;
        }

        /* =====================================================
           BATCH BAR
           ===================================================== */

        .batch-bar {
            position: fixed;
            left: 50%;
            bottom: 20px;
            transform: translateX(-50%);
            z-index: 140;
            display: none;
            align-items: center;
            gap: 6px;
            max-width: calc(100vw - 32px);
            padding: 7px;
            border: 1px solid #334159;
            border-radius: 13px;
            background: #111827 !important;
            color: #f8fafc !important;
            box-shadow: 0 18px 50px rgba(0, 0, 0, .42);
            backdrop-filter: blur(12px);
        }

        .batch-bar.open {
            display: flex;
        }

        .batch-count {
            min-width: 78px;
            padding: 0 6px;
            color: #dce5f2;
            font-size: 11.5px;
            font-weight: 800;
            white-space: nowrap;
        }

        .batch-progress {
            display: none;
            max-width: 180px;
            overflow: hidden;
            color: var(--ui-muted);
            font-size: 10.5px;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .batch-bar.running .batch-progress {
            display: inline-block;
        }

        .batch-bar button {
            height: 32px !important;
            min-height: 32px !important;
            padding: 0 10px !important;
            border: 1px solid #334159 !important;
            border-radius: 8px !important;
            background: #1a2435 !important;
            color: #e8eef8 !important;
            font-size: 11px !important;
            font-weight: 750 !important;
            white-space: nowrap;
            box-shadow: none !important;
        }

        .batch-bar #batchSubtitle {
            border-color: transparent !important;
            background: var(--ui-accent) !important;
            color: white !important;
        }

        .batch-bar #batchVoice {
            background: #222d41 !important;
        }

        .batch-bar button:hover {
            background: #27354c !important;
        }

        .batch-bar #batchSubtitle:hover {
            background: var(--ui-accent-hover) !important;
        }

        .batch-bar.running .batch-action {
            pointer-events: none;
            opacity: .52;
        }

        /* =====================================================
           RESPONSIVE
           ===================================================== */

        @media (max-width: 1180px) {
            #videos.grid {
                grid-template-columns: 1fr !important;
            }
        }

        @media (max-width: 760px) {

            .v13-toolbar-main {
                flex: 1 1 100%;
            }

            .v13-toolbar-main select,
            #savedSourceSelect {
                min-width: 0;
                max-width: none;
                flex: 1;
            }

            .v13-view-label {
                display: none;
            }

            .compact-video-card {
                grid-template-columns: 20px 104px minmax(0, 1fr);
                gap: 8px;
                min-height: 104px;
                padding: 9px !important;
            }

            .compact-video-card .compact-cover {
                width: 104px !important;
                height: 76px !important;
                min-height: 76px !important;
            }

            .compact-meta {
                display: none;
            }

            .compact-badges .badge.series {
                max-width: 150px;
            }

            .compact-actions {
                margin-top: 6px;
            }

            .compact-actions button,
            .compact-actions .more-menu > summary {
                height: 29px !important;
                min-height: 29px !important;
                padding: 0 8px !important;
            }

            .compact-popover-panel {
                position: fixed;
                left: 12px !important;
                right: 12px !important;
                top: 72px;
                width: auto;
                max-height: calc(100vh - 96px);
                overflow: auto;
            }

            .batch-bar {
                left: 10px;
                right: 10px;
                bottom: 10px;
                transform: none;
                overflow-x: auto;
                justify-content: flex-start;
            }
        }
    `;

    document.head.appendChild(
        style
    );
}


function ensureFavoriteFilter() {

    const select = (
        document.getElementById(
            'statusFilter'
        )
    );

    if (!select) {
        return;
    }

    if (
        !select.querySelector(
            'option[value="favorite"]'
        )
    ) {

        const option = (
            document.createElement(
                'option'
            )
        );

        option.value =
            'favorite';

        option.textContent =
            '♥ Đã lưu';

        select.appendChild(
            option
        );
    }
}


function ensureManagerPanel() {

    if (
        document.getElementById(
            'v13Manager'
        )
    ) {
        ensureBatchBar();
        return;
    }

    injectV13Styles();
    ensureFavoriteFilter();

    const sourceInput = (
        document.getElementById(
            'sourceUrl'
        )
    );

    if (!sourceInput) {
        return;
    }

    const manager = (
        document.createElement(
            'section'
        )
    );

    manager.id =
        'v13Manager';

    manager.className =
        'v13-manager';

    manager.innerHTML = `
        <div class="v13-toolbar">

            <div class="v13-toolbar-main">

                <select id="savedSourceSelect">
                    <option value="">
                        Chọn nguồn đã lưu
                    </option>
                </select>

                <button
                    type="button"
                    class="secondary"
                    id="openSavedSource"
                >
                    Mở nguồn
                </button>

                <button
                    type="button"
                    class="secondary"
                    id="selectVisibleBtn"
                    title="Chọn toàn bộ video đang hiển thị"
                >
                    Chọn trang
                </button>

            </div>

            <span
                id="v13ViewLabel"
                class="v13-view-label"
            >
                Nguồn hiện tại
            </span>


            <details class="compact-popover">

                <summary class="secondary">
                    Thêm nguồn
                </summary>

                <div class="compact-popover-panel">

                    <div class="compact-popover-title">
                        Lưu nguồn hiện tại
                    </div>

                    <div class="compact-row">
                        <input
                            id="saveSourceName"
                            type="text"
                            placeholder="Tên nguồn"
                        >

                        <select id="saveSourceChannel">
                            <option value="2d_animation">
                                2D Animation
                            </option>
                            <option value="3d_animation">
                                3D Animation
                            </option>
                            <option value="comedy">
                                Comedy
                            </option>
                        </select>
                    </div>

                    <div class="compact-row">
                        <label>
                            <input
                                id="saveSourceAuto"
                                type="checkbox"
                            >
                            Lưu tùy chọn auto cho nguồn
                        </label>
                    </div>

                    <div class="compact-row">
                        <button
                            type="button"
                            class="secondary"
                            id="saveCurrentSource"
                        >
                            Lưu nguồn
                        </button>

                        <button
                            type="button"
                            class="secondary"
                            id="deleteSavedSource"
                        >
                            Xóa nguồn đang chọn
                        </button>
                    </div>

                    <div
                        class="compact-help"
                        id="savedSourceInfo"
                    >
                        Sau khi lưu, lần sau chỉ cần chọn tên nguồn.
                    </div>

                </div>

            </details>


            <details class="compact-popover">

                <summary class="secondary">
                    Link video
                </summary>

                <div class="compact-popover-panel">

                    <div class="compact-popover-title">
                        Lấy một video từ link riêng
                    </div>

                    <div class="compact-row">
                        <input
                            id="directVideoUrl"
                            type="text"
                            placeholder="Dán link Bilibili hoặc Douyin..."
                        >
                    </div>

                    <div class="compact-row">
                        <select id="directVideoChannel">
                            <option value="2d_animation">
                                2D Animation
                            </option>
                            <option value="3d_animation">
                                3D Animation
                            </option>
                            <option value="comedy">
                                Comedy
                            </option>
                        </select>

                        <button
                            type="button"
                            class="secondary"
                            id="openDirectVideo"
                        >
                            Lấy video
                        </button>
                    </div>

                    <div class="compact-help">
                        Không ảnh hưởng nguồn kênh đang mở.
                    </div>

                </div>

            </details>


            <details class="compact-popover">

                <summary class="secondary">
                    Thư viện
                </summary>

                <div class="compact-popover-panel">

                    <div class="compact-popover-title">
                        Video đã lưu
                    </div>

                    <div class="compact-row">
                        <button
                            type="button"
                            class="secondary"
                            id="showFavorites"
                        >
                            Yêu thích
                        </button>
                    </div>

                    <div class="menu-divider"></div>

                    <div class="compact-popover-title">
                        Danh mục
                    </div>

                    <div class="compact-row">
                        <select id="collectionSelect">
                            <option value="">
                                Chọn danh mục
                            </option>
                        </select>

                        <button
                            type="button"
                            class="secondary"
                            id="openCollection"
                        >
                            Xem
                        </button>
                    </div>

                    <div class="compact-row">
                        <input
                            id="newCollectionName"
                            type="text"
                            placeholder="Tên danh mục mới"
                        >

                        <button
                            type="button"
                            class="secondary"
                            id="createCollection"
                        >
                            ＋ Tạo
                        </button>

                        <button
                            type="button"
                            class="secondary"
                            id="deleteCollection"
                        >
                            Xóa
                        </button>
                    </div>

                    <div class="menu-divider"></div>

                    <div class="compact-popover-title">
                        Series tự nhận diện
                    </div>

                    <div class="compact-row">
                        <select id="seriesSelect">
                            <option value="">
                                Chọn series
                            </option>
                        </select>

                        <button
                            type="button"
                            class="secondary"
                            id="openSeries"
                        >
                            Xem
                        </button>
                    </div>

                </div>

            </details>

        </div>
    `;

    let anchor = (
        sourceInput.closest(
            '.panel'
        )
        || sourceInput.closest(
            '.card'
        )
        || sourceInput.parentElement
    );

    if (
        anchor
        && anchor.parentElement
    ) {

        anchor.parentElement.insertBefore(
            manager,
            anchor
        );

    } else {

        document.body.insertBefore(
            manager,
            document.body.firstChild
        );
    }

    bindV13Manager();
    ensureBatchBar();
}


function updateViewLabel(
    label
) {

    const element = (
        document.getElementById(
            'v13ViewLabel'
        )
    );

    if (element) {

        element.textContent =
            label;
    }
}


async function loadSavedSources() {

    try {

        const data = (
            await apiJson(
                '/api/library/sources'
            )
        );

        savedSources = (
            data.sources
            || []
        );

        const select = (
            document.getElementById(
                'savedSourceSelect'
            )
        );

        if (!select) {
            return;
        }

        const previous = (
            select.value
            || (
                readUiState()
                ?.selectedSavedSource
                || ''
            )
        );

        select.innerHTML = `
            <option value="">
                Chọn nguồn đã lưu
            </option>
        `;

        for (
            const source
            of savedSources
        ) {

            const option = (
                document.createElement(
                    'option'
                )
            );

            option.value =
                String(
                    source.id
                );

            option.textContent =
                (
                    `${source.name}`
                    + ` · ${source.platform}`
                    + ` · ${Number(source.video_count || 0)} video`
                );

            option.dataset.url =
                source.profile_url;

            option.dataset.channel =
                source.channel_key
                || '2d_animation';

            select.appendChild(
                option
            );
        }

        if (
            previous
            && select.querySelector(
                `option[value="${CSS.escape(String(previous))}"]`
            )
        ) {

            select.value =
                String(
                    previous
                );
        }

        renderSavedSourceInfo();

    } catch (
        error
    ) {

        console.warn(
            'loadSavedSources:',
            error
        );
    }
}


function selectedSavedSource() {

    const select = (
        document.getElementById(
            'savedSourceSelect'
        )
    );

    if (!select) {
        return null;
    }

    const id = Number(
        select.value
        || 0
    );

    return (
        savedSources.find(
            item =>
                Number(
                    item.id
                )
                === id
        )
        || null
    );
}


function renderSavedSourceInfo() {

    const info = (
        document.getElementById(
            'savedSourceInfo'
        )
    );

    const source = (
        selectedSavedSource()
    );

    if (!info) {
        return;
    }

    if (!source) {

        info.textContent =
            'Sau khi lưu, lần sau chỉ cần chọn tên nguồn.';

        return;
    }

    info.textContent =
        (
            `${source.name}`
            + ` · ${source.platform}`
            + ` · channel ${source.channel_key}`
            + (
                source.auto_process
                ? ' · Auto ON'
                : ' · Auto OFF'
            )
            + ` · ${Number(source.video_count || 0)} video đã cache`
        );
}


async function saveCurrentSource() {

    const sourceUrl = (
        document
        .getElementById(
            'sourceUrl'
        )
        .value
        .trim()
    );

    if (!sourceUrl) {

        alert(
            'Chưa có link nguồn.'
        );

        return;
    }

    const platform = (
        detectPlatformClient(
            sourceUrl
        )
    );

    if (
        ![
            'bilibili',
            'douyin'
        ].includes(
            platform
        )
    ) {

        alert(
            'Nguồn phải là Bilibili hoặc Douyin.'
        );

        return;
    }

    const name = (
        document
        .getElementById(
            'saveSourceName'
        )
        .value
        .trim()
        || (
            platform
            === 'douyin'
            ? 'Douyin source'
            : 'Bilibili source'
        )
    );

    const channel = (
        document
        .getElementById(
            'saveSourceChannel'
        )
        .value
    );

    const autoProcess = (
        document
        .getElementById(
            'saveSourceAuto'
        )
        .checked
    );

    try {

        const data = (
            await apiJson(
                '/api/library/sources',
                {
                    method:
                        'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({
                            platform:
                                platform,

                            name:
                                name,

                            url:
                                sourceUrl,

                            channel:
                                channel,

                            auto_process:
                                autoProcess
                        })
                }
            )
        );

        await loadSavedSources();

        const select = (
            document.getElementById(
                'savedSourceSelect'
            )
        );

        if (
            data.source
            && select
        ) {

            select.value =
                String(
                    data.source.id
                );

            renderSavedSourceInfo();
        }

        saveUiState();

    } catch (
        error
    ) {

        alert(
            error.message
        );
    }
}


async function deleteSavedSource() {

    const source = (
        selectedSavedSource()
    );

    if (!source) {

        alert(
            'Chọn nguồn cần xóa.'
        );

        return;
    }

    if (
        !confirm(
            `Ẩn nguồn "${source.name}" khỏi danh sách theo dõi?`
        )
    ) {
        return;
    }

    try {

        await apiJson(
            `/api/library/sources/${encodeURIComponent(source.id)}`,
            {
                method:
                    'DELETE'
            }
        );

        await loadSavedSources();

        saveUiState();

    } catch (
        error
    ) {

        alert(
            error.message
        );
    }
}


async function openSavedSource() {

    const source = (
        selectedSavedSource()
    );

    if (!source) {

        alert(
            'Chọn một nguồn đã lưu.'
        );

        return;
    }

    const sourceInput = (
        document.getElementById(
            'sourceUrl'
        )
    );

    sourceInput.value =
        source.profile_url;

    currentView =
        'source';

    updateViewLabel(
        `Nguồn: ${source.name}`
    );

    await loadVideos();

    saveUiState();
}


async function inspectDirectVideo() {

    const input = (
        document.getElementById(
            'directVideoUrl'
        )
    );

    const channel = (
        document.getElementById(
            'directVideoChannel'
        )
        .value
    );

    const url = (
        input.value
        .trim()
    );

    if (!url) {

        alert(
            'Dán link video trước.'
        );

        return;
    }

    const button = (
        document.getElementById(
            'openDirectVideo'
        )
    );

    const oldText = (
        button.textContent
    );

    button.disabled =
        true;

    button.textContent =
        'Đang lấy...';

    try {

        const data = (
            await apiJson(
                '/api/library/direct/inspect',
                {
                    method:
                        'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({
                            url:
                                url,

                            channel:
                                channel
                        })
                }
            )
        );

        currentView =
            'direct';

        currentVideos = [
            data.video
        ];

        currentPage =
            1;

        sourceTotal =
            1;

        totalPages =
            1;

        remoteHasMore =
            false;

        await hydrateCurrentLibraryMeta();

        renderVideos();

        updateSourceInfo(
            'link video trực tiếp'
        );

        updateViewLabel(
            'Link video'
        );

        saveUiState();

        window.scrollTo({
            top:
                document
                .getElementById(
                    'videos'
                )
                ?.offsetTop
                || 0,

            behavior:
                'smooth'
        });

    } catch (
        error
    ) {

        alert(
            error.message
        );

    } finally {

        button.disabled =
            false;

        button.textContent =
            oldText;
    }
}


async function loadCollections() {

    try {

        const data = (
            await apiJson(
                '/api/library/collections'
            )
        );

        collections = (
            data.collections
            || []
        );

        const select = (
            document.getElementById(
                'collectionSelect'
            )
        );

        if (!select) {
            return;
        }

        const state = (
            readUiState()
        );

        const previous = (
            select.value
            || state
                ?.selectedCollection
            || ''
        );

        select.innerHTML = `
            <option value="">
                Chọn danh mục
            </option>
        `;

        for (
            const item
            of collections
        ) {

            const option = (
                document.createElement(
                    'option'
                )
            );

            option.value =
                String(
                    item.id
                );

            option.textContent =
                (
                    `${item.name}`
                    + ` · ${Number(item.video_count || 0)} video`
                );

            select.appendChild(
                option
            );
        }

        if (
            previous
            && select.querySelector(
                `option[value="${CSS.escape(String(previous))}"]`
            )
        ) {

            select.value =
                String(
                    previous
                );
        }

    } catch (
        error
    ) {

        console.warn(
            'loadCollections:',
            error
        );
    }
}


async function createCollectionUi() {

    const input = (
        document.getElementById(
            'newCollectionName'
        )
    );

    const name = (
        input.value
        .trim()
    );

    if (!name) {

        alert(
            'Nhập tên danh mục.'
        );

        return;
    }

    try {

        const data = (
            await apiJson(
                '/api/library/collections',
                {
                    method:
                        'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({
                            name:
                                name
                        })
                }
            )
        );

        input.value =
            '';

        await loadCollections();

        const select = (
            document.getElementById(
                'collectionSelect'
            )
        );

        if (
            data.collection
            && select
        ) {

            select.value =
                String(
                    data.collection.id
                );
        }

        saveUiState();

    } catch (
        error
    ) {

        alert(
            error.message
        );
    }
}


async function deleteCollectionUi() {

    const select = (
        document.getElementById(
            'collectionSelect'
        )
    );

    const id = Number(
        select.value
        || 0
    );

    if (!id) {

        alert(
            'Chọn danh mục cần xóa.'
        );

        return;
    }

    const item = (
        collections.find(
            value =>
                Number(
                    value.id
                )
                === id
        )
    );

    if (
        !confirm(
            `Xóa danh mục "${item?.name || id}"? Video gốc không bị xóa.`
        )
    ) {
        return;
    }

    try {

        await apiJson(
            `/api/library/collections/${encodeURIComponent(id)}`,
            {
                method:
                    'DELETE'
            }
        );

        await loadCollections();

        if (
            currentView
            === 'collection'
        ) {

            currentView =
                'source';
        }

        saveUiState();

    } catch (
        error
    ) {

        alert(
            error.message
        );
    }
}


async function toggleFavorite(
    video,
    card
) {

    const button = (
        card.querySelector(
            '.favorite-btn'
        )
    );

    button.disabled =
        true;

    try {

        const data = (
            await apiJson(
                '/api/library/favorites/toggle',
                {
                    method:
                        'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify(
                            videoLibraryPayload(
                                video
                            )
                        )
                }
            )
        );

        video.favorite =
            !!data.favorite;

        button.textContent =
            (
                video.favorite
                ? '♥'
                : '♡'
            );

        button.title =
            (
                video.favorite
                ? 'Bỏ lưu'
                : 'Lưu video'
            );

        button.classList.toggle(
            'is-favorite',
            video.favorite
        );

        await loadSeries();

        saveUiState();

        if (
            currentView
            === 'favorites'
            && !video.favorite
        ) {

            currentVideos = (
                currentVideos.filter(
                    item =>
                        item.video_id
                        !== video.video_id
                )
            );

            renderVideos();
        }

    } catch (
        error
    ) {

        alert(
            error.message
        );

    } finally {

        button.disabled =
            false;
    }
}


async function addVideoToSelectedCollection(
    video,
    card
) {

    const select = (
        document.getElementById(
            'collectionSelect'
        )
    );

    const collectionId = Number(
        select?.value
        || 0
    );

    if (!collectionId) {

        alert(
            'Chọn hoặc tạo một danh mục ở phía trên trước.'
        );

        return;
    }

    const button = (
        card.querySelector(
            '.collection-add-btn'
        )
    );

    const oldText = (
        button.textContent
    );

    button.disabled =
        true;

    button.textContent =
        'Đang thêm...';

    try {

        await apiJson(
            (
                '/api/library/collections/'
                + encodeURIComponent(
                    collectionId
                )
                + '/videos'
            ),
            {
                method:
                    'POST',

                headers: {
                    'Content-Type':
                        'application/json'
                },

                body:
                    JSON.stringify(
                        videoLibraryPayload(
                            video
                        )
                    )
            }
        );

        video.collection_ids = Array.from(
            new Set([
                ...(
                    video.collection_ids
                    || []
                ),
                collectionId
            ])
        );

        button.textContent =
            '✓ Đã thêm';

        await loadCollections();
        await loadSeries();

        saveUiState();

        setTimeout(
            () => {

                button.textContent =
                    oldText;

            },
            1200
        );

    } catch (
        error
    ) {

        alert(
            error.message
        );

        button.textContent =
            oldText;

    } finally {

        button.disabled =
            false;
    }
}


async function loadLibraryView(
    params,
    label
) {

    const query = (
        new URLSearchParams()
    );

    for (
        const [
            key,
            value
        ]
        of Object.entries(
            params
            || {}
        )
    ) {

        if (
            value !== null
            && value !== undefined
            && value !== ''
        ) {

            query.set(
                key,
                String(
                    value
                )
            );
        }
    }

    const data = (
        await apiJson(
            (
                '/api/library/videos'
                + (
                    query.toString()
                    ? '?'
                      + query.toString()
                    : ''
                )
            )
        )
    );

    currentVideos = (
        data.videos
        || []
    );

    currentPage =
        1;

    sourceTotal =
        currentVideos.length;

    totalPages =
        1;

    remoteHasMore =
        false;

    renderVideos();

    updateSourceInfo(
        label
    );

    updateViewLabel(
        label
    );

    saveUiState();
}


async function showFavorites() {

    currentView =
        'favorites';

    await loadLibraryView(
        {
            favorite:
                true
        },
        '♥ Video đã lưu'
    );
}


async function openCollectionUi() {

    const id = Number(
        document
        .getElementById(
            'collectionSelect'
        )
        .value
        || 0
    );

    if (!id) {

        alert(
            'Chọn danh mục.'
        );

        return;
    }

    const item = (
        collections.find(
            value =>
                Number(
                    value.id
                )
                === id
        )
    );

    currentView =
        'collection';

    await loadLibraryView(
        {
            collection_id:
                id
        },
        (
            ''
            + (
                item?.name
                || 'Danh mục'
            )
        )
    );
}


async function loadSeries() {

    try {

        const data = (
            await apiJson(
                '/api/library/series'
            )
        );

        seriesGroups = (
            data.series
            || []
        );

        const select = (
            document.getElementById(
                'seriesSelect'
            )
        );

        if (!select) {
            return;
        }

        const state = (
            readUiState()
        );

        const previous = (
            select.value
            || state
                ?.selectedSeries
            || ''
        );

        select.innerHTML = `
            <option value="">
                Series tự nhận diện
            </option>
        `;

        for (
            const item
            of seriesGroups
        ) {

            const option = (
                document.createElement(
                    'option'
                )
            );

            option.value =
                item.series_key;

            option.textContent =
                (
                    `${item.name}`
                    + ` · ${item.count} phần`
                );

            select.appendChild(
                option
            );
        }

        if (
            previous
            && Array.from(
                select.options
            ).some(
                option =>
                    option.value
                    === previous
            )
        ) {

            select.value =
                previous;
        }

    } catch (
        error
    ) {

        console.warn(
            'loadSeries:',
            error
        );
    }
}


async function openSeriesUi() {

    const key = (
        document
        .getElementById(
            'seriesSelect'
        )
        .value
    );

    if (!key) {

        alert(
            'Chọn series.'
        );

        return;
    }

    const item = (
        seriesGroups.find(
            value =>
                value.series_key
                === key
        )
    );

    currentView =
        'series';

    await loadLibraryView(
        {
            series:
                key
        },
        (
            ''
            + (
                item?.name
                || 'Series'
            )
        )
    );
}


async function hydrateCurrentLibraryMeta() {

    const ids = (
        currentVideos
        .map(
            item =>
                item.video_id
        )
        .filter(
            Boolean
        )
    );

    if (!ids.length) {
        return;
    }

    try {

        const data = (
            await apiJson(
                (
                    '/api/library/meta?ids='
                    + encodeURIComponent(
                        ids.join(
                            ','
                        )
                    )
                )
            )
        );

        const meta = (
            data.meta
            || {}
        );

        for (
            const video
            of currentVideos
        ) {

            const item = (
                meta[
                    video.video_id
                ]
                || {}
            );

            video.favorite =
                !!item.favorite;

            video.collection_ids =
                (
                    item.collection_ids
                    || []
                );
        }

    } catch (
        error
    ) {

        console.warn(
            'hydrateCurrentLibraryMeta:',
            error
        );
    }
}



// =========================================================
// V13.1 MULTI SELECT + MANUAL QUEUE
// =========================================================

function ensureBatchBar() {

    if (
        document.getElementById(
            'batchBar'
        )
    ) {
        renderBatchBar();
        return;
    }

    const bar = (
        document.createElement(
            'div'
        )
    );

    bar.id =
        'batchBar';

    bar.className =
        'batch-bar';

    bar.innerHTML = `
        <span
            class="batch-count"
            id="batchCount"
        >
            0 video
        </span>

        <span
            class="batch-progress"
            id="batchProgress"
        ></span>

        <button
            type="button"
            class="green batch-action"
            id="batchSubtitle"
        >
            Vietsub
        </button>

        <button
            type="button"
            class="orange batch-action"
            id="batchVoice"
        >
            Voice
        </button>

        <button
            type="button"
            class="secondary batch-action"
            id="batchCollection"
        >
            Danh mục
        </button>

        <button
            type="button"
            class="secondary batch-action"
            id="batchDownload"
        >
            Tải gốc
        </button>

        <button
            type="button"
            class="secondary"
            id="batchClear"
        >
            Bỏ chọn
        </button>
    `;

    document.body.appendChild(
        bar
    );

    document
    .getElementById(
        'batchSubtitle'
    )
    .onclick = () => {

        runSelectedQueue(
            'subtitle'
        );
    };


    document
    .getElementById(
        'batchVoice'
    )
    .onclick = () => {

        runSelectedQueue(
            'voiceover'
        );
    };


    document
    .getElementById(
        'batchCollection'
    )
    .onclick = () => {

        addSelectedToCollection();
    };


    document
    .getElementById(
        'batchDownload'
    )
    .onclick = () => {

        downloadSelectedVideos();
    };


    document
    .getElementById(
        'batchClear'
    )
    .onclick = () => {

        clearSelectedVideos();
    };

    renderBatchBar();
}


function selectedVideos() {

    return (
        currentVideos.filter(
            video =>
                selectedVideoIds.has(
                    String(
                        video.video_id
                    )
                )
        )
    );
}


function setVideoSelected(
    videoId,
    selected
) {

    const key = String(
        videoId
    );

    if (selected) {

        selectedVideoIds.add(
            key
        );

    } else {

        selectedVideoIds.delete(
            key
        );
    }

    renderBatchBar();
}


function clearSelectedVideos() {

    selectedVideoIds.clear();

    for (
        const checkbox
        of document.querySelectorAll(
            '.video-select'
        )
    ) {

        checkbox.checked =
            false;
    }

    renderBatchBar();
}


function selectVisibleVideos() {

    const cards = [
        ...document.querySelectorAll(
            '.compact-video-card'
        )
    ];

    if (!cards.length) {
        return;
    }

    const allSelected = (
        cards.every(
            card =>
                selectedVideoIds.has(
                    String(
                        card.dataset.videoId
                    )
                )
        )
    );

    for (
        const card
        of cards
    ) {

        const key = String(
            card.dataset.videoId
        );

        const checkbox = (
            card.querySelector(
                '.video-select'
            )
        );

        if (allSelected) {

            selectedVideoIds.delete(
                key
            );

            if (checkbox) {
                checkbox.checked =
                    false;
            }

        } else {

            selectedVideoIds.add(
                key
            );

            if (checkbox) {
                checkbox.checked =
                    true;
            }
        }
    }

    renderBatchBar();
}


function renderBatchBar(
    message = ''
) {

    const bar = (
        document.getElementById(
            'batchBar'
        )
    );

    if (!bar) {
        return;
    }

    const count = (
        selectedVideoIds.size
    );

    bar.classList.toggle(
        'open',
        count > 0
    );

    bar.classList.toggle(
        'running',
        batchRunning
    );

    const countElement = (
        document.getElementById(
            'batchCount'
        )
    );

    if (countElement) {

        countElement.textContent =
            (
                `${count} video`
            );
    }

    const progress = (
        document.getElementById(
            'batchProgress'
        )
    );

    if (progress) {

        progress.textContent =
            message;
    }

    const selectButton = (
        document.getElementById(
            'selectVisibleBtn'
        )
    );

    if (selectButton) {

        const cards = [
            ...document.querySelectorAll(
                '.compact-video-card'
            )
        ];

        const allSelected = (
            cards.length > 0
            && cards.every(
                card =>
                    selectedVideoIds.has(
                        String(
                            card.dataset.videoId
                        )
                    )
            )
        );

        selectButton.textContent =
            (
                allSelected
                ? 'Bỏ chọn trang'
                : 'Chọn trang'
            );
    }
}


async function runSelectedQueue(
    mode
) {

    if (batchRunning) {
        return;
    }

    const videos = (
        selectedVideos()
    );

    if (!videos.length) {
        return;
    }

    batchRunning =
        true;

    renderBatchBar(
        `0/${videos.length}`
    );

    try {

        // Co y chay TUAN TU:
        // mot video xong moi den video ke.
        // Tranh CPU/GPU/RAM bi tranh chap.
        for (
            let index = 0;
            index < videos.length;
            index += 1
        ) {

            const video = (
                videos[
                    index
                ]
            );

            renderBatchBar(
                (
                    `${index + 1}/${videos.length}`
                    + ` · ${video.video_id}`
                )
            );

            let card = (
                document.querySelector(
                    `.compact-video-card[data-video-id="${CSS.escape(String(video.video_id))}"]`
                )
            );

            if (!card) {

                renderVideos();

                card = (
                    document.querySelector(
                        `.compact-video-card[data-video-id="${CSS.escape(String(video.video_id))}"]`
                    )
                );
            }

            if (!card) {
                continue;
            }

            try {

                await processVideo(
                    video,
                    card,
                    mode
                );

            } catch (
                error
            ) {

                console.warn(
                    'Batch process:',
                    video.video_id,
                    error
                );
            }
        }

    } finally {

        batchRunning =
            false;

        renderBatchBar(
            'Hoàn tất'
        );

        setTimeout(
            () => {

                renderBatchBar();

            },
            1200
        );

        await hydrateCurrentLibraryMeta();

        saveUiState();
    }
}


async function addSelectedToCollection() {

    const collectionId = Number(
        document
        .getElementById(
            'collectionSelect'
        )
        ?.value
        || 0
    );

    if (!collectionId) {

        alert(
            'Chọn danh mục trong menu Thư viện trước.'
        );

        return;
    }

    const videos = (
        selectedVideos()
    );

    if (!videos.length) {
        return;
    }

    batchRunning =
        true;

    renderBatchBar(
        `0/${videos.length}`
    );

    try {

        for (
            let index = 0;
            index < videos.length;
            index += 1
        ) {

            const video = (
                videos[
                    index
                ]
            );

            renderBatchBar(
                `${index + 1}/${videos.length}`
            );

            await apiJson(
                (
                    '/api/library/collections/'
                    + encodeURIComponent(
                        collectionId
                    )
                    + '/videos'
                ),
                {
                    method:
                        'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify(
                            videoLibraryPayload(
                                video
                            )
                        )
                }
            );

            video.collection_ids = Array.from(
                new Set([
                    ...(
                        video.collection_ids
                        || []
                    ),
                    collectionId
                ])
            );
        }

        await loadCollections();
        await loadSeries();

    } catch (
        error
    ) {

        alert(
            error.message
        );

    } finally {

        batchRunning =
            false;

        renderBatchBar(
            'Đã thêm'
        );

        setTimeout(
            () => {

                renderBatchBar();

            },
            1000
        );
    }
}


async function downloadSelectedVideos() {

    const videos = (
        selectedVideos()
    );

    if (!videos.length) {
        return;
    }

    batchRunning =
        true;

    renderBatchBar(
        `0/${videos.length}`
    );

    try {

        for (
            let index = 0;
            index < videos.length;
            index += 1
        ) {

            const video = (
                videos[
                    index
                ]
            );

            renderBatchBar(
                (
                    `${index + 1}/${videos.length}`
                    + ` · tải gốc`
                )
            );

            const card = (
                document.querySelector(
                    `.compact-video-card[data-video-id="${CSS.escape(String(video.video_id))}"]`
                )
            );

            if (!card) {
                continue;
            }

            await downloadVideo(
                video,
                card
            );

            // Nghi ngan de browser xu ly lan download truoc.
            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        350
                    )
            );
        }

    } finally {

        batchRunning =
            false;

        renderBatchBar(
            'Hoàn tất'
        );

        setTimeout(
            () => {

                renderBatchBar();

            },
            1000
        );
    }
}


function bindV13Manager() {

    const bind = (
        id,
        event,
        handler
    ) => {

        const element = (
            document.getElementById(
                id
            )
        );

        if (element) {

            element.addEventListener(
                event,
                handler
            );
        }
    };

    bind(
        'selectVisibleBtn',
        'click',
        () => {
            selectVisibleVideos();
        }
    );

    bind(
        'savedSourceSelect',
        'change',
        () => {
            renderSavedSourceInfo();
            saveUiState();
        }
    );

    bind(
        'openSavedSource',
        'click',
        () => {
            openSavedSource();
        }
    );

    bind(
        'saveCurrentSource',
        'click',
        () => {
            saveCurrentSource();
        }
    );

    bind(
        'deleteSavedSource',
        'click',
        () => {
            deleteSavedSource();
        }
    );

    bind(
        'openDirectVideo',
        'click',
        () => {
            inspectDirectVideo();
        }
    );

    bind(
        'showFavorites',
        'click',
        () => {
            showFavorites();
        }
    );

    bind(
        'createCollection',
        'click',
        () => {
            createCollectionUi();
        }
    );

    bind(
        'deleteCollection',
        'click',
        () => {
            deleteCollectionUi();
        }
    );

    bind(
        'openCollection',
        'click',
        () => {
            openCollectionUi();
        }
    );

    bind(
        'openSeries',
        'click',
        () => {
            openSeriesUi();
        }
    );

    bind(
        'collectionSelect',
        'change',
        () => {
            saveUiState();
        }
    );

    bind(
        'seriesSelect',
        'change',
        () => {
            saveUiState();
        }
    );

    for (
        const details
        of document.querySelectorAll(
            '#v13Manager .compact-popover'
        )
    ) {

        details.addEventListener(
            'toggle',
            () => {

                if (!details.open) {
                    return;
                }

                for (
                    const other
                    of document.querySelectorAll(
                        '#v13Manager .compact-popover'
                    )
                ) {

                    if (
                        other !== details
                    ) {

                        other.open =
                            false;
                    }
                }
            }
        );
    }

    bind(
        'directVideoUrl',
        'change',
        () => {
            saveUiState();
        }
    );

    bind(
        'directVideoChannel',
        'change',
        () => {
            saveUiState();
        }
    );

    const directInput = (
        document.getElementById(
            'directVideoUrl'
        )
    );

    if (directInput) {

        directInput.addEventListener(
            'keydown',
            event => {

                if (
                    event.key
                    === 'Enter'
                ) {

                    event.preventDefault();
                    inspectDirectVideo();
                }
            }
        );
    }
}


// =========================================================
// PERSISTENT UI STATE
// =========================================================

function buildUiState() {

    const sourceUrl = (
        document
        .getElementById(
            'sourceUrl'
        )
        ?.value
        ?.trim()
        || ''
    );

    const search = (
        document
        .getElementById(
            'searchInput'
        )
        ?.value
        || ''
    );

    const status = (
        document
        .getElementById(
            'statusFilter'
        )
        ?.value
        || 'all'
    );

    return {
        version:
            13,

        currentView:
            currentView,

        sourceUrl:
            sourceUrl,

        currentPage:
            currentPage,

        sourceTotal:
            sourceTotal,

        totalPages:
            totalPages,

        remoteHasMore:
            remoteHasMore,

        currentSort:
            currentSort,

        search:
            search,

        status:
            status,

        selectedSavedSource:
            (
                document
                .getElementById(
                    'savedSourceSelect'
                )
                ?.value
                || ''
            ),

        selectedCollection:
            (
                document
                .getElementById(
                    'collectionSelect'
                )
                ?.value
                || ''
            ),

        selectedSeries:
            (
                document
                .getElementById(
                    'seriesSelect'
                )
                ?.value
                || ''
            ),

        directVideoUrl:
            (
                document
                .getElementById(
                    'directVideoUrl'
                )
                ?.value
                || ''
            ),

        directVideoChannel:
            (
                document
                .getElementById(
                    'directVideoChannel'
                )
                ?.value
                || '2d_animation'
            ),

        scrollY:
            window.scrollY
            || 0,

        selectedVideoIds:
            [
                ...selectedVideoIds
            ],

        // Snapshot ngan gon: source page chi 10 video,
        // library view gioi han 100 de localStorage khong phinh.
        currentVideos:
            currentVideos.slice(
                0,
                100
            )
    };
}


function readUiState() {

    try {

        const raw = (
            localStorage.getItem(
                UI_STATE_KEY
            )
        );

        if (!raw) {
            return null;
        }

        return JSON.parse(
            raw
        );

    } catch {

        return null;
    }
}


function queueServerStateSave(
    state
) {

    clearTimeout(
        serverStateTimer
    );

    serverStateTimer = setTimeout(
        () => {

            fetch(
                '/api/library/ui-state/sources_v13',
                {
                    method:
                        'PUT',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({
                            value:
                                state
                        })
                }
            )
            .catch(
                () => {}
            );

        },
        900
    );
}


function saveUiState() {

    clearTimeout(
        uiStateTimer
    );

    uiStateTimer = setTimeout(
        () => {

            const state = (
                buildUiState()
            );

            try {

                localStorage.setItem(
                    UI_STATE_KEY,
                    JSON.stringify(
                        state
                    )
                );

            } catch (
                error
            ) {

                console.warn(
                    'localStorage:',
                    error
                );
            }

            queueServerStateSave(
                state
            );

        },
        100
    );
}


async function readUiStateWithServerFallback() {

    const local = (
        readUiState()
    );

    if (local) {
        return local;
    }

    try {

        const data = (
            await apiJson(
                '/api/library/ui-state/sources_v13'
            )
        );

        if (
            data.value
            && typeof data.value
            === 'object'
        ) {

            return (
                data.value
            );
        }

    } catch {
        // ignore
    }

    return null;
}


function applyUiStateFields(
    state
) {

    if (!state) {
        return;
    }

    currentView =
        state.currentView
        || 'source';

    currentPage =
        Math.max(
            1,
            Number(
                state.currentPage
                || 1
            )
        );

    sourceTotal = (
        state.sourceTotal
        ?? null
    );

    totalPages = (
        state.totalPages
        ?? null
    );

    remoteHasMore = (
        state.remoteHasMore
        !== false
    );

    currentSort =
        state.currentSort
        || 'new';

    selectedVideoIds.clear();

    for (
        const videoId
        of (
            state.selectedVideoIds
            || []
        )
    ) {

        selectedVideoIds.add(
            String(
                videoId
            )
        );
    }

    const sourceInput = (
        document.getElementById(
            'sourceUrl'
        )
    );

    if (
        sourceInput
        && state.sourceUrl
    ) {

        sourceInput.value =
            state.sourceUrl;
    }

    const searchInput = (
        document.getElementById(
            'searchInput'
        )
    );

    if (searchInput) {

        searchInput.value =
            state.search
            || '';
    }

    const statusFilter = (
        document.getElementById(
            'statusFilter'
        )
    );

    if (
        statusFilter
        && Array.from(
            statusFilter.options
        ).some(
            option =>
                option.value
                === (
                    state.status
                    || 'all'
                )
        )
    ) {

        statusFilter.value =
            state.status
            || 'all';
    }

    const directUrl = (
        document.getElementById(
            'directVideoUrl'
        )
    );

    if (directUrl) {

        directUrl.value =
            state.directVideoUrl
            || '';
    }

    const directChannel = (
        document.getElementById(
            'directVideoChannel'
        )
    );

    if (
        directChannel
        && state.directVideoChannel
    ) {

        directChannel.value =
            state.directVideoChannel;
    }

    if (
        Array.isArray(
            state.currentVideos
        )
        && state.currentVideos.length
    ) {

        currentVideos = [
            ...state.currentVideos
        ];

        pageCache[
            currentPage
        ] = [
            ...currentVideos
        ];
    }
}


function labelForCurrentView() {

    if (
        currentView
        === 'favorites'
    ) {
        return '♥ Video đã lưu';
    }

    if (
        currentView
        === 'collection'
    ) {
        return 'Danh mục';
    }

    if (
        currentView
        === 'series'
    ) {
        return 'Series';
    }

    if (
        currentView
        === 'direct'
    ) {
        return 'Link video';
    }

    return 'Nguồn hiện tại';
}


// =========================================================
// RESUME RUNNING JOBS
// =========================================================

async function resumeActiveJobs() {

    try {

        const data = (
            await apiJson(
                '/api/jobs/active'
            )
        );

        const jobs = (
            data.jobs
            || []
        );

        for (
            const job
            of jobs
        ) {

            const video = (
                getVideoById(
                    job.platform_video_id
                )
            );

            if (!video) {
                continue;
            }

            const channel = (
                job.channel_key
                || video.channel_key
                || '2d_animation'
            );

            const mode = (
                job.mode
                || 'subtitle'
            );

            const key = (
                `${channel}:`
                + `${video.video_id}:`
                + `${mode}`
            );

            if (
                activePollKeys.has(
                    key
                )
            ) {
                continue;
            }

            const card = (
                document.querySelector(
                    `.card[data-video-id="${CSS.escape(String(video.video_id))}"]`
                )
            );

            if (!card) {
                continue;
            }

            activePollKeys.add(
                key
            );

            video.processing =
                true;

            const progressWrap = (
                card.querySelector(
                    '.progress-wrap'
                )
            );

            if (progressWrap) {

                progressWrap.style.display =
                    'block';
            }

            pollProcess(
                video,
                card,
                channel,
                mode
            )
            .catch(
                error => {

                    console.warn(
                        'resume poll:',
                        error
                    );
                }
            )
            .finally(
                () => {

                    activePollKeys.delete(
                        key
                    );

                    saveUiState();
                }
            );
        }

    } catch (
        error
    ) {

        console.warn(
            'resumeActiveJobs:',
            error
        );
    }
}


// =========================================================
// WRAP EXISTING FUNCTIONS
// =========================================================

const v12LoadVideos =
    loadVideos;

loadVideos = async function(
    ...args
) {

    currentView =
        'source';

    const result = (
        await v12LoadVideos(
            ...args
        )
    );

    await hydrateCurrentLibraryMeta();

    renderVideos();

    saveUiState();

    return result;
};


const v12LoadPage =
    loadPage;

loadPage = async function(
    ...args
) {

    if (
        currentView
        !== 'source'
    ) {

        return;
    }

    const result = (
        await v12LoadPage(
            ...args
        )
    );

    await hydrateCurrentLibraryMeta();

    renderVideos();

    saveUiState();

    return result;
};


const v12RenderVideos =
    renderVideos;

renderVideos = function(
    ...args
) {

    const result = (
        v12RenderVideos(
            ...args
        )
    );

    for (
        const card
        of document.querySelectorAll(
            '.card'
        )
    ) {

        const video = (
            getVideoById(
                card.dataset.videoId
            )
        );

        const favoriteButton = (
            card.querySelector(
                '.favorite-btn'
            )
        );

        if (
            favoriteButton
            && video
        ) {

            favoriteButton.classList.toggle(
                'is-favorite',
                !!video.favorite
            );
        }
    }

    renderBatchBar();

    saveUiState();

    return result;
};


const v12SetSort =
    setSort;

setSort = function(
    ...args
) {

    const result = (
        v12SetSort(
            ...args
        )
    );

    saveUiState();

    return result;
};



document.addEventListener(
    'click',
    event => {

        for (
            const details
            of document.querySelectorAll(
                '.more-menu[open]'
            )
        ) {

            if (
                !details.contains(
                    event.target
                )
            ) {
                details.open =
                    false;
            }
        }
    }
);


// =========================================================
// INIT
// =========================================================

async function initializeV13() {

    ensureManagerPanel();

    const state = (
        await readUiStateWithServerFallback()
    );

    applyUiStateFields(
        state
    );

    await Promise.all([
        loadSavedSources(),
        loadCollections(),
        loadSeries(),
    ]);

    if (state) {

        const savedSelect = (
            document.getElementById(
                'savedSourceSelect'
            )
        );

        if (
            savedSelect
            && state.selectedSavedSource
        ) {

            savedSelect.value =
                String(
                    state.selectedSavedSource
                );
        }

        const collectionSelect = (
            document.getElementById(
                'collectionSelect'
            )
        );

        if (
            collectionSelect
            && state.selectedCollection
        ) {

            collectionSelect.value =
                String(
                    state.selectedCollection
                );
        }

        const seriesSelect = (
            document.getElementById(
                'seriesSelect'
            )
        );

        if (
            seriesSelect
            && state.selectedSeries
        ) {

            seriesSelect.value =
                state.selectedSeries;
        }

        renderSavedSourceInfo();
    }

    if (
        currentVideos.length
    ) {

        await hydrateCurrentLibraryMeta();

        renderVideos();

        updateSourceInfo(
            'khôi phục trạng thái trước'
        );

        updateViewLabel(
            labelForCurrentView()
        );

    } else {

        const sourceUrl = (
            document
            .getElementById(
                'sourceUrl'
            )
            ?.value
            ?.trim()
            || ''
        );

        if (sourceUrl) {

            await loadVideos();

        } else {

            renderVideos();
        }
    }

    setTimeout(
        () => {

            if (
                state
                && Number.isFinite(
                    Number(
                        state.scrollY
                    )
                )
            ) {

                window.scrollTo(
                    0,
                    Number(
                        state.scrollY
                    )
                );
            }

        },
        120
    );

    await resumeActiveJobs();

    saveUiState();
}


window.addEventListener(
    'beforeunload',
    () => {

        const state = (
            buildUiState()
        );

        try {

            localStorage.setItem(
                UI_STATE_KEY,
                JSON.stringify(
                    state
                )
            );

        } catch {
            // ignore
        }
    }
);


document.addEventListener(
    'visibilitychange',
    () => {

        if (
            document.visibilityState
            === 'hidden'
        ) {

            saveUiState();
        }
    }
);


for (
    const id
    of [
        'searchInput',
        'statusFilter',
        'sourceUrl',
    ]
) {

    const element = (
        document.getElementById(
            id
        )
    );

    if (element) {

        element.addEventListener(
            (
                id
                === 'searchInput'
                || id
                === 'sourceUrl'
            )
            ? 'input'
            : 'change',
            () => {
                saveUiState();
            }
        );
    }
}


initializeV13()
.catch(
    error => {

        console.error(
            'V13 init error:',
            error
        );

        // Fallback: giu behavior cu neu manager V13 loi.
        loadVideos();
    }
);
