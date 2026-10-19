// Generated from the mature local Sources UI by web/scripts/sync-source-ui.mjs.
// All API and media transport is supplied by the shared LocalEngineClient.
export function startSourcesRuntime(environment) {
const { document, window, localStorage, setTimeout, clearTimeout, setInterval, clearInterval, fetch, history } = environment;
let currentVideos = [];
let currentSort = 'new';
let currentPage = 1;
let sourceTotal = null;
let totalPages = null;
let remoteHasMore = true;
let loadingPage = false;
const PAGE_SIZE = 10;
const pageCache = {};
let sourceSyncPromise = null;
let lastLoadedSourceUrl = '';
let lastLoadedInputMode = 'channel';

// =========================================================
// V13 PERSISTENT LIBRARY STATE
// =========================================================

let currentView = 'source';
let savedSources = [];
let collections = [];
let seriesGroups = [];
let librarySeriesGroups = [];
let activeSeriesKey = '';

const UI_STATE_KEY = 'reup.sources.v13';
// Keep the pasted source only for this browser tab/session.  It survives
// navigation and reloads, but is not restored on another device or a new tab.
const SOURCE_SESSION_KEY = 'reup.sources.active-session.v1';
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


function formatCompactViews(
    value
) {

    const views = Number(value || 0);

    if (!Number.isFinite(views) || views <= 0) {
        return 'Chưa có lượt xem';
    }

    if (views >= 1000000) {
        return `${(views / 1000000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} Tr lượt xem`;
    }

    if (views >= 1000) {
        return `${(views / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} N lượt xem`;
    }

    return `${formatViews(views)} lượt xem`;
}


function formatDuration(
    value
) {
    const seconds = Number(value);

    if (!Number.isFinite(seconds) || seconds <= 0) {
        return '';
    }

    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remaining = total % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
    }

    return `${minutes}:${String(remaining).padStart(2, '0')}`;
}


function formatVideoRatio(
    video
) {
    const width = Number(video.video_width || video.width || 0);
    const height = Number(video.video_height || video.height || 0);

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return '';
    }

    const gcd = (left, right) => right ? gcd(right, left % right) : left;
    const divisor = gcd(Math.round(width), Math.round(height));

    return divisor > 0
        ? `${Math.round(width / divisor)}:${Math.round(height / divisor)}`
        : '';
}


function mediaMetaHtml(
    video
) {
    const duration = formatDuration(video.duration_seconds || video.duration);
    const ratio = formatVideoRatio(video);

    if (!duration && !ratio) {
        return '';
    }

    const facts = [
        duration
            ? `<span class="media-inline" title="Thời lượng video">${uiIcon('clock', 12)} ${duration}</span>`
            : '',
        ratio
            ? `<span class="media-inline" title="Tỷ lệ khung hình">${uiIcon('video', 12)} ${ratio}</span>`
            : '',
    ].filter(Boolean).join('');

    return `<span class="media-facts">${facts}</span>`;
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


function formatCardDate(
    value
) {

    if (!value) {
        return '';
    }

    try {
        return new Date(value).toLocaleDateString('vi-VN');
    } catch {
        return String(value);
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

    if (activeSeriesKey) {
        videos = videos.filter(
            video =>
                video.series_key
                === activeSeriesKey
        );
    }

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
    if (!currentVideos.length && !Object.keys(pageCache).length) {
        const pages = document.getElementById('bottomPages');
        const info = document.getElementById('pageInfo');
        if (pages) { pages.innerHTML = ''; pages.style.display = 'none'; }
        if (info) info.textContent = '';
        return;
    }


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


function renderVideoLoadingState() {

    const root = document.getElementById('videos');

    if (!root) {
        return;
    }

    root.innerHTML = Array.from({length: 6}, () => `
        <article class="video-loading-card" aria-label="Đang tải thumbnail">
            <div class="video-loading-thumb"></div>
            <div class="video-loading-lines">
                <span></span><span></span><span></span>
            </div>
        </article>
    `).join('');
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

    renderVideoLoadingState();

    try {

        const response = (
            await window.reupEngineClient.request(
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


async function loadVideos(refresh = false) {

    const sourceUrl = (
        document
        .getElementById(
            'sourceUrl'
        )
        .value
        .trim()
    );

    const inputMode = (
        document
        .getElementById(
            'sourceInputMode'
        )
        ?.value
        || 'channel'
    );

    saveSourceSession();

    const info = (
        document
        .getElementById(
            'info'
        )
    );

    const canReuseCurrent = (
        sourceUrl === lastLoadedSourceUrl
        && inputMode === lastLoadedInputMode
        && currentVideos.length > 0
    );
    const previousSourceTotal = sourceTotal;
    const previousTotalPages = totalPages;
    const previousRemoteHasMore = remoteHasMore;

    info.className =
        'info-line';

    info.textContent = refresh
        ? 'Đang kiểm tra video mới...'
        : 'Đang tải video nguồn...';

    if (!canReuseCurrent) {
        currentVideos = [];
        renderVideoLoadingState();
    }

    currentPage =
        1;

    currentVideos =
        [];

    activeSeriesKey = '';

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

        if (inputMode === 'video') {

            const response = await window.reupEngineClient.request(
                '/api/library/direct/inspect',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        url: sourceUrl,
                        channel: '2d_animation',
                    }),
                }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.detail || 'Không lấy được video.'
                );
            }

            currentView = 'direct';
            currentVideos = [data.video];
            lastLoadedSourceUrl = sourceUrl;
            lastLoadedInputMode = inputMode;
            sourceTotal = 1;
            totalPages = 1;
            remoteHasMore = false;
            renderVideos();
            updateSourceInfo('Đã nhận diện 1 video');
            updateViewLabel('Video lẻ');
            updateFollowSourceButton();
            saveUiState();
            return;
        }

        currentView = 'source';

        const response = (
            await window.reupEngineClient.request(
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
                                PAGE_SIZE,

                            refresh:
                                !!refresh,

                            known_videos:
                                canReuseCurrent
                                    ? currentVideos.slice(0, PAGE_SIZE)
                                    : []
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

        const videos = data.videos || [];
        if (
            canReuseCurrent
            && videos.length === 0
            && !data.checked_remote
        ) {
            renderVideos();
            updateSourceInfo(
                data.warning || 'Đang giữ danh sách đã tải trước đó.'
            );
            return;
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

        lastLoadedSourceUrl = sourceUrl;
        lastLoadedInputMode = inputMode;

        renderVideos();

        let extra = data.warning || '';
        if (data.checked_remote) {
            extra = Number(data.new_count || 0) > 0
                ? `Có ${Number(data.new_count)} video mới.`
                : (extra || 'Đã kiểm tra nguồn, chưa có video mới.');
        }

        updateSourceInfo(
            extra
        );

    } catch (
        error
    ) {

        if (canReuseCurrent) {
            sourceTotal = previousSourceTotal;
            totalPages = previousTotalPages;
            remoteHasMore = previousRemoteHasMore;
            renderVideos();
            info.className = 'info-line warning';
            info.textContent = 'Chưa cập nhật được nguồn; vẫn giữ danh sách video đã tải trước đó.';
        } else {
            currentVideos = [];
            renderVideos();
            info.className = 'info-line warning';
            info.textContent = 'Lỗi: ' + error.message;
        }
    }
}


function renderVideos() {

    const root = (
        document
        .getElementById(
            'videos'
        )
    );

    mergeCurrentVideoSeries();

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
            `<span class="badge ok">${uiIcon('check', 14)} Đã tải</span>`
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
            `<span class="badge ok">${uiIcon('captions', 14)} Vietsub</span>`
        );
    }

    if (
        video.has_voice_result
    ) {

        badges.push(
            `<span class="badge ok">${uiIcon('voice', 14)} Voice</span>`
        );
    }

    if (
        video.processing
    ) {

        badges.push(
            `<span class="badge work">${uiIcon('clock', 14)} Đang xử lý</span>`
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



function uiIcon(
    name,
    size = 18
) {
    return (
        `<svg
            class="ui-icon"
            width="${size}"
            height="${size}"
            style="--icon-size:${size}px"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        ><use href="#ui-${name}"></use></svg>`
    );
}


function collectionOptionsHtml(
    selectedIds = []
) {

    const selected = (
        new Set(
            selectedIds
            || []
        )
    );

    let html = `
        <option value="">
            Chọn danh mục
        </option>
    `;

    for (
        const item
        of collections
    ) {

        html += `
            <option
                value="${escapeHtml(String(item.id))}"
                ${
                    selected.has(
                        Number(
                            item.id
                        )
                    )
                    ? 'data-added="1"'
                    : ''
                }
            >
                ${escapeHtml(item.name)}
                ${selected.has(Number(item.id)) ? ' · đã có' : ''}
            </option>
        `;
    }

    return html;
}


function buildCard(
    video
) {

    const card = (
        document.createElement(
            'article'
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

    const checked = (
        selectedVideoIds.has(
            String(
                video.video_id
            )
        )
    );

    const resultButtons = `
        ${
            video.has_subtitle_result
            ? `
                <button
                    class="result-chip"
                    data-result-mode="subtitle"
                    title="Xem bản Vietsub"
                >
                    SUB
                </button>
            `
            : ''
        }

        ${
            video.has_voice_result
            ? `
                <button
                    class="result-chip"
                    data-result-mode="voiceover"
                    title="Xem bản Voice"
                >
                    VOICE
                </button>
            `
            : ''
        }
    `;

    card.innerHTML = `

        <label
            class="select-control"
            title="Chọn video"
        >
            <input
                type="checkbox"
                class="video-select"
                ${checked ? 'checked' : ''}
            >
            <span class="select-visual"></span>
        </label>


        <div class="cover-wrap compact-cover">

            <div class="cover-fallback">
                No image
            </div>

            <img
                class="cover"
                data-engine-cover="${escapeHtml(coverUrl(video.cover_url || ''))}"
                alt="${escapeHtml(video.title || '')}"
                loading="lazy"
                onerror="this.style.display='none'"
            >

        </div>


        <div class="content compact-content">

            <div class="card-header-row">

                <div class="compact-title-wrap">

                    <div class="title compact-title">
                        ${escapeHtml(video.title || video.video_id)}
                    </div>

                    <div class="meta compact-meta">
                        <span class="source-video-id" title="${escapeHtml(video.video_id)}">${escapeHtml(video.video_id)}</span>
                        <span class="meta-divider">•</span>
                        <span>${formatCompactViews(video.play_count)}</span>
                        ${
                            video.published_at
                            ? `<span class="meta-divider">•</span><time title="${escapeHtml(formatDate(video.published_at))}">${escapeHtml(formatCardDate(video.published_at))}</time>`
                            : ''
                        }
                        ${mediaMetaHtml(video)}
                    </div>

                </div>

                <button
                    class="favorite-btn modern-icon-btn ${
                        video.favorite
                        ? 'is-favorite'
                        : ''
                    }"
                    title="${
                        video.favorite
                        ? 'Bỏ yêu thích'
                        : 'Yêu thích'
                    }"
                    aria-label="Yêu thích"
                >
                    ${uiIcon('heart', 19)}
                </button>

            </div>


            <div class="badges compact-badges">
                ${buildBadges(video)}
            </div>


            <div class="card-action-row">

                <button
                    class="sub-btn action-primary"
                >
                    Vietsub
                </button>

                <button
                    class="voice-btn action-secondary"
                >
                    Voice
                </button>

                <div class="result-chip-group">
                    ${resultButtons}
                </div>

                <button
                    class="process-details-btn"
                    type="button"
                    hidden
                    title="Xem tiến trình xử lý"
                >
                    ${uiIcon('refresh', 14)}
                    <span class="process-inline-label">Đang xử lý</span>
                    <strong class="process-inline-percent">0%</strong>
                </button>

                <div class="result-actions dynamic-results"></div>

                <details class="more-menu">

                    <summary
                        class="more-trigger"
                        title="Tùy chọn"
                        aria-label="Tùy chọn"
                    >
                        ${uiIcon('more', 19)}
                    </summary>

                    <div class="more-menu-panel">

                        <button
                            class="menu-action open-btn"
                        >
                            ${uiIcon('external', 16)}
                            <span>Mở video gốc</span>
                        </button>

                        <button
                            class="menu-action download-btn"
                        >
                            ${uiIcon('download', 16)}
                            <span>Tải video gốc</span>
                        </button>

                        <div class="menu-section">

                            <div class="menu-section-title">
                                Danh mục
                            </div>

                            <div class="collection-inline">
                                <select
                                    class="card-collection-select"
                                >
                                    ${collectionOptionsHtml(video.collection_ids || [])}
                                </select>

                                <button
                                    class="collection-inline-add modern-icon-btn"
                                    title="Thêm vào danh mục"
                                    aria-label="Thêm vào danh mục"
                                >
                                    ${uiIcon('plus', 16)}
                                </button>
                            </div>

                        </div>

                        <div class="menu-section">

                            <div class="menu-section-title">
                                Kênh xử lý
                            </div>

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

                        </div>

                    </div>

                </details>

            </div>


            <div class="progress-wrap" aria-hidden="true">

                <div class="progress-head">

                    <div class="progress-copy">

                        <span class="progress-state">
                            <span class="progress-pulse"></span>
                            Đang xử lý
                        </span>

                        <div class="progress-stage">
                            Đang chuẩn bị
                        </div>

                    </div>

                    <div class="progress-actions">

                        <div class="progress-text">
                            0%
                        </div>

                        <button
                            class="stop-process-btn modern-icon-btn"
                            type="button"
                            title="Ngừng xử lý"
                            aria-label="Ngừng xử lý"
                        >
                            ${uiIcon('stop', 15)}
                        </button>

                    </div>

                </div>

                <div class="progress">
                    <div class="progress-bar"></div>
                </div>

                <div class="progress-footer">
                    <span class="progress-live-note">Cập nhật trực tiếp</span>

                    <pre class="log"></pre>
                </div>

            </div>

        </div>
    `;


    if (!video.cover_url && video.downloaded) {
        card.querySelector('.cover')?.remove();
        const frame = document.createElement('video');
        frame.className = 'cover'; frame.crossOrigin = 'anonymous';
        frame.muted = true; frame.playsInline = true; frame.preload = 'metadata';
        frame.onloadedmetadata = () => { frame.currentTime = Math.min(.1, frame.duration || 0); };
        frame.onerror = () => frame.remove();
        card.querySelector('.cover-wrap')?.appendChild(frame);
        window.reupEngineClient.mediaUrl('/api/preview/source/' + encodeURIComponent(video.video_id))
            .then(url => { if (frame.isConnected) frame.src = url; })
            .catch(() => frame.remove());
    }

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
        openProcessConfig(video, card, 'subtitle');
    };


    card
    .querySelector(
        '.voice-btn'
    )
    .onclick = () => {
        openProcessConfig(video, card, 'voiceover');
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
        '.collection-inline-add'
    )
    .onclick = async () => {

        const select = (
            card.querySelector(
                '.card-collection-select'
            )
        );

        const collectionId = (
            Number(
                select.value
                || 0
            )
        );

        if (!collectionId) {

            select.focus();
            return;
        }

        await addVideoToCollectionId(
            video,
            collectionId,
            card
        );
    };


    card
    .querySelector(
        '.stop-process-btn'
    )
    .onclick = async () => {

        await stopVideoProcess(
            video,
            card
        );
    };


    card
    .querySelector(
        '.process-details-btn'
    )
    .onclick = () => {

        openProcessDetailsPopup(
            video,
            card
        );
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
            await window.reupEngineClient.request(
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

        button.innerHTML =
            `${uiIcon('check', 15)} Đã tải`;

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


function processConfigDefaults() {
    // Mỗi job bắt đầu sạch theo flow mặc định, không lấy cấu hình cũ.
    return {
        // Logo chỉ được chèn khi người dùng chủ động chọn trong phần nâng cao.
        logo_mode: 'none',
    };
}


function ensureProcessConfigDialog() {
    let dialog = document.getElementById('processConfigDialog');
    if (dialog) return dialog;

    dialog = document.createElement('dialog');
    dialog.id = 'processConfigDialog';
    dialog.innerHTML = `
        <form method="dialog" class="process-config-dialog">
            <div class="process-config-head">
                <div>
                    <span class="process-config-kicker">TÙY CHỈNH JOB</span>
                    <h3 id="processConfigTitle">Thiết lập Vietsub</h3>
                    <p id="processConfigVideoTitle"></p>
                </div>
                <button type="button" class="modern-icon-btn" id="closeProcessConfig" aria-label="Đóng"><svg class="ui-icon"><use href="#ui-close"></use></svg></button>
            </div>

            <div class="process-config-preview" id="processConfigPreviewWrap">
                <div class="process-preview-stage" id="processPreviewStage">
                    <video id="processConfigPreview" controls preload="metadata"></video>
                    <canvas id="processPreviewCanvas"></canvas>
                </div>
                <div id="processConfigPreviewEmpty">Video chưa tải về máy nên chưa có bản xem trước.</div>
                <button type="button" class="btn secondary process-download-source" id="processDownloadSource">${uiIcon('download', 16)} Tải video để xem trước</button>
            </div>

            <div class="process-preview-tools">
                <span>Chọn trực tiếp trên video:</span>
                <button type="button" class="btn secondary process-pick-btn active" data-pick-mode="sub">${uiIcon('blur', 16)} Vùng mờ sub</button>
                <button type="button" class="btn secondary process-pick-btn" data-pick-mode="custom">${uiIcon('blur', 16)} Vùng mờ tùy chỉnh</button>
                <button type="button" class="btn secondary process-pick-btn" data-pick-mode="logo">${uiIcon('sparkles', 16)} Vị trí logo</button>
                <button type="button" class="btn secondary" id="toggleProcessPicker" aria-pressed="false">${uiIcon('pointer', 16)} Bật kéo vùng</button>
                <button type="button" class="btn secondary" id="resetProcessConfig">${uiIcon('reset', 16)} Đặt lại lựa chọn</button>
                <button type="button" class="btn secondary" id="undoProcessConfig">${uiIcon('undo', 16)} Hoàn tác</button>
                <small id="processPickerHint">Chọn loại vùng trước, sau đó bấm “Bật kéo vùng” nếu muốn kéo trên video.</small>
            </div>

            <div class="process-preset-bar">
                <label>Preset realtime
                    <select id="processPresetSelect">
                        <option value="">Không dùng preset</option>
                    </select>
                </label>
                <input id="processPresetName" placeholder="Tên preset mới">
                <button type="button" class="btn secondary" id="saveProcessPreset">Lưu và áp dụng</button>
                <button type="button" class="btn secondary" id="deleteProcessPreset">Xóa</button>
                <small id="processPresetStatus">Chọn preset sẽ cập nhật ngay cấu hình hiện tại.</small>
            </div>

            <div class="process-config-grid">
                <label>Thời lượng xem trước
                    <select id="processPreviewSeconds">
                        <option value="">Toàn bộ video</option>
                        <option value="10">10 giây đầu</option>
                        <option value="30">30 giây đầu</option>
                        <option value="60">60 giây đầu</option>
                    </select>
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
                <label>Tỷ lệ video đầu ra
                    <select id="processAspectRatio">
                        <option value="">Giữ nguyên mặc định</option>
                        <option value="shorts">YouTube Shorts · 9:16</option>
                        <option value="youtube">YouTube ngang · 16:9</option>
                        <option value="facebook">Facebook · 4:5</option>
                        <option value="tiktok">TikTok · 9:16</option>
                    </select>
                </label>
                <label class="process-check-option">
                    <input id="processAutoBrandBlur" type="checkbox">
                    Tự động làm mờ ID/chữ watermark
                    <small>Chỉ bật khi video có watermark ở góc trên.</small>
                </label>
            </div>

            <details class="process-config-advanced" id="processMusicSection">
                <summary>Nhạc nền</summary>
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
                <summary>Vùng mờ sub</summary>
                <p>Vùng này dùng để làm mờ phụ đề gốc. Tọa độ tính theo pixel của video.</p>
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
                <summary>Vùng mờ tùy chỉnh</summary>
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
                <summary>Logo chèn lên video</summary>
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

            <div class="process-config-note">Mặc định chỉ làm mờ phụ đề. Chọn logo hoặc chữ ở trên khi bạn muốn chèn vào video.</div>
            <div class="process-config-actions">
                <button type="button" class="btn secondary" id="cancelProcessConfig">Hủy</button>
                <button type="submit" class="btn primary" id="runProcessConfig">Bắt đầu xử lý</button>
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


async function openProcessConfig(video, card, mode) {
    const dialog = ensureProcessConfigDialog();
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
        if (id.startsWith('processBlur') || id === 'processBlurPreset') return 'sub';
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
    if (!dialog.dataset.presetDirtyBound) {
        configForm.addEventListener('input', event => dialog._presetMarkDirty?.(event.target), true);
        configForm.addEventListener('change', event => dialog._presetMarkDirty?.(event.target), true);
        dialog.dataset.presetDirtyBound = '1';
    }
    dialog.dataset.mode = mode;
    dialog.dataset.videoId = video.video_id;
    dialog.dataset.cardId = card.dataset.videoId || '';

    dialog.querySelector('#processConfigTitle').textContent = mode === 'subtitle' ? 'Thiết lập Vietsub' : 'Thiết lập Voice + Vietsub';
    dialog.querySelector('#processConfigVideoTitle').textContent = video.title || video.video_id;
    dialog.querySelector('#processVoiceField').style.display = mode === 'voiceover' ? '' : 'none';
    set('processPreviewSeconds', defaults.preview_seconds || '');
    set('processFontSize', defaults.subtitle_font_size || '');
    set('processOriginalVolume', defaults.original_volume ?? 0.15);
    set('processVoiceVolume', defaults.voice_volume ?? 1);
    set('processTtsSpeed', defaults.tts_speed ?? 1.10);
    set('processVoice', defaults.voice || 'Trúc Ly');
    set('processAspectRatio', defaults.aspect_ratio || '');
    set('processMusicUrl', defaults.music_url || '');
    set('processMusicVolume', defaults.music_volume ?? 0.25);
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
    downloadButton.hidden = !!video.downloaded;
    downloadButton.onclick = async () => {
        downloadButton.disabled = true;
        downloadButton.textContent = 'Đang tải video...';
        try {
            await downloadVideo(video, card);
            downloadButton.hidden = !!video.downloaded;
            if (!video.downloaded) return;
            preview.src = await window.reupEngineClient.mediaUrl(`/api/preview/source/${encodeURIComponent(video.video_id)}`);
            preview.load();
        } catch (error) {
            alert(error.message);
        } finally {
            downloadButton.disabled = false;
            downloadButton.innerHTML = `${uiIcon('download', 16)} Tải video để xem trước`;
        }
    };

    const preview = dialog.querySelector('#processConfigPreview');
    const empty = dialog.querySelector('#processConfigPreviewEmpty');
    const stage = dialog.querySelector('#processPreviewStage');
    const canvas = dialog.querySelector('#processPreviewCanvas');
    const pickButtons = [...dialog.querySelectorAll('.process-pick-btn')];
    const pickerToggle = dialog.querySelector('#toggleProcessPicker');
    let pickMode = 'sub';
    let pickingEnabled = false;
    let dragStart = null;
    let selectedRect = null;

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
        if (!selectedRect) return;
        context.fillStyle = pickMode === 'logo' ? 'rgba(124,108,255,.22)' : pickMode === 'custom' ? 'rgba(251,191,36,.22)' : 'rgba(45,212,191,.22)';
        context.strokeStyle = pickMode === 'logo' ? '#9b91ff' : pickMode === 'custom' ? '#fbbf24' : '#2dd4bf';
        context.lineWidth = Math.max(3, canvas.width / 420);
        context.fillRect(selectedRect.x, selectedRect.y, selectedRect.width, selectedRect.height);
        context.strokeRect(selectedRect.x, selectedRect.y, selectedRect.width, selectedRect.height);
    };

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
            set('processBlurX', Math.round(rect.x));
            set('processBlurY', Math.round(rect.y));
            set('processBlurWidth', Math.round(rect.width));
            set('processBlurHeight', Math.round(rect.height));
            set('processBlurPreset', '');
        }
    };

    pickButtons.forEach(button => {
        button.onclick = () => {
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
            pickButtons.forEach(item => item.classList.toggle('active', item === button));
            syncSelectionFromFields();
        };
    });

    const setPickingEnabled = enabled => {
        pickingEnabled = !!enabled;
        if (canvas) {
            canvas.classList.toggle('is-picking', pickingEnabled);
            canvas.style.pointerEvents = pickingEnabled ? 'auto' : 'none';
        }
        if (pickerToggle) {
            pickerToggle.setAttribute('aria-pressed', pickingEnabled ? 'true' : 'false');
            pickerToggle.classList.toggle('active', pickingEnabled);
            pickerToggle.innerHTML = `${uiIcon('pointer', 16)} ${pickingEnabled ? 'Tắt kéo vùng' : 'Bật kéo vùng'}`;
        }
        const hint = dialog.querySelector('#processPickerHint');
        if (hint) hint.textContent = pickingEnabled
            ? 'Đang bật kéo vùng. Bấm lại để xem video và dùng thanh điều khiển bình thường.'
            : 'Chọn loại vùng trước, sau đó bấm “Bật kéo vùng” nếu muốn kéo trên video.';
    };
    pickerToggle?.addEventListener('click', () => setPickingEnabled(!pickingEnabled));

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
                x: Math.max(0, Math.min(dragStart.x, current.x)),
                y: Math.max(0, Math.min(dragStart.y, current.y)),
                width: Math.abs(current.x - dragStart.x),
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


    preview.onerror = () => { downloadButton.hidden = false; preview.style.display = 'none'; canvas.style.display = 'none'; empty.style.display = 'block'; };
    preview.onloadedmetadata = () => { video.downloaded = true; downloadButton.hidden = true; preview.style.display = 'block'; canvas.style.display = 'block'; empty.style.display = 'none'; drawSelection(); };
    preview.onresize = drawSelection;
    preview.crossOrigin = 'anonymous';
    try { preview.src = await window.reupEngineClient.mediaUrl(`/api/preview/source/${encodeURIComponent(video.video_id)}`); } catch { preview.onerror(); }

    dialog.querySelector('#resetProcessConfig').onclick = () => {
        if (typeof collectPresetConfig === 'function') dialog._undoConfig = collectPresetConfig();
        set('processPreviewSeconds', '');
        set('processFontSize', '');
        set('processOriginalVolume', 0.15);
        set('processVoiceVolume', 1);
        set('processTtsSpeed', 1.10);
        set('processVoice', 'Trúc Ly');
        set('processAspectRatio', '');
        set('processMusicUrl', '');
        set('processMusicVolume', 0.25);
        dialog.querySelector('#processMusicFile').value = '';
        dialog.querySelector('#processAutoBrandBlur').checked = false;
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
        pickButtons.forEach(button => button.classList.toggle('active', button.dataset.pickMode === pickMode));
        setPickingEnabled(false);
        selectedRect = null;
        drawSelection();
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
        await window.reupEngineClient.json('/api/library/ui-state/process_presets_v2', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: presets }),
        });
        localStorage.setItem(presetStoreKey, JSON.stringify(presets));
        return true;
        } catch (error) {
            presetStatus.textContent = 'Không lưu được preset: ' + error.message;
            return false;
        }
    };
    const collectPresetConfig = () => {
        const value = id => dialog.querySelector(`#${id}`)?.value || '';
        const fields = [
            'processPreviewSeconds', 'processFontSize', 'processOriginalVolume',
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
        if (typeof collectPresetConfig === 'function' && dialog.dataset.presetApplying !== '1') {
            dialog._undoConfig = collectPresetConfig();
        }
        dialog.dataset.presetApplying = '1';
        Object.entries(preset).forEach(([id, value]) => {
            if (id === 'auto_brand_blur') {
                dialog.querySelector('#processAutoBrandBlur').checked = !!value;
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
        syncSelectionFromFields();
        dialog._presetDirtySections.clear();
        dialog.dataset.presetApplying = '0';
        presetStatus.textContent = name ? `Đã áp dụng: ${name}` : 'Đã áp dụng cấu hình realtime.';
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
    dialog.querySelector('#undoProcessConfig').onclick = () => {
        if (!dialog._undoConfig) {
            presetStatus.textContent = 'Chưa có thay đổi để hoàn tác.';
            return;
        }
        const restore = dialog._undoConfig;
        dialog._undoConfig = collectPresetConfig();
        applyPresetConfig(restore, 'Hoàn tác');
    };
    const saveSection = async (section, label) => {
        const name = presetSelect.value;
        if (name && presets[name]) {
            const current = collectPresetConfig();
            const sectionFields = {
                sub: ['processBlurPreset', 'processBlurX', 'processBlurY', 'processBlurWidth', 'processBlurHeight'],
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
        dialog._logoData = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        });
        dialog._logoFilename = file.name;
    };

    dialog.querySelector('form').onsubmit = async event => {
        event.preventDefault();
        const selectedPreset = presetSelect.value;
        if (selectedPreset && dialog._presetDirtySections.size) {
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
        dialog.close();
        processVideo(video, card, mode, config);
    };
    dialog.showModal();
}


let processingDetailsPopup = null;
let processingDetailsPopupCard = null;


function ensureProcessDetailsPopup() {

    if (processingDetailsPopup) {
        return processingDetailsPopup;
    }

    const popup = document.createElement('div');
    popup.className = 'process-details-popup';
    popup.hidden = true;
    popup.innerHTML = `
        <div class="process-details-backdrop"></div>
        <section
            class="process-details-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="processDetailsTitle"
        >
            <header class="process-details-header">
                <div>
                    <span class="process-details-eyebrow">
                        <span class="process-details-dot"></span>
                        TIẾN TRÌNH XỬ LÝ
                    </span>
                    <h2 id="processDetailsTitle"></h2>
                    <p class="process-details-source"></p>
                </div>
                <button
                    class="process-details-close modern-icon-btn"
                    type="button"
                    aria-label="Đóng chi tiết tiến trình"
                    title="Đóng"
                >
                    ${uiIcon('close', 18)}
                </button>
            </header>

            <div class="process-details-summary">
                <div>
                    <span class="process-details-status">Đang xử lý</span>
                    <p class="process-details-stage">Đang chuẩn bị</p>
                </div>
                <strong class="process-details-percent">0%</strong>
            </div>

            <div class="process-details-track">
                <div class="process-details-bar"></div>
            </div>

            <div class="process-details-log-wrap">
                <div class="process-details-log-label">Nhật ký trực tiếp</div>
                <pre class="process-details-log">Đang chờ dữ liệu tiến trình...</pre>
            </div>

            <footer class="process-details-footer">
                <span>Tiến trình vẫn tiếp tục khi đóng cửa sổ này.</span>
                <div>
                    <button class="process-details-cancel secondary" type="button">
                        Đóng
                    </button>
                    <button class="process-details-stop" type="button">
                        ${uiIcon('stop', 15)} Dừng xử lý
                    </button>
                </div>
            </footer>
        </section>
    `;

    const closePopup = () => {
        popup.hidden = true;
        processingDetailsPopupCard = null;
    };

    popup.querySelector('.process-details-close').onclick = closePopup;
    popup.querySelector('.process-details-cancel').onclick = closePopup;
    popup.querySelector('.process-details-backdrop').onclick = closePopup;
    popup.querySelector('.process-details-stop').onclick = () => {
        processingDetailsPopupCard
            ?.querySelector('.stop-process-btn')
            ?.click();
    };

    popup.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            closePopup();
        }
    });

    document.body.appendChild(popup);
    processingDetailsPopup = popup;
    return popup;
}


function syncProcessDetailsPopup(
    card,
    options = {}
) {

    if (
        !processingDetailsPopup
        || processingDetailsPopupCard !== card
    ) {
        return;
    }

    const popup = processingDetailsPopup;
    const percent = options.percent
        ?? card.querySelector('.progress-text')?.textContent
        ?? '0%';
    const stage = options.stage
        ?? card.querySelector('.progress-stage')?.textContent
        ?? 'Đang chuẩn bị';
    const log = card.querySelector('.log')?.textContent?.trim();
    const isError = Boolean(options.error);
    const finished = Boolean(options.finished);
    const stopped = Boolean(options.stopped);
    const stopButton = card.querySelector('.stop-process-btn');

    popup.querySelector('.process-details-percent').textContent = percent;
    popup.querySelector('.process-details-stage').textContent = stage;
    popup.querySelector('.process-details-status').textContent = isError
        ? 'Đã xảy ra lỗi'
        : stopped
            ? 'Đã dừng'
            : finished
                ? 'Hoàn tất'
                : 'Đang xử lý';
    popup.querySelector('.process-details-log').textContent = log
        || (isError ? stage : 'Đang chờ dữ liệu tiến trình...');
    popup.querySelector('.process-details-bar').style.width = percent;
    popup.classList.toggle('has-error', isError);
    popup.classList.toggle('is-complete', finished || stopped);

    const popupStop = popup.querySelector('.process-details-stop');
    popupStop.hidden = Boolean(
        isError
        || finished
        || stopped
        || !stopButton
        || stopButton.style.display === 'none'
    );
    popupStop.disabled = Boolean(stopButton?.disabled);
}


function openProcessDetailsPopup(
    video,
    card
) {

    const popup = ensureProcessDetailsPopup();
    processingDetailsPopupCard = card;

    popup.querySelector('#processDetailsTitle').textContent = (
        video.title
        || video.video_id
    );
    popup.querySelector('.process-details-source').textContent = (
        `${video.video_id} · ${card.querySelector('.process-inline-label')?.textContent || 'Đang xử lý'}`
    );
    popup.hidden = false;
    syncProcessDetailsPopup(card, {
        error: card.classList.contains('has-process-error'),
        finished: card.classList.contains('has-process-complete'),
        stopped: card.classList.contains('has-process-stopped'),
    });
    popup.querySelector('.process-details-close').focus();
}


function updateInlineProcessStatus(
    card,
    percent,
    label,
    state = 'running'
) {

    const button = card.querySelector('.process-details-btn');
    if (!button) return;

    button.hidden = false;
    button.querySelector('.process-inline-percent').textContent = percent;
    button.querySelector('.process-inline-label').textContent = label;
    button.classList.toggle('is-error', state === 'error');
    button.classList.toggle('is-complete', state === 'complete');
}


async function processVideo(
    video,
    card,
    mode,
    config = {}
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

    const progressStage = (
        card
        .querySelector(
            '.progress-stage'
        )
    );

    const stopButton = (
        card
        .querySelector(
            '.stop-process-btn'
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
        'none';

    card.classList.remove(
        'has-process-error',
        'has-process-complete',
        'has-process-stopped'
    );

    card.classList.add(
        'is-processing'
    );

    logBox.textContent =
        '';

    dynamicResults.innerHTML =
        '';

    progressBar.style.width =
        '1%';

    progressText.textContent =
        '1%';

    progressStage.textContent =
        (
            mode === 'subtitle'
            ? 'Khởi động Vietsub'
            : 'Khởi động Voice'
        );

    stopButton.style.display =
        'inline-grid';

    stopButton.disabled =
        false;

    updateInlineProcessStatus(
        card,
        '1%',
        mode === 'subtitle'
            ? 'Đang làm Vietsub'
            : 'Đang tạo Voice'
    );

    syncProcessDetailsPopup(
        card
    );

    try {

        const response = (
            await window.reupEngineClient.request(
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
                                mode,

                            ...config,
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

        video.active_mode =
            mode;

        video.active_channel =
            channel;

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
            '0%';

        progressStage.textContent =
            (
                'Lỗi · '
                + error.message
            );

        progressBar.style.width =
            '0%';

        stopButton.style.display =
            'none';

        subButton.disabled =
            false;

        voiceButton.disabled =
            false;

        video.processing =
            false;

        card.classList.remove(
            'is-processing'
        );

        card.classList.add(
            'has-process-error'
        );

        updateInlineProcessStatus(
            card,
            'Lỗi',
            'Xem chi tiết lỗi',
            'error'
        );

        syncProcessDetailsPopup(
            card,
            {
                error: true,
                stage: progressStage.textContent,
                percent: '0%'
            }
        );
    }
}


async function stopVideoProcess(
    video,
    card
) {

    if (
        !video.processing
        || !video.active_mode
    ) {
        return;
    }

    const channel = (
        video.active_channel
        || card
            .querySelector(
                '.channel'
            )
            ?.value
        || '2d_animation'
    );

    const mode = (
        video.active_mode
    );

    const button = (
        card.querySelector(
            '.stop-process-btn'
        )
    );

    const stage = (
        card.querySelector(
            '.progress-stage'
        )
    );

    button.disabled =
        true;

    stage.textContent =
        'Đang dừng...';

    updateInlineProcessStatus(
        card,
        card.querySelector('.progress-text')?.textContent || '…',
        'Đang dừng...'
    );

    syncProcessDetailsPopup(
        card,
        {
            stage: 'Đang dừng...'
        }
    );

    try {

        await apiJson(
            (
                `/api/process/${encodeURIComponent(video.video_id)}/stop`
                + `?channel=${encodeURIComponent(channel)}`
                + `&mode=${encodeURIComponent(mode)}`
            ),
            {
                method:
                    'POST'
            }
        );

    } catch (
        error
    ) {

        button.disabled =
            false;

        alert(
            error.message
        );
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

    const progressStage = (
        card
        .querySelector(
            '.progress-stage'
        )
    );

    const stopButton = (
        card
        .querySelector(
            '.stop-process-btn'
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
            await window.reupEngineClient.request(
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
            `${percent}%`;

        progressStage.textContent =
            (
                data.message
                || data.stage
                || 'Đang xử lý'
            );

        updateInlineProcessStatus(
            card,
            `${percent}%`,
            data.message
            || data.stage
            || 'Đang xử lý'
        );

        if (
            data.log_tail
            && data.log_tail.length
        ) {

            logBox.textContent =
                data.log_tail.join(
                    '\n'
                );

            logBox.scrollTop =
                logBox.scrollHeight;
        }

        syncProcessDetailsPopup(
            card
        );

        if (
            data.status
            === 'completed'
        ) {

            progressBar.style.width =
                '100%';

            progressText.textContent =
                '100%';

            progressStage.textContent =
                data.message || 'Hoàn tất';

            stopButton.style.display =
                'none';

            video.processing =
                false;

            video.active_mode =
                null;

            video.active_channel =
                null;

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
                    ${uiIcon('play', 16)} Xem kết quả
                </button>

                <a
                    class="secondary download-finished"
                    style="
                        display:inline-block;
                        text-decoration:none;
                    "
                    href="/api/result/${encodeURIComponent(video.video_id)}?channel=${encodeURIComponent(channel)}&mode=${encodeURIComponent(mode)}&v=${Date.now()}"
                >
                    ${uiIcon('download', 16)} Tải kết quả
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

            card.classList.remove(
                'is-processing'
            );

            card.classList.add(
                'has-process-complete'
            );

            updateInlineProcessStatus(
                card,
                '100%',
                'Đã hoàn tất',
                'complete'
            );

            syncProcessDetailsPopup(
                card,
                {
                    finished: true,
                    percent: '100%',
                    stage: progressStage.textContent
                }
            );

            return;
        }

        if (
            data.status
            === 'stopping'
        ) {

            progressStage.textContent =
                'Đang dừng tiến trình...';

            stopButton.disabled =
                true;

            updateInlineProcessStatus(
                card,
                `${percent}%`,
                'Đang dừng...'
            );

            syncProcessDetailsPopup(
                card,
                {
                    stage: 'Đang dừng...'
                }
            );

            continue;
        }

        if (
            data.status
            === 'cancelled'
        ) {

            video.processing =
                false;

            video.active_mode =
                null;

            video.active_channel =
                null;

            progressStage.textContent =
                'Đã dừng';

            stopButton.style.display =
                'none';

            subButton.disabled =
                false;

            voiceButton.disabled =
                false;

            card.classList.remove(
                'is-processing'
            );

            card.classList.add(
                'has-process-stopped'
            );

            updateInlineProcessStatus(
                card,
                `${percent}%`,
                'Đã dừng',
                'complete'
            );

            syncProcessDetailsPopup(
                card,
                {
                    stopped: true,
                    percent: `${percent}%`,
                    stage: 'Đã dừng'
                }
            );

            return;
        }


        if (
            data.status
            === 'failed'
        ) {

            video.processing =
                false;

            video.active_mode =
                null;

            video.active_channel =
                null;

            stopButton.style.display =
                'none';

            video.db_status =
                'failed';

            subButton.disabled =
                false;

            voiceButton.disabled =
                false;

            card.classList.remove(
                'is-processing'
            );

            card.classList.add(
                'has-process-error'
            );

            updateInlineProcessStatus(
                card,
                'Lỗi',
                'Xem chi tiết lỗi',
                'error'
            );

            syncProcessDetailsPopup(
                card,
                {
                    error: true,
                    percent: `${percent}%`,
                    stage: data.message || 'Pipeline thất bại.'
                }
            );

            throw new Error(
                data.message
                || 'Pipeline thất bại.'
            );
        }
    }
}


async function openPlayer(
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

    player.crossOrigin = 'anonymous';
    player.src = await window.reupEngineClient.mediaUrl(
        `/api/stream/${encodeURIComponent(video.video_id)}`
        + `?channel=${encodeURIComponent(channel)}`
        + `&mode=${encodeURIComponent(mode)}`
        + `&v=${Date.now()}`
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


function isChannelSourceUrl(url, platform) {

    const value = String(url || '').toLowerCase();

    if (platform === 'bilibili') {
        return /space\.bilibili\.com\/\d+/.test(value);
    }

    if (platform === 'douyin') {
        return /douyin\.com\/user\//.test(value);
    }

    return false;
}


async function apiJson(
    url,
    options = {}
) {

    const response = await window.reupEngineClient.request(url, options);

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
        #selectVisibleBtn,
        #seriesQuickBtn {
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
        #selectVisibleBtn:hover,
        #seriesQuickBtn:hover {
            background: #202b40 !important;
            border-color: #3a4964 !important;
        }

        #seriesQuickBtn {
            gap: 6px;
        }

        #seriesQuickBtn strong {
            min-width: 18px;
            padding: 2px 5px;
            border-radius: 999px;
            background: rgba(124, 108, 255, .18);
            color: #c7c0ff;
            font-size: 10px;
            line-height: 1.1;
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

        .compact-meta .media-facts {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            flex: 0 0 auto;
            min-height: 20px;
            margin-left: 3px;
            padding: 2px 7px;
            border: 1px solid #293b56;
            border-radius: 999px;
            background: #142035;
            white-space: nowrap;
        }

        .compact-meta .media-inline {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            color: #9ba9bc;
            font-size: inherit;
            font-weight: 700;
            line-height: 1;
        }

        .compact-meta .media-inline .ui-icon {
            width: 12px;
            height: 12px;
            color: #91a2ba;
        }

        .compact-meta .source-video-id {
            color: #8392a8;
            font-variant-numeric: tabular-nums;
        }

        .compact-meta .meta-divider {
            color: #465774;
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


    const polish = (
        document.createElement(
            'style'
        )
    );

    polish.id =
        'v133Polish';

    polish.textContent = `
        :root {
            --v133-bg: #0d1420;
            --v133-panel: #121b2a;
            --v133-panel-2: #172234;
            --v133-line: #26344a;
            --v133-text: #f4f7fb;
            --v133-muted: #8291a8;
            --v133-accent: #7b6dff;
            --v133-danger: #ff6b6b;
        }

        #videos.grid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            gap: 14px !important;
        }

        .v13-manager {
            padding: 8px 10px !important;
            background: #101826 !important;
            border: 1px solid #202e43 !important;
            box-shadow: none !important;
        }

        .v13-toolbar {
            gap: 8px !important;
        }

        .source-quick-switch {
            display: flex;
            align-items: center;
            gap: 7px;
            flex: 1 1 440px;
            min-width: 320px;
        }

        #savedSourceSelect {
            flex: 1 1 auto !important;
            max-width: 420px !important;
            height: 38px !important;
            color: var(--v133-text) !important;
            background: #0d1420 !important;
            border: 1px solid var(--v133-line) !important;
            border-radius: 10px !important;
        }

        .toolbar-button,
        .panel-primary,
        .toolbar-icon-button,
        .danger-icon-button {
            display: inline-flex !important;
            align-items: center;
            justify-content: center;
            gap: 7px;
            min-height: 38px !important;
            border-radius: 9px !important;
            font-size: 12px !important;
            font-weight: 700 !important;
            line-height: 1 !important;
            box-shadow: none !important;
        }

        .toolbar-button,
        .toolbar-icon-button {
            border: 1px solid var(--v133-line) !important;
            background: #172234 !important;
            color: #dce5f2 !important;
        }

        .toolbar-button:hover,
        .toolbar-icon-button:hover {
            background: #202d42 !important;
            border-color: #3a4b68 !important;
        }

        .panel-primary {
            border: 1px solid transparent !important;
            background: var(--v133-accent) !important;
            color: white !important;
        }

        .danger-icon-button {
            width: 38px;
            min-width: 38px;
            padding: 0 !important;
            border: 1px solid rgba(255,107,107,.22) !important;
            background: rgba(255,107,107,.08) !important;
            color: #ff8a8a !important;
        }

        .toolbar-icon-button {
            width: 38px;
            min-width: 38px;
            padding: 0 !important;
        }

        .toolbar-separator {
            width: 1px;
            height: 24px;
            background: #28364b;
        }

        .compact-popover-panel {
            background: #111a28 !important;
            border-color: #2a3950 !important;
            box-shadow: 0 20px 60px rgba(0,0,0,.38) !important;
        }

        .panel-heading {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 10px;
        }

        .panel-title {
            color: #f3f6fa;
            font-size: 13px;
            font-weight: 800;
        }

        .panel-subtitle {
            margin-top: 3px;
            color: #6f7f96;
            font-size: 10.5px;
        }

        .panel-divider {
            height: 1px;
            margin: 12px 0;
            background: rgba(148,163,184,.12);
        }

        .source-manage-actions {
            justify-content: flex-end;
        }

        .library-shortcut-row {
            display: flex;
        }

        .library-shortcut {
            display: inline-flex !important;
            align-items: center;
            gap: 8px;
            min-height: 38px !important;
            padding: 0 12px !important;
            border: 1px solid #2b3950 !important;
            border-radius: 9px !important;
            background: #172234 !important;
            color: #dce5f2 !important;
        }

        .compact-video-card {
            grid-template-columns: 30px 164px minmax(0,1fr) !important;
            gap: 13px !important;
            min-height: 146px !important;
            padding: 13px !important;
            border-color: #26344a !important;
            background: #111a28 !important;
        }

        .compact-video-card .compact-cover {
            width: 164px !important;
            height: 112px !important;
            min-height: 112px !important;
        }

        .select-control {
            align-self: start;
            width: 30px;
            height: 34px;
            display: grid;
            place-items: center;
            cursor: pointer;
        }

        .select-control input {
            position: absolute;
            opacity: 0;
            pointer-events: none;
        }

        .select-visual {
            width: 20px;
            height: 20px;
            border-radius: 6px;
            border: 1.5px solid #4b5c78;
            background: #0e1623;
            position: relative;
            transition: .15s ease;
        }

        .select-control input:checked + .select-visual {
            background: var(--v133-accent);
            border-color: var(--v133-accent);
            box-shadow: 0 0 0 3px rgba(123,109,255,.12);
        }

        .select-control input:checked + .select-visual::after {
            content: "";
            position: absolute;
            left: 6px;
            top: 2px;
            width: 5px;
            height: 10px;
            border: solid #fff;
            border-width: 0 2px 2px 0;
            transform: rotate(45deg);
        }

        .card-header-row {
            display: flex;
            align-items: flex-start;
            gap: 10px;
        }

        .modern-icon-btn {
            width: 36px !important;
            height: 36px !important;
            min-width: 36px !important;
            padding: 0 !important;
            display: inline-grid !important;
            place-items: center;
            border-radius: 10px !important;
            border: 1px solid #2b3a52 !important;
            background: #141f30 !important;
            color: #8090a8 !important;
            box-shadow: none !important;
        }

        .favorite-btn {
            color: #8a99ae !important;
        }

        .favorite-btn.is-favorite {
            color: #9a8cff !important;
            background: rgba(123,109,255,.12) !important;
            border-color: rgba(123,109,255,.34) !important;
        }

        .favorite-btn.is-favorite svg {
            fill: currentColor;
        }

        .card-action-row {
            display: flex;
            align-items: center;
            gap: 7px;
            margin-top: 9px;
        }

        .action-primary,
        .action-secondary {
            min-height: 34px !important;
            padding: 0 13px !important;
            border-radius: 9px !important;
            font-size: 11.5px !important;
            font-weight: 750 !important;
            box-shadow: none !important;
        }

        .action-primary {
            background: var(--v133-accent) !important;
            color: white !important;
            border: 1px solid transparent !important;
        }

        .action-secondary {
            background: #172234 !important;
            color: #ecf1f7 !important;
            border: 1px solid #304058 !important;
        }

        .result-chip-group {
            display: inline-flex;
            gap: 5px;
        }

        .result-chip {
            min-height: 30px;
            padding: 0 8px;
            border: 1px solid rgba(52,211,153,.2);
            border-radius: 8px;
            background: rgba(52,211,153,.07);
            color: #6ee7b7;
            font-size: 9.5px;
            font-weight: 800;
        }

        .more-trigger {
            width: 34px !important;
            min-width: 34px !important;
            height: 34px !important;
            display: inline-flex !important;
            align-items: center;
            justify-content: center;
            gap: 3px;
            padding: 0 !important;
        }

        .more-trigger span {
            width: 3px;
            height: 3px;
            border-radius: 50%;
            background: currentColor;
        }

        .more-menu-panel {
            width: 250px !important;
            padding: 8px !important;
        }

        .menu-action {
            display: flex !important;
            align-items: center;
            gap: 9px;
            min-height: 36px !important;
        }

        .menu-section {
            padding: 8px 5px 3px;
            border-top: 1px solid rgba(148,163,184,.10);
            margin-top: 5px;
        }

        .menu-section-title {
            margin-bottom: 6px;
            color: #74849a;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: .06em;
        }

        .menu-section select,
        .card-collection-select {
            width: 100%;
            height: 34px !important;
            min-height: 34px !important;
            border: 1px solid #2b3950 !important;
            border-radius: 8px !important;
            background: #0d1521 !important;
            color: #dbe4ef !important;
            font-size: 11px !important;
        }

        .collection-inline {
            display: grid;
            grid-template-columns: minmax(0,1fr) 36px;
            gap: 6px;
        }

        .collection-inline-add {
            width: 36px !important;
            height: 34px !important;
            min-width: 36px !important;
        }

        .progress-wrap {
            margin-top: 10px !important;
            padding: 9px 10px !important;
            border: 1px solid rgba(148,163,184,.10) !important;
            border-radius: 10px !important;
            background: #0d1521 !important;
        }

        .progress-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin-bottom: 7px;
        }

        .progress-copy {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            min-width: 0;
            flex: 1;
        }

        .progress-stage {
            color: #aab7c9;
            font-size: 10.5px;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
        }

        .progress-text {
            margin: 0 !important;
            color: #8291a8 !important;
            font-size: 10.5px !important;
            white-space: nowrap;
        }

        .stop-process-btn {
            display: none !important;
            width: 30px !important;
            height: 30px !important;
            min-width: 30px !important;
            border-color: rgba(255,107,107,.25) !important;
            background: rgba(255,107,107,.08) !important;
            color: #ff8585 !important;
        }

        .progress-wrap[style*="display: block"] .stop-process-btn {
            display: inline-grid !important;
        }

        .progress {
            height: 5px !important;
            margin: 0 !important;
        }

        .progress-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-top: 7px;
        }

        .process-details {
            min-width: 0;
            flex: 1;
        }

        .process-details > summary {
            list-style: none;
            width: max-content;
            color: #65758d;
            font-size: 10px;
            cursor: pointer;
            user-select: none;
        }

        .process-details > summary::-webkit-details-marker {
            display: none;
        }

        .process-details[open] > summary {
            color: #9a8cff;
        }

        .process-details .log {
            max-height: 120px !important;
            margin: 8px 0 0 !important;
            padding: 8px !important;
            border-radius: 8px;
            background: #09101a !important;
            color: #8292aa !important;
            font-size: 9.5px !important;
            white-space: pre-wrap;
            overflow: auto;
        }

        .dynamic-results {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
            justify-content: flex-end;
        }

        .dynamic-results button,
        .dynamic-results a {
            min-height: 30px !important;
            padding: 0 9px !important;
            border-radius: 8px !important;
            font-size: 10px !important;
        }

        .batch-bar {
            gap: 5px !important;
            padding: 6px !important;
            border-radius: 12px !important;
            background: #111a28 !important;
            border-color: #2c3b53 !important;
        }

        .batch-count {
            padding: 0 8px !important;
        }

        .batch-bar #batchSubtitle {
            background: var(--v133-accent) !important;
        }

        @media (max-width: 1200px) {
            #videos.grid {
                grid-template-columns: 1fr !important;
            }
        }

        @media (max-width: 760px) {
            .compact-video-card {
                grid-template-columns: 26px 110px minmax(0,1fr) !important;
            }

            .compact-video-card .compact-cover {
                width: 110px !important;
                height: 82px !important;
                min-height: 82px !important;
            }

            .source-quick-switch {
                min-width: 100%;
            }
        }
    `;

    document.head.appendChild(
        polish
    );


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
            'Đã lưu';

        select.appendChild(
            option
        );
    }
}


function simplifySourceManager(manager) {

    const popovers = [
        ...manager.querySelectorAll(
            '.compact-popover'
        )
    ];

    for (const popover of popovers) {

        const label = (
            popover.querySelector(
                'summary'
            )?.textContent
            || ''
        ).trim();

        if (label === 'Quản lý nguồn' || label === 'Link video') {
            popover.remove();
        }
    }

    const libraryPopover = [
        ...manager.querySelectorAll(
            '.compact-popover'
        )
    ].find(
        popover => (
            popover.querySelector('summary')?.textContent || ''
        ).trim() === 'Thư viện'
    );

    if (!libraryPopover) {
        return;
    }

    const seriesSelect = libraryPopover.querySelector('#seriesSelect');
    const seriesRow = seriesSelect?.closest('.compact-row');
    const seriesHeading = [
        ...libraryPopover.querySelectorAll('.panel-heading')
    ].find(
        heading => heading.textContent.includes('Series')
    );

    if (!seriesSelect || !seriesRow) {
        libraryPopover.remove();
        return;
    }

    const seriesPopover = document.createElement('details');
    seriesPopover.className = 'compact-popover';
    seriesPopover.innerHTML = `
        <summary class="toolbar-button">Series</summary>
        <div class="compact-popover-panel series-panel"></div>
    `;

    const panel = seriesPopover.querySelector('.series-panel');

    if (seriesHeading) {
        panel.appendChild(seriesHeading);
    }

    panel.appendChild(seriesRow);
    libraryPopover.replaceWith(seriesPopover);
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

            <div class="source-quick-switch">

                <select id="savedSourceSelect">
                    <option value="">
                        Chọn nguồn đã lưu
                    </option>
                </select>

                <button
                    type="button"
                    class="toolbar-button"
                    id="openSavedSource"
                >
                    Mở
                </button>

            </div>

            <div class="toolbar-separator"></div>

            <button
                type="button"
                class="toolbar-button"
                id="selectVisibleBtn"
            >
                Chọn trang
            </button>

            <button
                type="button"
                class="toolbar-button series-quick-button"
                id="seriesQuickBtn"
                title="Xem các video được gom theo series"
            >
                ${uiIcon('folder', 16)}
                <span>Series</span>
                <strong id="seriesQuickCount">0</strong>
            </button>

            <details class="compact-popover">

                <summary class="toolbar-button">
                    Quản lý nguồn
                </summary>

                <div class="compact-popover-panel">

                    <div class="panel-heading">
                        <div>
                            <div class="panel-title">
                                Nguồn
                            </div>
                            <div class="panel-subtitle">
                                Lưu hoặc xóa nguồn đang chọn
                            </div>
                        </div>
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

                    <div class="compact-row source-manage-actions">

                        <button
                            type="button"
                            class="panel-primary"
                            id="saveCurrentSource"
                        >
                            ${uiIcon('plus', 16)}
                            <span>Lưu nguồn</span>
                        </button>

                        <button
                            type="button"
                            class="danger-icon-button"
                            id="deleteSavedSource"
                            title="Xóa nguồn đang chọn"
                            aria-label="Xóa nguồn đang chọn"
                        >
                            ${uiIcon('trash', 17)}
                        </button>

                    </div>

                    <div
                        class="compact-help"
                        id="savedSourceInfo"
                    >
                        Chọn nguồn ở thanh phía trên để quản lý.
                    </div>

                </div>

            </details>


            <details class="compact-popover">

                <summary class="toolbar-button">
                    Link video
                </summary>

                <div class="compact-popover-panel">

                    <div class="panel-heading">
                        <div>
                            <div class="panel-title">
                                Video từ link
                            </div>
                            <div class="panel-subtitle">
                                Bilibili hoặc Douyin
                            </div>
                        </div>
                    </div>

                    <div class="compact-row">
                        <input
                            id="directVideoUrl"
                            type="text"
                            placeholder="Dán link video..."
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
                            class="panel-primary"
                            id="openDirectVideo"
                        >
                            Lấy video
                        </button>
                    </div>

                </div>

            </details>


            <details class="compact-popover">

                <summary class="toolbar-button">
                    Thư viện
                </summary>

                <div class="compact-popover-panel library-panel">

                    <div class="library-shortcut-row">

                        <button
                            type="button"
                            class="library-shortcut"
                            id="showFavorites"
                        >
                            ${uiIcon('heart', 17)}
                            <span>Yêu thích</span>
                        </button>

                    </div>

                    <div class="panel-divider"></div>

                    <div class="panel-heading">
                        <div>
                            <div class="panel-title">
                                Danh mục
                            </div>
                            <div class="panel-subtitle">
                                Tạo và quản lý danh sách video
                            </div>
                        </div>
                    </div>

                    <div class="compact-row">

                        <select id="collectionSelect">
                            <option value="">
                                Chọn danh mục
                            </option>
                        </select>

                        <button
                            type="button"
                            class="toolbar-icon-button"
                            id="openCollection"
                            title="Mở danh mục"
                            aria-label="Mở danh mục"
                        >
                            ${uiIcon('eye', 17)}
                        </button>

                        <button
                            type="button"
                            class="danger-icon-button"
                            id="deleteCollection"
                            title="Xóa danh mục"
                            aria-label="Xóa danh mục"
                        >
                            ${uiIcon('trash', 17)}
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
                            class="panel-primary"
                            id="createCollection"
                        >
                            ${uiIcon('plus', 16)}
                            <span>Tạo</span>
                        </button>
                    </div>

                    <div class="panel-divider"></div>

                    <div class="panel-heading">
                        <div>
                            <div class="panel-title">
                                Series tự nhận diện
                            </div>
                            <div class="panel-subtitle">
                                Gom theo tên và số tập trong tiêu đề
                            </div>
                        </div>
                    </div>

                    <div class="compact-row">
                        <select id="seriesSelect">
                            <option value="">
                                Chọn series
                            </option>
                        </select>

                        <button
                            type="button"
                            class="toolbar-icon-button"
                            id="openSeries"
                            title="Mở series"
                            aria-label="Mở series"
                        >
                            ${uiIcon('eye', 17)}
                        </button>
                    </div>

                </div>

            </details>

            <span
                id="v13ViewLabel"
                class="v13-view-label"
            >
                Nguồn hiện tại
            </span>

        </div>
    `;

    simplifySourceManager(manager);

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
        renderTrackedSourcesSidebar();
        updateFollowSourceButton();

        if (
            currentView
            === 'tracked'
        ) {

            renderTrackedSourcesView();
        }

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
        || !isChannelSourceUrl(
            url,
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

    await openTrackedSource(
        source
    );
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

        button.classList.toggle(
            'is-favorite',
            video.favorite
        );

        button.title =
            (
                video.favorite
                ? 'Bỏ yêu thích'
                : 'Yêu thích'
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


async function addVideoToCollectionId(
    video,
    collectionId,
    card = null
) {

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
                Number(
                    collectionId
                )
            ])
        );

        await loadCollections();
        await loadSeries();

        if (card) {

            const select = (
                card.querySelector(
                    '.card-collection-select'
                )
            );

            if (select) {

                select.innerHTML =
                    collectionOptionsHtml(
                        video.collection_ids
                    );

                select.value =
                    String(
                        collectionId
                    );
            }

            const details = (
                card.querySelector(
                    '.more-menu'
                )
            );

            if (details) {

                details.open =
                    false;
            }
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
            '.collection-inline-add-unused'
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

    activeSeriesKey = (
        params
        && params.series
        ? String(params.series)
        : ''
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

    const root = (
        document.getElementById(
            'videos'
        )
    );

    if (root) {

        root.classList.remove(
            'tracked-sources-view'
        );
    }

    setTrackedSidebarActive(
        false
    );

    setSidebarFavoriteActive(
        true
    );

    await loadLibraryView(
        {
            favorite:
                true
        },
        'Video yêu thích'
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

        librarySeriesGroups = [
            ...seriesGroups
        ];

        const select = (
            document.getElementById(
                'seriesSelect'
            )
        );

        const quickCount = (
            document.getElementById(
                'seriesQuickCount'
            )
        );

        if (quickCount) {
            quickCount.textContent = String(seriesGroups.length);
        }

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
                    + (
                        item.source_label
                        ? ` · ${item.source_label}`
                        : ''
                    )
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


function mergeCurrentVideoSeries() {

    const localGroups = new Map();

    // Khi đang xem một nguồn cụ thể, chỉ giữ lại series thuộc nguồn đó.
    // Danh sách tổng chỉ dùng cho các màn hình thư viện/tất cả nguồn.
    const savedSource = (
        typeof savedSourceForCurrentUrl === 'function'
            ? savedSourceForCurrentUrl()
            : null
    );

    const currentSourceId = (
        savedSource?.id
        || currentVideos.find(video => video.source_id)?.source_id
        || null
    );

    const hasCurrentSourceContext = (
        currentView === 'source'
        && typeof currentSourceUrl === 'function'
        && !!currentSourceUrl()
    );

    const seriesCandidates = (
        currentView === 'source'
            ? Object.values(pageCache).flat()
            : currentVideos
    );

    for (const video of seriesCandidates) {

        const key = String(video.series_key || '').trim();
        const name = String(video.series_name || '').trim();

        if (!key || !name) {
            continue;
        }

        const group = localGroups.get(key) || {
            series_key: key,
            name,
            count: 0,
            episodes: [],
            sourceNames: new Set(),
            localOnly: true,
        };

        group.count += 1;

        if (video.episode_number !== null && video.episode_number !== undefined) {
            group.episodes.push(Number(video.episode_number));
        }

        const sourceName = String(
            video.source_name
            || video.channel_name
            || video.platform
            || ''
        ).trim();

        if (sourceName) {
            group.sourceNames.add(sourceName);
        }

        localGroups.set(key, group);
    }

    const scopedLibrarySeries = currentSourceId
        ? librarySeriesGroups.filter(item => (
            item.sources || []
        ).some(source => Number(source.source_id) === Number(currentSourceId)))
        : hasCurrentSourceContext
            ? []
            : librarySeriesGroups;

    const merged = new Map(
        scopedLibrarySeries.map(item => [item.series_key, {
            ...item,
            episodes: [...(item.episodes || [])],
        }])
    );

    for (const [key, local] of localGroups) {

        const existing = merged.get(key);

        if (existing) {
            existing.episodes = Array.from(
                new Set([
                    ...(existing.episodes || []),
                    ...(local.episodes || []),
                ])
            ).sort((a, b) => a - b);

            if (local.sourceNames.size) {
                const names = new Set(
                    String(existing.source_label || '')
                        .split(' / ')
                        .map(value => value.trim())
                        .filter(Boolean)
                );
                local.sourceNames.forEach(name => names.add(name));
                existing.source_label = Array.from(names).join(' / ');
            }
        } else {
            local.episodes = Array.from(
                new Set(local.episodes)
            ).sort((a, b) => a - b);
            local.source_label = Array.from(local.sourceNames).join(' / ');
            delete local.sourceNames;
            merged.set(key, local);
        }
    }

    seriesGroups = Array.from(merged.values()).sort(
        (a, b) => Number(b.count || 0) - Number(a.count || 0)
    );

    const select = document.getElementById('seriesSelect');

    if (!select) {
        return;
    }

    const previous = select.value;

    select.innerHTML = `
        <option value="">Chọn series tự nhận diện</option>
    `;

    for (const item of seriesGroups) {
        const option = document.createElement('option');
        option.value = item.series_key;
        option.textContent = `${item.name} · ${item.count} phần${item.source_label ? ` · ${item.source_label}` : ''}`;
        select.appendChild(option);
    }

    if (previous && Array.from(select.options).some(option => option.value === previous)) {
        select.value = previous;
    }

    const quickCount = document.getElementById('seriesQuickCount');

    if (quickCount) {
        quickCount.textContent = String(seriesGroups.length);
    }

    const sourceSeriesButton = document.getElementById('sourceSeriesBtn');

    if (sourceSeriesButton) {
        sourceSeriesButton.innerHTML = `${uiIcon('folder', 16)} Series${seriesGroups.length ? ` (${seriesGroups.length})` : ''}`;
        sourceSeriesButton.disabled = seriesGroups.length === 0;
        sourceSeriesButton.title = seriesGroups.length
            ? 'Xem Series của nguồn hiện tại'
            : 'Nguồn hiện tại chưa có Series tự nhận diện';
    }
}


function focusSeriesPicker() {

    const select = (
        document.getElementById(
            'seriesSelect'
        )
    );

    if (!select) {
        return;
    }

    const details = (
        select.closest(
            'details'
        )
    );

    if (details) {
        details.open = true;
    }

    select.focus();
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

    const localVideos = currentVideos.filter(
        video => video.series_key === key
    );

    if (localVideos.length && currentView === 'source') {
        activeSeriesKey = key;
        updateViewLabel(item?.name || 'Series');
        renderVideos();
        updateSourceInfo(`${item?.name || 'Series'} · ${localVideos.length} phần`);
        saveUiState();
        return;
    }

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
            id="batchDownload"
        >
            Tải
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
        'seriesQuickBtn',
        'click',
        () => {
            focusSeriesPicker();
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
        'followCurrentSource',
        'click',
        () => {
            followCurrentSource();
        }
    );

    bind(
        'sourceInputMode',
        'change',
        () => {
            updateFollowSourceButton();
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
            const select = document.getElementById('seriesSelect');
            activeSeriesKey = select?.value || '';

            if (!activeSeriesKey && currentView === 'series') {
                currentView = 'source';
            }

            renderVideos();
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
// V13.7 TRACKED SOURCES
// =========================================================

function normalizeSourceUrlClient(
    value
) {

    try {

        const url = (
            new URL(
                String(
                    value
                    || ''
                ),
                window.location.origin
            )
        );

        url.hash =
            '';

        url.search =
            '';

        let path = (
            url.pathname
            || '/'
        );

        if (
            path.length > 1
        ) {

            path = (
                path.replace(
                    /\/+$/,
                    ''
                )
            );
        }

        return (
            `${url.protocol}//${url.host}${path}`
        )
        .toLowerCase();

    } catch {

        return (
            String(
                value
                || ''
            )
            .trim()
            .replace(
                /[?#].*$/,
                ''
            )
            .replace(
                /\/+$/,
                ''
            )
            .toLowerCase()
        );
    }
}


function currentSourceUrl() {

    return (
        document
        .getElementById(
            'sourceUrl'
        )
        ?.value
        ?.trim()
        || ''
    );
}


function savedSourceForCurrentUrl() {

    const current = (
        normalizeSourceUrlClient(
            currentSourceUrl()
        )
    );

    if (!current) {
        return null;
    }

    return (
        savedSources.find(
            source =>
                normalizeSourceUrlClient(
                    source.profile_url
                )
                === current
        )
        || null
    );
}


function sourceDisplayNameFromContext(
    platform,
    url
) {

    const firstVideo = (
        currentVideos[
            0
        ]
        || {}
    );

    const candidates = [
        firstVideo.source_name,
        firstVideo.author_name,
        firstVideo.uploader,
        firstVideo.creator_name,
        firstVideo.owner_name,
    ];

    for (
        const value
        of candidates
    ) {

        const text = (
            String(
                value
                || ''
            )
            .trim()
        );

        if (text) {
            return text;
        }
    }

    try {

        const parsed = (
            new URL(
                url
            )
        );

        if (
            platform
            === 'bilibili'
        ) {

            const match = (
                parsed.pathname
                .match(
                    /\/(\d{4,})/
                )
            );

            if (match) {

                return (
                    `Bilibili ${match[1]}`
                );
            }
        }

        if (
            platform
            === 'douyin'
        ) {

            const match = (
                parsed.pathname
                .match(
                    /\/user\/([^/?#]+)/
                )
            );

            if (match) {

                const shortId = (
                    decodeURIComponent(
                        match[1]
                    )
                    .slice(
                        0,
                        12
                    )
                );

                return (
                    `Douyin ${shortId}`
                );
            }
        }

    } catch {
        // ignore
    }

    return (
        platform
        === 'douyin'
        ? 'Kênh Douyin'
        : 'Kênh Bilibili'
    );
}


function updateFollowSourceButton() {

    const button = (
        document.getElementById(
            'followCurrentSource'
        )
    );

    if (!button) {
        return;
    }

    const url = (
        currentSourceUrl()
    );

    const platform = (
        detectPlatformClient(
            url
        )
    );

    const inputMode = (
        document
        .getElementById(
            'sourceInputMode'
        )
        ?.value
        || 'channel'
    );

    const followed = (
        savedSourceForCurrentUrl()
    );

    const label = (
        button.querySelector(
            'span'
        )
    );

    if (
        !url
        || inputMode !== 'channel'
        || ![
            'bilibili',
            'douyin'
        ].includes(
            platform
        )
        || !isChannelSourceUrl(
            url,
            platform
        )
    ) {

        button.hidden = true;

        button.disabled =
            true;

        button.classList.remove(
            'is-following'
        );

        if (label) {
            label.textContent =
                'Theo dõi';
        }

        return;
    }

    button.hidden = false;

    if (followed) {

        button.disabled =
            true;

        button.classList.add(
            'is-following'
        );

        if (label) {
            label.textContent =
                'Đang theo dõi';
        }

    } else {

        button.disabled =
            false;

        button.classList.remove(
            'is-following'
        );

        if (label) {
            label.textContent =
                'Theo dõi';
        }
    }
}


function ensureFollowSourceDialog() {

    if (document.getElementById('followSourceDialog')) {
        return document.getElementById('followSourceDialog');
    }

    const dialog = document.createElement('dialog');
    dialog.id = 'followSourceDialog';
    dialog.innerHTML = `
        <form method="dialog" class="follow-source-dialog">
            <div class="follow-dialog-head">
                <div>
                    <h3>Lưu nguồn theo dõi</h3>
                    <p>Chọn ảnh đại diện và đặt tên để lần sau mở nhanh.</p>
                </div>
                <button type="button" class="dialog-close" id="cancelFollowSource" aria-label="Đóng">${uiIcon('close', 16)}</button>
            </div>

            <label class="dialog-label" for="followSourceName">Tên nguồn</label>
            <input id="followSourceName" autocomplete="off" placeholder="Tên kênh">

            <label class="dialog-label">Thumbnail nguồn</label>
            <div id="followSourceThumbs" class="follow-source-thumbs"></div>

            <div class="follow-dialog-actions">
                <button type="button" class="btn secondary" id="cancelFollowSourceBottom">Hủy</button>
                <button type="button" class="btn primary" id="confirmFollowSource">Lưu theo dõi</button>
            </div>
        </form>
    `;

    document.body.appendChild(dialog);

    const close = () => dialog.close();
    dialog.querySelector('#cancelFollowSource').addEventListener('click', close);
    dialog.querySelector('#cancelFollowSourceBottom').addEventListener('click', close);
    dialog.querySelector('#confirmFollowSource').addEventListener(
        'click',
        submitFollowSource
    );

    return dialog;
}


function openFollowSourceDialog() {

    const url = currentSourceUrl();
    const platform = detectPlatformClient(url);
    const inputMode = document.getElementById('sourceInputMode')?.value || 'channel';

    if (!url || inputMode !== 'channel' || !isChannelSourceUrl(url, platform)) {
        alert('Hãy chọn “Cả kênh” rồi dán link kênh trước.');
        return;
    }

    const dialog = ensureFollowSourceDialog();
    const nameInput = dialog.querySelector('#followSourceName');
    const thumbs = dialog.querySelector('#followSourceThumbs');
    const candidates = currentVideos.filter(video => video.cover_url);

    nameInput.value = sourceDisplayNameFromContext(platform, url);
    thumbs.innerHTML = candidates.length
        ? candidates.slice(0, 8).map((video, index) => `
            <button type="button" class="follow-thumb ${index === 0 ? 'selected' : ''}" data-cover="${escapeHtml(video.cover_url)}">
                <img data-engine-cover="${escapeHtml(coverUrl(video.cover_url))}" alt="">
                <span>${escapeHtml(video.title || `Video ${index + 1}`)}</span>
            </button>
        `).join('')
        : '<div class="follow-thumb-empty">Nguồn chưa có thumbnail. Sẽ dùng ảnh mặc định.</div>';

    thumbs.querySelectorAll('.follow-thumb').forEach(button => {
        button.addEventListener('click', () => {
            thumbs.querySelectorAll('.follow-thumb').forEach(item => item.classList.remove('selected'));
            button.classList.add('selected');
        });
    });

    dialog.showModal();
}


async function submitFollowSource() {

    const dialog = document.getElementById('followSourceDialog');
    const url = currentSourceUrl();
    const platform = detectPlatformClient(url);
    const name = dialog.querySelector('#followSourceName').value.trim()
        || sourceDisplayNameFromContext(platform, url);
    const selectedThumb = dialog.querySelector('.follow-thumb.selected');
    const cover = selectedThumb?.dataset.cover || '';
    const button = dialog.querySelector('#confirmFollowSource');

    button.disabled = true;
    button.textContent = 'Đang lưu...';

    try {
        const data = await apiJson('/api/library/sources', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                platform,
                name,
                url,
                channel: '2d_animation',
                cover_url: cover,
                auto_process: false,
                min_views: 0,
            }),
        });

        dialog.close();
        await loadSavedSources();

        const select = document.getElementById('savedSourceSelect');
        if (data.source && select) {
            select.value = String(data.source.id);
        }

        updateFollowSourceButton();
        renderTrackedSourcesSidebar();
    } catch (error) {
        alert(error.message);
    } finally {
        button.disabled = false;
        button.textContent = 'Lưu theo dõi';
    }
}


async function followCurrentSource() {

    openFollowSourceDialog();
    return;

    const url = (
        currentSourceUrl()
    );

    const platform = (
        detectPlatformClient(
            url
        )
    );

    if (
        !url
        || ![
            'bilibili',
            'douyin'
        ].includes(
            platform
        )
    ) {

        alert(
            'Mở một nguồn Bilibili hoặc Douyin trước.'
        );

        return;
    }

    const existing = (
        savedSourceForCurrentUrl()
    );

    if (existing) {

        updateFollowSourceButton();
        return;
    }

    const channel = (
        document
        .getElementById(
            'saveSourceChannel'
        )
        ?.value
        || '2d_animation'
    );

    const name = (
        sourceDisplayNameFromContext(
            platform,
            url
        )
    );

    const button = (
        document.getElementById(
            'followCurrentSource'
        )
    );

    if (button) {

        button.disabled =
            true;
    }

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
                                url,

                            channel:
                                channel,

                            auto_process:
                                false,

                            min_views:
                                0
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
        }

        updateFollowSourceButton();
        renderTrackedSourcesSidebar();

    } catch (
        error
    ) {

        if (button) {

            button.disabled =
                false;
        }

        alert(
            error.message
        );
    }
}


function findTrackedSourcesSidebarItem() {

    const candidates = [
        ...document.querySelectorAll(
            'a, button, div, li'
        )
    ];

    return (
        candidates.find(
            element => {

                const text = (
                    element.textContent
                    || ''
                )
                .replace(
                    /\s+/g,
                    ' '
                )
                .trim()
                .toLowerCase();

                if (
                    !text.startsWith(
                        'nguồn theo dõi'
                    )
                ) {
                    return false;
                }

                const nestedMatch = (
                    [
                        ...element.children
                    ]
                    .some(
                        child =>
                            (
                                child.textContent
                                || ''
                            )
                            .replace(
                                /\s+/g,
                                ' '
                            )
                            .trim()
                            .toLowerCase()
                            .startsWith(
                                'nguồn theo dõi'
                            )
                    )
                );

                return !nestedMatch;
            }
        )
        || null
    );
}


function trackedSourcesIcon() {

    return `
        <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            <circle cx="12" cy="8" r="3"/>
            <path d="M6.5 19c.8-3.2 2.7-5 5.5-5s4.7 1.8 5.5 5"/>
            <path d="m18.5 5.5 1.5 1.5L22.5 4"/>
        </svg>
    `;
}


function setTrackedSidebarActive(
    active
) {

    const nav = (
        document.getElementById(
            'trackedSourcesNav'
        )
    );

    const sourceLink = (
        findSourcesSidebarLink()
    );

    const favoriteLink = (
        document.getElementById(
            'sidebarFavorites'
        )
    );

    if (!nav) {
        return;
    }

    nav.classList.toggle(
        'active',
        !!active
    );

    if (active) {

        nav.setAttribute(
            'aria-current',
            'page'
        );

        if (sourceLink) {
            sourceLink.classList.remove(
                'active'
            );
        }

        if (favoriteLink) {
            favoriteLink.classList.remove(
                'active'
            );
        }

    } else {

        nav.removeAttribute(
            'aria-current'
        );
    }
}


function ensureTrackedSourcesNav() {

    if (
        document.getElementById(
            'trackedSourcesNav'
        )
    ) {
        return;
    }

    const nav = (
        findTrackedSourcesSidebarItem()
    );

    if (!nav) {
        return;
    }

    nav.id =
        'trackedSourcesNav';

    nav.classList.remove(
        'disabled'
    );

    nav.removeAttribute(
        'disabled'
    );

    nav.removeAttribute(
        'aria-disabled'
    );

    nav.style.opacity =
        '1';

    nav.style.pointerEvents =
        'auto';

    nav.style.cursor =
        'pointer';

    if (
        nav.tagName
        .toLowerCase()
        === 'a'
    ) {

        nav.href =
            '/sources?view=tracked';

    } else {

        nav.setAttribute(
            'role',
            'button'
        );

        nav.setAttribute(
            'tabindex',
            '0'
        );
    }

    nav.innerHTML = `
        <span class="tracked-nav-icon">
            ${trackedSourcesIcon()}
        </span>

        <span class="tracked-nav-label">
            Nguồn theo dõi
        </span>

        <span
            class="tracked-nav-count"
            id="trackedSourcesCount"
        >
            ${savedSources.length}
        </span>
    `;

    const openView = event => {

        if (event) {
            event.preventDefault();
        }

        history.pushState(
            {
                view:
                    'tracked'
            },
            '',
            '/sources?view=tracked'
        );

        renderTrackedSourcesView();
    };

    nav.addEventListener(
        'click',
        openView
    );

    nav.addEventListener(
        'keydown',
        event => {

            if (
                event.key
                === 'Enter'
                || event.key
                === ' '
            ) {

                event.preventDefault();
                openView();
            }
        }
    );
}


function updateTrackedSourcesNavCount() {

    const count = (
        document.getElementById(
            'trackedSourcesCount'
        )
    );

    if (count) {

        count.textContent =
            String(
                savedSources.length
            );
    }
}


function renderTrackedSourcesSidebar() {

    ensureTrackedSourcesNav();
    updateTrackedSourcesNavCount();
    updateFollowSourceButton();
}


function requestedTrackedSourceFromUrl() {

    const params = (
        new URLSearchParams(
            window.location.search
        )
    );

    const raw = (
        params.get(
            'source'
        )
    );

    if (!raw) {
        return null;
    }

    const id = Number(
        raw
    );

    return (
        Number.isFinite(
            id
        )
        ? id
        : null
    );
}


async function syncTrackedSourceFromUrl() {

    const sourceId = (
        requestedTrackedSourceFromUrl()
    );

    if (!sourceId) {
        return false;
    }

    const source = (
        savedSources.find(
            item =>
                Number(
                    item.id
                )
                === Number(
                    sourceId
                )
        )
        || null
    );

    if (!source) {
        return false;
    }

    await openTrackedSource(
        source,
        {
            updateUrl:
                false
        }
    );

    return true;
}


async function openTrackedSource(
    source,
    {
        updateUrl = true
    } = {}
) {

    if (!source) {
        return;
    }

    const sourceInput = (
        document.getElementById(
            'sourceUrl'
        )
    );

    if (!sourceInput) {
        return;
    }

    const root = (
        document.getElementById(
            'videos'
        )
    );

    if (root) {

        root.classList.remove(
            'tracked-sources-view'
        );
    }

    sourceInput.value =
        source.profile_url;

    const select = (
        document.getElementById(
            'savedSourceSelect'
        )
    );

    if (select) {

        select.value =
            String(
                source.id
            );
    }

    currentView =
        'source';

    setSidebarFavoriteActive(
        false
    );

    updateViewLabel(
        `Nguồn: ${source.name}`
    );

    if (updateUrl) {

        history.pushState(
            {
                source:
                    source.id
            },
            '',
            (
                '/sources?source='
                + encodeURIComponent(
                    source.id
                )
            )
        );
    }

    await loadVideos();

    setTrackedSidebarActive(
        true
    );

    updateFollowSourceButton();
    saveUiState();
}


function trackedSourceCardHtml(
    source
) {

    const platform = (
        String(
            source.platform
            || ''
        )
        .toLowerCase()
    );

    const platformName = (
        platform
        === 'douyin'
        ? 'Douyin'
        : (
            platform
            === 'bilibili'
            ? 'Bilibili'
            : platform
        )
    );

    return `
        <article
            class="tracked-channel-card"
            data-source-id="${escapeHtml(String(source.id))}"
        >

            <div
                class="tracked-channel-avatar ${escapeHtml(platform)}"
            >
                ${source.cover_url
                    ? `<img data-engine-cover="${escapeHtml(coverUrl(source.cover_url))}" alt="">`
                    : (
                        platform
                        === 'douyin'
                        ? 'D'
                        : (
                            platform
                            === 'bilibili'
                            ? 'B'
                            : '•'
                        )
                    )
                }
            </div>

            <div class="tracked-channel-main">

                <div class="tracked-channel-head">

                    <div class="tracked-channel-copy">

                        <div class="tracked-channel-name">
                            ${escapeHtml(source.name || 'Nguồn không tên')}
                        </div>

                        <div class="tracked-channel-meta">
                            ${escapeHtml(platformName)}
                            <span>•</span>
                            ${Number(source.video_count || 0)} video
                        </div>

                    </div>

                    <button
                        type="button"
                        class="tracked-channel-edit"
                        title="Đổi tên nguồn"
                        aria-label="Đổi tên nguồn"
                    >
                        ${uiIcon('edit', 16)}
                    </button>

                    <button
                        type="button"
                        class="tracked-channel-delete"
                        title="Bỏ theo dõi"
                        aria-label="Bỏ theo dõi"
                    >
                        ${uiIcon('trash', 16)}
                    </button>

                </div>

                <div class="tracked-channel-url">
                    ${escapeHtml(source.profile_url || '')}
                </div>

                <div class="tracked-channel-actions">

                    <button
                        type="button"
                        class="tracked-channel-open"
                    >
                        Mở nguồn
                    </button>

                    <button
                        type="button"
                        class="tracked-channel-series"
                    >
                        Xem series
                    </button>

                    <span class="tracked-channel-key">
                        ${escapeHtml(source.channel_key || '2d_animation')}
                    </span>

                </div>

            </div>

        </article>
    `;
}


async function editTrackedSource(source) {

    const name = window.prompt(
        'Tên mới cho nguồn:',
        source.name || ''
    );

    if (name === null || !name.trim()) {
        return;
    }

    try {
        await apiJson(
            `/api/library/sources/${encodeURIComponent(source.id)}`,
            {
                method: 'PATCH',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({name: name.trim()}),
            }
        );

        await loadSavedSources();
        renderTrackedSourcesView();
    } catch (error) {
        alert(error.message);
    }
}


async function openTrackedSourceSeries(source) {
    await openTrackedSource(source);
    focusSeriesPicker();
}


function startNewTrackedSource() {

    const input = document.getElementById('sourceUrl');
    const mode = document.getElementById('sourceInputMode');
    const root = document.getElementById('videos');

    if (mode) {
        mode.value = 'channel';
    }

    if (input) {
        input.value = '';
        input.focus();
    }

    currentView = 'source';
    activeSeriesKey = '';
    root?.classList.remove('tracked-sources-view');
    if (root) {
        root.innerHTML = '';
    }
    updateViewLabel('Nguồn mới');
    updateSourceInfo('Dán link kênh rồi bấm Đồng bộ nguồn');
    setTrackedSidebarActive(false);
    history.pushState({}, '', '/sources');
}


function renderTrackedSourcesView() {

    const root = (
        document.getElementById(
            'videos'
        )
    );

    if (!root) {
        return;
    }

    currentView =
        'tracked';

    activeSeriesKey = '';

    currentVideos =
        [];

    sourceTotal =
        savedSources.length;

    totalPages =
        1;

    remoteHasMore =
        false;

    root.innerHTML =
        '';

    root.classList.add(
        'tracked-sources-view'
    );

    updateViewLabel(
        'Nguồn theo dõi'
    );

    updateSourceInfo(
        `${savedSources.length} kênh đang theo dõi`
    );

    const header = (
        document.createElement(
            'div'
        )
    );

    header.className =
        'tracked-view-header';

    header.innerHTML = `
        <div>
            <h2>Nguồn theo dõi</h2>
            <p>
                Quản lý nguồn, xem series và đổi tên ngay tại đây.
            </p>
        </div>

        <div class="tracked-view-tools">
            <span class="tracked-view-count">
                ${savedSources.length} kênh
            </span>
            <button type="button" class="btn primary tracked-add-source">
                + Thêm nguồn theo dõi
            </button>
        </div>
    `;

    header
        .querySelector('.tracked-add-source')
        .addEventListener('click', startNewTrackedSource);

    root.appendChild(
        header
    );

    if (
        !savedSources.length
    ) {

        const empty = (
            document.createElement(
                'div'
            )
        );

        empty.className =
            'tracked-view-empty';

        empty.innerHTML = `
            <div class="tracked-empty-icon">
                ${trackedSourcesIcon()}
            </div>

            <strong>
                Chưa theo dõi kênh nào
            </strong>

            <span>
                Dán link kênh ở phía trên, đồng bộ thumbnail,
                rồi bấm Theo dõi để lưu.
            </span>
        `;

        root.appendChild(
            empty
        );

        setTrackedSidebarActive(
            true
        );

        saveUiState();
        return;
    }

    const grid = (
        document.createElement(
            'div'
        )
    );

    grid.className =
        'tracked-channel-grid';

    for (
        const source
        of savedSources
    ) {

        const holder = (
            document.createElement(
                'div'
            )
        );

        holder.innerHTML =
            trackedSourceCardHtml(
                source
            );

        const card = (
            holder.firstElementChild
        );

        card
        .querySelector(
            '.tracked-channel-open'
        )
        .addEventListener(
            'click',
            () => {

                openTrackedSource(
                    source
                );
            }
        );

        card
        .querySelector(
            '.tracked-channel-delete'
        )
        .addEventListener(
            'click',
            async event => {

                event.stopPropagation();

                if (
                    !confirm(
                        `Bỏ theo dõi "${source.name}"?`
                    )
                ) {
                    return;
                }

                try {

                    await apiJson(
                        (
                            '/api/library/sources/'
                            + encodeURIComponent(
                                source.id
                            )
                        ),
                        {
                            method:
                                'DELETE'
                        }
                    );

                    await loadSavedSources();

                    renderTrackedSourcesView();

                } catch (
                    error
                ) {

                    alert(
                        error.message
                    );
                }
            }
        );

        card
        .querySelector(
            '.tracked-channel-edit'
        )
        .addEventListener(
            'click',
            () => {
                editTrackedSource(source);
            }
        );

        card
        .querySelector(
            '.tracked-channel-series'
        )
        .addEventListener(
            'click',
            () => {
                openTrackedSourceSeries(source);
            }
        );

        grid.appendChild(
            card
        );
    }

    root.appendChild(
        grid
    );

    setTrackedSidebarActive(
        true
    );

    saveUiState();
}


function requestedTrackedViewFromUrl() {

    const params = (
        new URLSearchParams(
            window.location.search
        )
    );

    return (
        params.get(
            'view'
        )
        === 'tracked'
    );
}


function injectTrackedSourcesSidebarStyle() {

    if (
        document.getElementById(
            'trackedSourcesSidebarStyle'
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
        'trackedSourcesSidebarStyle';

    style.textContent = `
        #trackedSourcesNav {
            display: flex !important;
            align-items: center !important;
            gap: 12px !important;
        }

        #trackedSourcesNav .tracked-nav-icon {
            width: 20px;
            min-width: 20px;
            display: inline-grid;
            place-items: center;
        }

        #trackedSourcesNav .tracked-nav-label {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
        }

        #trackedSourcesNav .tracked-nav-count {
            min-width: 22px;
            height: 20px;
            display: inline-grid;
            place-items: center;
            padding: 0 6px;
            border-radius: 999px;
            background: rgba(148,163,184,.08);
            color: #728197;
            font-size: 9px;
            font-weight: 800;
        }

        #trackedSourcesNav.active
        .tracked-nav-count {
            background: rgba(123,109,255,.16);
            color: #b1a8ff;
        }

        #videos.tracked-sources-view {
            display: block !important;
        }

        .tracked-view-header {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
            margin-bottom: 14px;
            padding: 4px 2px;
        }

        .tracked-view-header h2 {
            margin: 0;
            color: #f4f7fb;
            font-size: 18px;
            font-weight: 800;
        }

        .tracked-view-header p {
            margin: 5px 0 0;
            color: #718198;
            font-size: 11.5px;
        }

        .tracked-view-count {
            flex: none;
            padding: 6px 9px;
            border: 1px solid rgba(148,163,184,.12);
            border-radius: 999px;
            background: rgba(148,163,184,.05);
            color: #91a0b5;
            font-size: 10.5px;
            font-weight: 700;
        }

        .tracked-channel-grid {
            width: 100%;
            display: grid;
            grid-template-columns:
                repeat(2, minmax(0,1fr));
            gap: 12px;
        }

        .tracked-channel-card {
            min-width: 0;
            display: grid;
            grid-template-columns:
                46px minmax(0,1fr);
            gap: 12px;
            padding: 14px;
            border: 1px solid #26364d;
            border-radius: 14px;
            background: #111a28;
        }

        .tracked-channel-card:hover {
            border-color: #3b4d69;
            background: #131d2c;
        }

        .tracked-channel-avatar {
            width: 44px;
            height: 44px;
            display: grid;
            place-items: center;
            border: 1px solid rgba(148,163,184,.14);
            border-radius: 12px;
            background: #172234;
            color: #aebbd0;
            font-size: 15px;
            font-weight: 900;
        }

        .tracked-channel-avatar.bilibili {
            color: #7dd3fc;
            background: rgba(56,189,248,.08);
            border-color: rgba(56,189,248,.16);
        }

        .tracked-channel-avatar.douyin {
            color: #f0abfc;
            background: rgba(232,121,249,.07);
            border-color: rgba(232,121,249,.15);
        }

        .tracked-channel-main {
            min-width: 0;
        }

        .tracked-channel-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 9px;
        }

        .tracked-channel-copy {
            min-width: 0;
        }

        .tracked-channel-name {
            overflow: hidden;
            color: #f4f7fb;
            font-size: 13px;
            font-weight: 800;
            white-space: nowrap;
            text-overflow: ellipsis;
        }

        .tracked-channel-meta {
            display: flex;
            align-items: center;
            gap: 5px;
            margin-top: 4px;
            color: #728197;
            font-size: 10px;
        }

        .tracked-channel-delete {
            width: 32px;
            height: 32px;
            min-width: 32px;
            display: grid;
            place-items: center;
            padding: 0;
            border: 1px solid rgba(255,107,107,.16);
            border-radius: 9px;
            background: rgba(255,107,107,.05);
            color: #9a6e76;
            cursor: pointer;
        }

        .tracked-channel-delete:hover {
            background: rgba(255,107,107,.10);
            color: #ff8989;
        }

        .tracked-channel-url {
            margin-top: 9px;
            overflow: hidden;
            color: #586980;
            font-size: 9.5px;
            white-space: nowrap;
            text-overflow: ellipsis;
        }

        .tracked-channel-actions {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 11px;
        }

        .tracked-channel-open {
            min-height: 32px;
            padding: 0 11px;
            border: 1px solid transparent;
            border-radius: 8px;
            background: #7b6dff;
            color: #fff;
            font-size: 10.5px;
            font-weight: 750;
            cursor: pointer;
        }

        .tracked-channel-key {
            overflow: hidden;
            color: #687991;
            font-size: 9.5px;
            white-space: nowrap;
            text-overflow: ellipsis;
        }

        .tracked-view-empty {
            min-height: 220px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 7px;
            border: 1px dashed #28374e;
            border-radius: 14px;
            color: #75849a;
            text-align: center;
        }

        .tracked-empty-icon {
            width: 42px;
            height: 42px;
            display: grid;
            place-items: center;
            margin-bottom: 3px;
            border-radius: 12px;
            background: rgba(148,163,184,.06);
        }

        .tracked-view-empty strong {
            color: #cbd5e1;
            font-size: 12px;
        }

        .tracked-view-empty span {
            max-width: 340px;
            font-size: 10.5px;
        }

        #followCurrentSource {
            min-width: 102px;
        }

        #followCurrentSource.is-following {
            border-color:
                rgba(52,211,153,.20) !important;
            background:
                rgba(52,211,153,.07) !important;
            color: #7ee0ba !important;
            opacity: 1 !important;
        }

        @media (max-width: 1100px) {
            .tracked-channel-grid {
                grid-template-columns: 1fr;
            }
        }
    `;

    document.head.appendChild(
        style
    );
}


// =========================================================
// V13.6 SIDEBAR FAVORITES
// =========================================================

function sidebarHeartIcon() {
    return uiIcon('heart', 18);
}


function findSourcesSidebarLink() {

    const links = [
        ...document.querySelectorAll(
            'a[href]'
        )
    ];

    return (
        links.find(
            link => {

                try {

                    const url = (
                        new URL(
                            link.href,
                            window.location.origin
                        )
                    );

                    return (
                        url.pathname
                        === '/sources'
                        && !link.id
                            ?.includes(
                                'sidebarFavorites'
                            )
                    );

                } catch {

                    return false;
                }
            }
        )
        || null
    );
}


function setSidebarFavoriteActive(
    active
) {

    const sourceLink = (
        findSourcesSidebarLink()
    );

    const favoriteLink = (
        document.getElementById(
            'sidebarFavorites'
        )
    );

    if (!favoriteLink) {
        return;
    }

    if (active) {

        setTrackedSidebarActive(
            false
        );

        favoriteLink.classList.add(
            'active'
        );

        favoriteLink.setAttribute(
            'aria-current',
            'page'
        );

        if (sourceLink) {

            sourceLink.classList.remove(
                'active'
            );

            sourceLink.removeAttribute(
                'aria-current'
            );
        }

    } else {

        favoriteLink.classList.remove(
            'active'
        );

        favoriteLink.removeAttribute(
            'aria-current'
        );

        if (
            sourceLink
            && window.location.pathname
            === '/sources'
        ) {

            sourceLink.classList.add(
                'active'
            );
        }
    }
}


function ensureSidebarFavorites() {

    if (
        document.getElementById(
            'sidebarFavorites'
        )
    ) {
        return;
    }

    const links = [
        ...document.querySelectorAll(
            'a[href]'
        )
    ];

    const sourceLink = (
        findSourcesSidebarLink()
    );

    const downloadsLink = (
        links.find(
            link => {

                try {

                    return (
                        new URL(
                            link.href,
                            window.location.origin
                        )
                        .pathname
                        === '/downloads'
                    );

                } catch {

                    return false;
                }
            }
        )
        || null
    );

    const templateLink = (
        downloadsLink
        || sourceLink
    );

    if (
        !templateLink
        || !templateLink.parentElement
    ) {
        return;
    }

    const favoriteLink = (
        templateLink.cloneNode(
            false
        )
    );

    favoriteLink.id =
        'sidebarFavorites';

    favoriteLink.href =
        '/sources?view=favorites';

    favoriteLink.classList.remove(
        'active'
    );

    favoriteLink.removeAttribute(
        'aria-current'
    );

    favoriteLink.innerHTML = `
        <span class="sidebar-favorite-icon">
            ${sidebarHeartIcon()}
        </span>

        <span class="sidebar-favorite-label">
            Video yêu thích
        </span>
    `;

    templateLink.insertAdjacentElement(
        'afterend',
        favoriteLink
    );

    favoriteLink.addEventListener(
        'click',
        async event => {

            event.preventDefault();

            history.pushState(
                {
                    view:
                        'favorites'
                },
                '',
                '/sources?view=favorites'
            );

            await showFavorites();
        }
    );

    const style = (
        document.createElement(
            'style'
        )
    );

    style.id =
        'sidebarFavoritesStyle';

    style.textContent = `
        #sidebarFavorites {
            display: flex !important;
            align-items: center !important;
            gap: 12px !important;
        }

        #sidebarFavorites .sidebar-favorite-icon {
            width: 20px;
            min-width: 20px;
            display: inline-grid;
            place-items: center;
        }

        #sidebarFavorites .sidebar-favorite-icon svg {
            width: 18px;
            height: 18px;
            display: block;
        }

        #sidebarFavorites .sidebar-favorite-label {
            min-width: 0;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
        }

        #sidebarFavorites.active
        .sidebar-favorite-icon svg {
            fill: currentColor;
        }
    `;

    document.head.appendChild(
        style
    );
}


function requestedViewFromUrl() {

    const params = (
        new URLSearchParams(
            window.location.search
        )
    );

    return (
        params.get(
            'view'
        )
        || ''
    );
}


async function syncSidebarViewFromUrl() {

    const view = (
        requestedViewFromUrl()
    );

    if (
        view
        === 'favorites'
    ) {

        await showFavorites();

        setSidebarFavoriteActive(
            true
        );

        return true;
    }

    setSidebarFavoriteActive(
        false
    );

    return false;
}


window.addEventListener(
    'popstate',
    async () => {

        if (
            requestedTrackedViewFromUrl()
        ) {

            renderTrackedSourcesView();
            return;
        }

        const trackedHandled = (
            await syncTrackedSourceFromUrl()
        );

        if (trackedHandled) {
            return;
        }

        const handled = (
            await syncSidebarViewFromUrl()
        );

        if (!handled) {

            currentView =
                'source';

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
            }
        }
    }
);


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

            apiJson(
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


function resetSourceSessionData() {

    currentVideos = [];
    for (const key of Object.keys(pageCache)) {
        delete pageCache[key];
    }

    sourceTotal = null;
    totalPages = null;
    remoteHasMore = true;
    currentPage = 1;
    activeSeriesKey = '';
    lastLoadedSourceUrl = '';
    lastLoadedInputMode = 'channel';
    currentView = 'source';
}


function saveSourceSession() {

    const sourceUrl = document.getElementById('sourceUrl')?.value?.trim() || '';
    const inputMode = document.getElementById('sourceInputMode')?.value || 'channel';

    try {
        if (!sourceUrl) {
            window.sessionStorage.removeItem(SOURCE_SESSION_KEY);
            return;
        }

        window.sessionStorage.setItem(
            SOURCE_SESSION_KEY,
            JSON.stringify({ sourceUrl, inputMode })
        );
    } catch {
        // Session storage can be unavailable in a privacy-restricted browser.
    }
}


function restoreSourceSession() {

    try {
        const raw = window.sessionStorage.getItem(SOURCE_SESSION_KEY);
        const state = raw ? JSON.parse(raw) : null;
        const sourceUrl = typeof state?.sourceUrl === 'string' ? state.sourceUrl.trim() : '';

        if (!sourceUrl) {
            return false;
        }

        resetSourceSessionData();

        const sourceInput = document.getElementById('sourceUrl');
        const inputMode = document.getElementById('sourceInputMode');
        if (sourceInput) sourceInput.value = sourceUrl;
        if (inputMode && ['channel', 'video'].includes(state.inputMode)) {
            inputMode.value = state.inputMode;
        }
        return true;
    } catch {
        return false;
    }
}


// A new browser session starts empty; the last pasted source is retained only
// while the current tab session remains open.
function clearSourceSessionState() {

    const sourceInput = (
        document.getElementById(
            'sourceUrl'
        )
    );

    if (sourceInput) {
        sourceInput.value = '';
    }

    const inputMode = (
        document.getElementById(
            'sourceInputMode'
        )
    );

    if (inputMode) {
        inputMode.value = 'channel';
    }

    resetSourceSessionData();

    try {
        window.sessionStorage.removeItem(SOURCE_SESSION_KEY);
    } catch {
        // ignore unavailable storage
    }
}


function labelForCurrentView() {

    if (
        currentView
        === 'favorites'
    ) {
        return 'Video đã lưu';
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

            video.active_mode =
                mode;

            video.active_channel =
                channel;

            const progressWrap = (
                card.querySelector(
                    '.progress-wrap'
                )
            );

            if (progressWrap) {

                progressWrap.style.display =
                    'none';
            }

            card.classList.add(
                'is-processing'
            );

            updateInlineProcessStatus(
                card,
                '…',
                mode === 'subtitle'
                    ? 'Đang làm Vietsub'
                    : 'Đang tạo Voice'
            );

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

    const root = (
        document.getElementById(
            'videos'
        )
    );

    if (root) {

        root.classList.remove(
            'tracked-sources-view'
        );
    }

    setSidebarFavoriteActive(
        false
    );

    setTrackedSidebarActive(
        false
    );

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
    injectTrackedSourcesSidebarStyle();
    ensureTrackedSourcesNav();

    const state = (
        await readUiStateWithServerFallback()
    );

    applyUiStateFields(
        state
    );

    // The Engine UI state intentionally does not restore a source across
    // devices.  Prefer the current browser tab's session when it exists.
    if (!restoreSourceSession()) {
        clearSourceSessionState();
    }

    if (currentVideos.length) {
        lastLoadedSourceUrl = (
            document.getElementById('sourceUrl')?.value?.trim() || ''
        );
        lastLoadedInputMode = (
            document.getElementById('sourceInputMode')?.value || 'channel'
        );
    }

    await Promise.all([
        loadSavedSources(),
        loadCollections(),
        loadSeries(),
    ]);

    renderTrackedSourcesSidebar();

    if (
        requestedTrackedViewFromUrl()
    ) {

        renderTrackedSourcesView();

        saveUiState();
        return;
    }

    const trackedSourceHandled = (
        await syncTrackedSourceFromUrl()
    );

    if (
        trackedSourceHandled
    ) {

        saveUiState();
        return;
    }

    const urlViewHandled = (
        await syncSidebarViewFromUrl()
    );

    if (
        urlViewHandled
    ) {

        saveUiState();
        return;
    }

    if (state) {

        const savedSelect = (
            document.getElementById(
                'savedSourceSelect'
            )
        );

        if (savedSelect) {
            savedSelect.value = '';
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

        if (seriesSelect) {
            seriesSelect.value = '';
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
            updateViewLabel('Nguồn mới');
            updateSourceInfo('Vui lòng nhập link nguồn');
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

        saveSourceSession();

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
            'sourceInputMode',
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
                if (
                    id === 'sourceUrl'
                    || id === 'sourceInputMode'
                ) {
                    saveSourceSession();
                }
                saveUiState();
            }
        );
    }
}



// =========================================================
// V13.4 CARD LAYOUT FIX
// =========================================================

function injectV134CardFix() {

    if (
        document.getElementById(
            'v134CardFix'
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
        'v134CardFix';

    style.textContent = `
        /* -------------------------------------------------
           VIDEO GRID
           Force 2 columns. The old template's .grid styles
           were still winning and squeezing cards into 3 cols.
           ------------------------------------------------- */

        #videos {
            display: grid !important;
            grid-template-columns:
                repeat(2, minmax(0, 1fr)) !important;
            gap: 14px !important;
            align-items: stretch !important;
            width: 100% !important;
            min-width: 0 !important;
        }

        #videos > .compact-video-card {
            width: 100% !important;
            min-width: 0 !important;
            max-width: none !important;
            height: auto !important;
            min-height: 158px !important;
            max-height: none !important;
            margin: 0 !important;
            padding: 14px !important;
            overflow: visible !important;

            display: grid !important;
            grid-template-columns:
                30px 172px minmax(0, 1fr) !important;
            grid-template-areas:
                "select cover content" !important;
            column-gap: 13px !important;
            align-items: center !important;

            border: 1px solid #26364d !important;
            border-radius: 15px !important;
            background: #111a28 !important;
        }

        /* Reset old card positioning rules. */
        #videos > .compact-video-card > * {
            min-width: 0 !important;
        }

        #videos .select-control {
            grid-area: select !important;
            position: static !important;
            align-self: start !important;
            justify-self: center !important;
            margin: 1px 0 0 0 !important;
            width: 30px !important;
            height: 32px !important;
        }

        #videos .compact-cover {
            grid-area: cover !important;
            position: relative !important;
            inset: auto !important;

            width: 172px !important;
            height: 116px !important;
            min-width: 172px !important;
            min-height: 116px !important;
            max-width: 172px !important;
            max-height: 116px !important;

            margin: 0 !important;
            padding: 0 !important;
            align-self: center !important;

            border-radius: 11px !important;
            overflow: hidden !important;
        }

        #videos .compact-cover img,
        #videos .compact-cover .cover {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            height: 100% !important;
            max-width: none !important;
            object-fit: cover !important;
            border-radius: inherit !important;
        }

        #videos .cover-fallback {
            position: absolute !important;
            inset: 0 !important;
            display: grid !important;
            place-items: center !important;
        }

        #videos .compact-content {
            grid-area: content !important;
            position: static !important;
            inset: auto !important;

            width: auto !important;
            min-width: 0 !important;
            max-width: none !important;
            height: auto !important;
            min-height: 116px !important;
            max-height: none !important;

            margin: 0 !important;
            padding: 0 !important;

            display: flex !important;
            flex-direction: column !important;
            justify-content: center !important;
            align-self: stretch !important;
            overflow: visible !important;
        }

        /* -------------------------------------------------
           HEADER
           ------------------------------------------------- */

        #videos .card-header-row {
            display: grid !important;
            grid-template-columns:
                minmax(0, 1fr) 38px !important;
            align-items: start !important;
            gap: 10px !important;
            width: 100% !important;
        }

        #videos .compact-title-wrap {
            min-width: 0 !important;
            width: 100% !important;
        }

        #videos .compact-title {
            width: 100% !important;
            min-width: 0 !important;
            max-width: none !important;
            margin: 0 !important;

            color: #f5f7fb !important;
            font-size: 14px !important;
            font-weight: 760 !important;
            line-height: 1.42 !important;

            display: -webkit-box !important;
            -webkit-line-clamp: 2 !important;
            -webkit-box-orient: vertical !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            word-break: break-word !important;
        }

        #videos .compact-meta {
            display: flex !important;
            align-items: center !important;
            flex-wrap: wrap !important;
            gap: 4px !important;

            width: 100% !important;
            margin: 5px 0 0 !important;

            color: #72829a !important;
            font-size: 10.5px !important;
            line-height: 1.35 !important;
        }

        #videos .compact-meta .media-facts {
            gap: 7px;
            margin-left: 3px;
            padding: 2px 7px;
        }

        #videos .favorite-btn {
            position: static !important;
            inset: auto !important;
            justify-self: end !important;
            margin: 0 !important;

            width: 38px !important;
            height: 38px !important;
            min-width: 38px !important;
            min-height: 38px !important;

            border-radius: 11px !important;
        }

        #videos .select-visual {
            width: 21px !important;
            height: 21px !important;
            border-radius: 6px !important;
        }

        /* -------------------------------------------------
           BADGES + ACTIONS
           ------------------------------------------------- */

        #videos .compact-badges {
            width: 100% !important;
            min-height: 19px !important;
            margin: 7px 0 0 !important;

            display: flex !important;
            align-items: center !important;
            gap: 5px !important;
            flex-wrap: wrap !important;

            overflow: visible !important;
        }

        #videos .compact-badges .badge {
            max-width: 190px !important;
            overflow: hidden !important;
            white-space: nowrap !important;
            text-overflow: ellipsis !important;
        }

        #videos .card-action-row {
            width: 100% !important;
            margin: 9px 0 0 !important;

            display: flex !important;
            align-items: center !important;
            gap: 7px !important;
            flex-wrap: wrap !important;

            overflow: visible !important;
        }

        #videos .action-primary,
        #videos .action-secondary {
            position: static !important;
            inset: auto !important;
            margin: 0 !important;

            min-width: 72px !important;
            height: 34px !important;
            min-height: 34px !important;

            padding: 0 13px !important;
        }

        #videos .result-chip-group {
            display: inline-flex !important;
            align-items: center !important;
            gap: 5px !important;
            min-width: 0 !important;
        }

        #videos .more-menu {
            position: relative !important;
            inset: auto !important;
            margin: 0 !important;
        }

        #videos .more-trigger {
            position: static !important;
            inset: auto !important;
            margin: 0 !important;
        }

        /* Keep right-column menu inside the viewport. */
        #videos .compact-video-card:nth-child(2n)
        .more-menu-panel {
            right: 0 !important;
            left: auto !important;
        }

        /* -------------------------------------------------
           PROGRESS PANEL
           ------------------------------------------------- */

        #videos .progress-wrap {
            position: static !important;
            inset: auto !important;

            width: 100% !important;
            min-width: 0 !important;
            max-width: none !important;
            height: auto !important;
            max-height: none !important;

            margin: 10px 0 0 !important;
            padding: 9px 10px !important;

            overflow: visible !important;
            border-radius: 10px !important;
        }

        #videos .progress-head {
            width: 100% !important;
            margin: 0 0 7px !important;

            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            gap: 8px !important;
        }

        #videos .progress-copy {
            min-width: 0 !important;
            flex: 1 !important;

            display: grid !important;
            grid-template-columns:
                minmax(0, 1fr) auto !important;
            gap: 10px !important;
            align-items: center !important;
        }

        #videos .progress-stage {
            min-width: 0 !important;
            overflow: hidden !important;
            white-space: nowrap !important;
            text-overflow: ellipsis !important;
        }

        #videos .progress-text {
            flex: none !important;
            margin: 0 !important;
            white-space: nowrap !important;
        }

        #videos .progress {
            width: 100% !important;
            height: 5px !important;
            margin: 0 !important;
        }

        #videos .progress-footer {
            width: 100% !important;
            min-width: 0 !important;

            margin: 7px 0 0 !important;

            display: flex !important;
            align-items: flex-start !important;
            justify-content: space-between !important;
            gap: 8px !important;
        }

        #videos .process-details {
            min-width: 0 !important;
            max-width: 100% !important;
        }

        #videos .process-details[open] {
            width: 100% !important;
            flex-basis: 100% !important;
        }

        #videos .process-details[open]
        ~ .dynamic-results {
            display: none !important;
        }

        #videos .process-details .log {
            width: 100% !important;
            max-width: 100% !important;
            max-height: 130px !important;
            overflow: auto !important;

            white-space: pre-wrap !important;
            overflow-wrap: anywhere !important;
            word-break: break-word !important;
        }

        /* -------------------------------------------------
           RESPONSIVE
           ------------------------------------------------- */

        @media (max-width: 1280px) {

            #videos {
                grid-template-columns: 1fr !important;
            }

            #videos > .compact-video-card {
                grid-template-columns:
                    30px 190px minmax(0, 1fr) !important;
            }

            #videos .compact-cover {
                width: 190px !important;
                min-width: 190px !important;
                max-width: 190px !important;
                height: 120px !important;
                min-height: 120px !important;
                max-height: 120px !important;
            }
        }

        @media (max-width: 760px) {

            #videos > .compact-video-card {
                grid-template-columns:
                    26px 104px minmax(0, 1fr) !important;
                gap: 9px !important;
                padding: 10px !important;
            }

            #videos .compact-cover {
                width: 104px !important;
                min-width: 104px !important;
                max-width: 104px !important;
                height: 80px !important;
                min-height: 80px !important;
                max-height: 80px !important;
            }

            #videos .compact-meta {
                display: none !important;
            }

            #videos .favorite-btn {
                width: 34px !important;
                height: 34px !important;
                min-width: 34px !important;
                min-height: 34px !important;
            }

            #videos .compact-title {
                font-size: 13px !important;
            }

            #videos .card-action-row {
                gap: 5px !important;
            }

            #videos .action-primary,
            #videos .action-secondary {
                min-width: 62px !important;
                padding: 0 9px !important;
            }
        }
    `;

    document.head.appendChild(
        style
    );
}


injectV134CardFix();


// =========================================================
// V13.5 MORE BUTTON POLISH
// =========================================================

function injectV135MoreButtonFix() {

    if (
        document.getElementById(
            'v135MoreButtonFix'
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
        'v135MoreButtonFix';

    style.textContent = `
        #videos .more-menu {
            display: inline-flex !important;
            align-items: center !important;
            position: relative !important;
            margin: 0 !important;
        }

        #videos .more-trigger {
            box-sizing: border-box !important;
            width: 36px !important;
            height: 36px !important;
            min-width: 36px !important;
            min-height: 36px !important;
            max-width: 36px !important;
            max-height: 36px !important;

            display: inline-grid !important;
            place-items: center !important;

            margin: 0 !important;
            padding: 0 !important;

            border: 1px solid #2f3d55 !important;
            border-radius: 10px !important;

            background: #172234 !important;
            color: #91a0b6 !important;

            line-height: 1 !important;
            letter-spacing: 0 !important;
            overflow: hidden !important;

            cursor: pointer !important;
            list-style: none !important;

            transition:
                background .15s ease,
                border-color .15s ease,
                color .15s ease,
                transform .15s ease !important;
        }

        #videos .more-trigger::-webkit-details-marker {
            display: none !important;
        }

        #videos .more-trigger::marker {
            content: "" !important;
        }

        #videos .more-trigger svg {
            display: block !important;
            width: 18px !important;
            height: 18px !important;
            flex: none !important;
            pointer-events: none !important;
        }

        #videos .more-trigger:hover {
            background: #202d42 !important;
            border-color: #43536f !important;
            color: #eef2f8 !important;
            transform: translateY(-1px) !important;
        }

        #videos .more-menu[open] > .more-trigger {
            background: rgba(123, 109, 255, .14) !important;
            border-color: rgba(123, 109, 255, .46) !important;
            color: #a89dff !important;
            transform: none !important;
        }

        #videos .more-menu-panel {
            margin-top: 7px !important;
        }
    `;

    document.head.appendChild(
        style
    );
}


injectV135MoreButtonFix();


// =========================================================
// V13.6 PROCESSING PANEL POLISH
// =========================================================

function injectV136ProcessingPanelPolish() {

    if (document.getElementById('v136ProcessingPanelPolish')) return;

    const style = document.createElement('style');
    style.id = 'v136ProcessingPanelPolish';
    style.textContent = `
        #videos .progress-wrap {
            margin-top: 14px !important;
            padding: 12px 13px !important;
            border: 1px solid rgba(251, 56, 80, .26) !important;
            border-radius: 13px !important;
            background:
                linear-gradient(135deg, rgba(40, 20, 30, .58), rgba(16, 24, 38, .96) 42%, rgba(14, 22, 35, .98)) !important;
            box-shadow: inset 3px 0 0 rgba(251, 56, 80, .9), 0 10px 24px rgba(0, 0, 0, .14) !important;
        }

        #videos .progress-head {
            display: flex !important;
            align-items: flex-start !important;
            justify-content: space-between !important;
            gap: 12px !important;
            margin-bottom: 10px !important;
        }

        #videos .progress-copy {
            display: grid !important;
            grid-template-columns: auto minmax(0, 1fr) !important;
            align-items: center !important;
            gap: 9px !important;
            min-width: 0 !important;
        }

        #videos .progress-state {
            display: inline-flex !important;
            align-items: center !important;
            gap: 6px !important;
            min-height: 22px !important;
            padding: 0 8px !important;
            border: 1px solid rgba(251, 56, 80, .25) !important;
            border-radius: 999px !important;
            background: rgba(251, 56, 80, .11) !important;
            color: #ff9cab !important;
            font-size: 10px !important;
            font-weight: 800 !important;
            letter-spacing: .025em !important;
            white-space: nowrap !important;
        }

        #videos .progress-pulse {
            width: 6px !important;
            height: 6px !important;
            border-radius: 50% !important;
            background: #ff4761 !important;
            box-shadow: 0 0 0 4px rgba(255, 71, 97, .12) !important;
            animation: reup-progress-pulse 1.45s ease-in-out infinite !important;
        }

        #videos .progress-stage {
            color: #e3e9f4 !important;
            font-size: 12px !important;
            font-weight: 650 !important;
            line-height: 1.35 !important;
        }

        #videos .progress-actions {
            display: inline-flex !important;
            align-items: center !important;
            gap: 8px !important;
            flex: none !important;
        }

        #videos .progress-text {
            display: inline-grid !important;
            place-items: center !important;
            min-width: 39px !important;
            height: 28px !important;
            margin: 0 !important;
            padding: 0 7px !important;
            border: 1px solid rgba(148, 163, 184, .18) !important;
            border-radius: 8px !important;
            background: rgba(15, 23, 42, .72) !important;
            color: #f4f7fb !important;
            font-size: 11px !important;
            font-weight: 850 !important;
            font-variant-numeric: tabular-nums !important;
        }

        #videos .stop-process-btn {
            width: 28px !important;
            height: 28px !important;
            min-width: 28px !important;
            border-color: rgba(251, 86, 103, .45) !important;
            border-radius: 8px !important;
            background: rgba(251, 56, 80, .13) !important;
            color: #ff8494 !important;
        }

        #videos .stop-process-btn:hover:not(:disabled) {
            border-color: rgba(255, 128, 143, .78) !important;
            background: rgba(251, 56, 80, .24) !important;
            color: #fff !important;
        }

        #videos .progress {
            position: relative !important;
            height: 7px !important;
            border: 1px solid rgba(148, 163, 184, .10) !important;
            border-radius: 999px !important;
            background: rgba(2, 6, 14, .72) !important;
        }

        #videos .progress-bar {
            position: relative !important;
            border-radius: inherit !important;
            background: linear-gradient(90deg, #ec1838 0%, #ff4e67 62%, #ff8a9a 100%) !important;
            box-shadow: 0 0 14px rgba(251, 56, 80, .34) !important;
            transition: width .45s ease !important;
        }

        #videos .progress-bar::after {
            content: "" !important;
            position: absolute !important;
            inset: 0 !important;
            border-radius: inherit !important;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,.42), transparent) !important;
            transform: translateX(-100%) !important;
            animation: reup-progress-shine 1.8s linear infinite !important;
        }

        #videos .progress-footer {
            min-height: 19px !important;
            margin-top: 9px !important;
            align-items: center !important;
        }

        #videos .progress-live-note {
            color: #71819a !important;
            font-size: 10px !important;
            font-weight: 650 !important;
        }

        #videos .process-details {
            flex: 0 0 auto !important;
        }

        #videos .process-details > summary {
            display: inline-flex !important;
            align-items: center !important;
            gap: 5px !important;
            min-height: 23px !important;
            color: #9aabc4 !important;
            font-size: 10px !important;
            font-weight: 750 !important;
        }

        #videos .process-details > summary::before {
            content: "›" !important;
            color: #ff7285 !important;
            font-size: 15px !important;
            line-height: 1 !important;
            transition: transform .15s ease !important;
        }

        #videos .process-details[open] > summary::before {
            transform: rotate(90deg) !important;
        }

        #videos .process-details[open] .log {
            margin-top: 8px !important;
            border: 1px solid rgba(148,163,184,.12) !important;
        }

        @keyframes reup-progress-pulse {
            50% { opacity: .52; transform: scale(.8); }
        }

        @keyframes reup-progress-shine {
            to { transform: translateX(100%); }
        }

        @media (max-width: 620px) {
            #videos .progress-head { gap: 8px !important; }
            #videos .progress-copy { grid-template-columns: 1fr !important; gap: 5px !important; }
            #videos .progress-state { width: max-content !important; }
            #videos .progress-live-note { display: none !important; }
        }
    `;
    document.head.appendChild(style);
}


injectV136ProcessingPanelPolish();


// =========================================================
// V13.7 COMPACT PROCESSING STATUS + DETAILS POPUP
// =========================================================

function injectV137CompactProcessingPopup() {

    if (document.getElementById('v137CompactProcessingPopup')) return;

    const style = document.createElement('style');
    style.id = 'v137CompactProcessingPopup';
    style.textContent = `
        /* Keep every source card at its normal height while a job runs. */
        #videos .compact-video-card .progress-wrap {
            display: none !important;
        }

        #videos .compact-video-card.is-processing {
            border-color: rgba(251, 56, 80, .46) !important;
            box-shadow: inset 3px 0 0 #ef1d3e, 0 12px 30px rgba(0, 0, 0, .16) !important;
        }

        #videos .process-details-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            min-width: 0;
            max-width: 210px;
            height: 34px;
            padding: 0 9px;
            border: 1px solid rgba(251, 56, 80, .37);
            border-radius: 9px;
            background: linear-gradient(135deg, rgba(251, 56, 80, .18), rgba(28, 36, 53, .82));
            color: #ffdbe1;
            cursor: pointer;
            font-size: 11px;
            font-weight: 750;
            line-height: 1;
            transition: border-color .16s ease, background .16s ease, transform .16s ease;
        }

        #videos .process-details-btn[hidden] {
            display: none !important;
        }

        #videos .process-details-btn:hover {
            border-color: rgba(255, 126, 143, .82);
            background: linear-gradient(135deg, rgba(251, 56, 80, .3), rgba(36, 43, 62, .94));
            transform: translateY(-1px);
        }

        #videos .process-details-btn .ui-icon {
            flex: 0 0 auto;
            animation: process-status-spin 2.2s linear infinite;
        }

        #videos .process-details-btn .process-inline-label {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        #videos .process-details-btn .process-inline-percent {
            flex: 0 0 auto;
            margin-left: auto;
            color: #fff;
            font-size: 10px;
            font-variant-numeric: tabular-nums;
        }

        #videos .process-details-btn.is-error {
            border-color: rgba(255, 145, 101, .48);
            background: rgba(127, 50, 32, .24);
            color: #ffc5aa;
        }

        #videos .process-details-btn.is-error .ui-icon,
        #videos .process-details-btn.is-complete .ui-icon {
            animation: none;
        }

        #videos .process-details-btn.is-complete {
            border-color: rgba(62, 205, 147, .34);
            background: rgba(17, 109, 76, .18);
            color: #baf5d8;
        }

        .process-details-popup {
            position: fixed;
            z-index: 2147483000;
            inset: 0;
            display: grid;
            place-items: center;
            padding: 18px;
        }

        .process-details-popup[hidden] {
            display: none !important;
        }

        .process-details-backdrop {
            position: absolute;
            inset: 0;
            background: rgba(2, 6, 14, .78);
            backdrop-filter: blur(8px);
        }

        .process-details-panel {
            position: relative;
            z-index: 1;
            width: min(640px, 100%);
            max-height: min(760px, calc(100vh - 36px));
            overflow: auto;
            border: 1px solid rgba(139, 155, 180, .26);
            border-radius: 16px;
            background: linear-gradient(145deg, #182131 0%, #101724 48%, #0d131d 100%);
            box-shadow: 0 28px 80px rgba(0, 0, 0, .58), inset 0 1px 0 rgba(255,255,255,.04);
            color: #edf2fa;
        }

        .process-details-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
            padding: 20px 22px 17px;
            border-bottom: 1px solid rgba(148, 163, 184, .13);
        }

        .process-details-eyebrow {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            color: #ff9cab;
            font-size: 10px;
            font-weight: 850;
            letter-spacing: .11em;
        }

        .process-details-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: #ff4761;
            box-shadow: 0 0 0 4px rgba(255,71,97,.13);
            animation: process-status-pulse 1.5s ease-in-out infinite;
        }

        .process-details-header h2 {
            margin: 8px 0 5px;
            color: #f8fafc;
            font-size: 18px;
            line-height: 1.3;
            font-weight: 780;
            word-break: break-word;
        }

        .process-details-source {
            margin: 0;
            color: #91a0b7;
            font-size: 12px;
        }

        .process-details-close {
            flex: 0 0 auto;
            width: 34px;
            height: 34px;
        }

        .process-details-summary {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 18px;
            padding: 18px 22px 12px;
        }

        .process-details-status {
            display: inline-flex;
            align-items: center;
            min-height: 23px;
            padding: 0 9px;
            border: 1px solid rgba(251,56,80,.3);
            border-radius: 999px;
            background: rgba(251,56,80,.1);
            color: #ffabb8;
            font-size: 10px;
            font-weight: 800;
        }

        .process-details-stage {
            margin: 8px 0 0;
            color: #dde5f2;
            font-size: 14px;
            font-weight: 650;
            line-height: 1.45;
        }

        .process-details-percent {
            flex: 0 0 auto;
            color: #fff;
            font-size: 26px;
            font-variant-numeric: tabular-nums;
        }

        .process-details-track {
            height: 8px;
            margin: 0 22px;
            overflow: hidden;
            border: 1px solid rgba(148,163,184,.13);
            border-radius: 999px;
            background: rgba(2, 6, 14, .72);
        }

        .process-details-bar {
            width: 0%;
            height: 100%;
            border-radius: inherit;
            background: linear-gradient(90deg, #e91a38, #ff6378 68%, #ff9ead);
            box-shadow: 0 0 14px rgba(251, 56, 80, .38);
            transition: width .42s ease;
        }

        .process-details-log-wrap {
            margin: 20px 22px;
        }

        .process-details-log-label {
            margin-bottom: 8px;
            color: #8493a9;
            font-size: 10px;
            font-weight: 800;
            letter-spacing: .09em;
            text-transform: uppercase;
        }

        .process-details-log {
            min-height: 110px;
            max-height: 245px;
            margin: 0;
            padding: 13px;
            overflow: auto;
            border: 1px solid rgba(148,163,184,.13);
            border-radius: 10px;
            background: rgba(2, 6, 14, .5);
            color: #b5c2d6;
            font: 11px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace;
            white-space: pre-wrap;
            word-break: break-word;
        }

        .process-details-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 15px 22px;
            border-top: 1px solid rgba(148,163,184,.13);
            color: #8190a6;
            font-size: 11px;
        }

        .process-details-footer > div {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            flex: 0 0 auto;
        }

        .process-details-stop {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            min-height: 34px;
            padding: 0 11px;
            border: 1px solid rgba(255, 126, 143, .42);
            border-radius: 8px;
            background: rgba(251,56,80,.15);
            color: #ffc2cb;
            cursor: pointer;
            font-size: 11px;
            font-weight: 750;
        }

        .process-details-stop:hover:not(:disabled) {
            background: rgba(251,56,80,.28);
            color: #fff;
        }

        .process-details-stop:disabled {
            cursor: wait;
            opacity: .55;
        }

        .process-details-popup.has-error .process-details-status {
            border-color: rgba(255,145,101,.36);
            background: rgba(138,59,35,.2);
            color: #ffc1a6;
        }

        .process-details-popup.has-error .process-details-bar {
            background: linear-gradient(90deg, #c6693c, #ffad76);
        }

        .process-details-popup.is-complete .process-details-status {
            border-color: rgba(62,205,147,.34);
            background: rgba(17,109,76,.18);
            color: #baf5d8;
        }

        .process-details-popup.is-complete .process-details-dot {
            animation: none;
            background: #44db9c;
            box-shadow: 0 0 0 4px rgba(68,219,156,.12);
        }

        @keyframes process-status-spin { to { transform: rotate(360deg); } }
        @keyframes process-status-pulse { 50% { opacity: .55; transform: scale(.8); } }

        @media (max-width: 620px) {
            #videos .process-details-btn { max-width: 155px; }
            .process-details-popup { padding: 10px; }
            .process-details-header,
            .process-details-summary { padding-left: 16px; padding-right: 16px; }
            .process-details-track { margin-left: 16px; margin-right: 16px; }
            .process-details-log-wrap { margin: 16px; }
            .process-details-footer { align-items: flex-start; flex-direction: column; padding: 14px 16px; }
            .process-details-footer > div { width: 100%; justify-content: flex-end; }
        }
    `;

    document.head.appendChild(style);
}


injectV137CompactProcessingPopup();



const previousLoadVideos = loadVideos;
loadVideos = async function(...args) {
    if (sourceSyncPromise) {
        return sourceSyncPromise;
    }

    const button = document.getElementById('syncSourceBtn');
    const originalHtml = button?.innerHTML;
    if (button) {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.innerHTML = `${uiIcon('refresh', 15)} Đang kiểm tra...`;
    }

    sourceSyncPromise = Promise.resolve().then(
        () => previousLoadVideos(...args)
    );

    try {
        return await sourceSyncPromise;
    } finally {
        if (button) {
            button.disabled = false;
            button.removeAttribute('aria-busy');
            button.innerHTML = originalHtml;
        }
        sourceSyncPromise = null;
    }
};


const v137SourceInput = (
    document.getElementById(
        'sourceUrl'
    )
);

if (v137SourceInput) {

    v137SourceInput.addEventListener(
        'input',
        () => {

            updateFollowSourceButton();
        }
    );
}



const ready = initializeV13().then(async () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('video');
    if (!id) return;
    const [data, downloads] = await Promise.all([
        apiJson('/api/library/videos?q=' + encodeURIComponent(id) + '&limit=500'),
        apiJson('/api/library/downloads'),
    ]);
    const stored = (data.videos || []).find(item => item.video_id === id);
    const local = (downloads.videos || []).find(item => item.video_id === id);
    const video = stored || local ? {
        ...local, ...stored,
        title: stored?.title && stored.title !== id ? stored.title : local?.title || stored?.title || id,
        cover_url: stored?.cover_url || local?.cover_url || '',
        url: stored?.url || local?.source_url || '',
        downloaded: !!local || !!stored?.downloaded,
    } : null;
    if (!video) throw new Error('Không tìm thấy video trong thư viện local: ' + id);
    currentView = 'source';
    currentVideos = [video]; currentPage = 1; sourceTotal = 1; totalPages = 1; remoteHasMore = false;
    renderVideos(); updateViewLabel('Video local'); updateSourceInfo(video.title || id);
    const mode = params.get('mode');
    if (mode === 'subtitle' || mode === 'voiceover') {
        const card = document.querySelector('[data-video-id="' + CSS.escape(id) + '"]');
        if (card) await openProcessConfig(video, card, mode);
    }
});
return {
    ready,
    evaluate(source, event, element) {
        return eval('(function(event){' + source + '\n})').call(element, event);
    },
};

}
