import test from 'node:test';
import assert from 'node:assert/strict';

import {
    formatEpisodeTopic,
    extractSeriesBaseName,
    buildEpisodeAiInstructions,
    normalizeEpisodeMetadata,
    sortFilesForEpisodes,
    mapFilesToEpisodeSlots,
    reorderEpisodeVideos,
    replaceEpisodeVideoAt,
    generateAndPublishEpisode,
} from '../src/lib/batch-auto-publish.js';
import { buildProcessPayloadFromSavedPreset } from '../src/lib/process-config-store.js';

test('formatEpisodeTopic auto-increments episode 1..6 from base series prompt or trailing "tập 1"', () => {
    assert.equal(formatEpisodeTopic('Xuyên không dị giới', 1), 'Xuyên không dị giới - Tập 1');
    assert.equal(formatEpisodeTopic('Xuyên không dị giới', 6), 'Xuyên không dị giới - Tập 6');

    // Khi người dùng nhập "Xuyên không dị giới tập 1", tự động tăng thành tập 2, 3, 4, 5, 6
    assert.equal(formatEpisodeTopic('Xuyên không dị giới tập 1', 1), 'Xuyên không dị giới tập 1');
    assert.equal(formatEpisodeTopic('Xuyên không dị giới tập 1', 2), 'Xuyên không dị giới tập 2');
    assert.equal(formatEpisodeTopic('Xuyên không dị giới tập 1', 6), 'Xuyên không dị giới tập 6');

    // Hỗ trợ placeholder {ep} / {tap}
    assert.equal(
        formatEpisodeTopic('Xuyên không làm thần - Tập {ep} Vietsub', 4),
        'Xuyên không làm thần - Tập 4 Vietsub',
    );
    assert.equal(extractSeriesBaseName('Xuyên không dị giới tập 1'), 'Xuyên không dị giới');
});

test('normalizeEpisodeMetadata guarantees episode number in title and builds social caption', () => {
    const meta = normalizeEpisodeMetadata(
        {
            title: 'Phàm nhân tu tiên đại chiến thần giới',
            description: 'Diễn biến cực căng thẳng.',
            tags: ['xuyenkhong', 'tutien'],
        },
        {
            basePrompt: 'Xuyên không làm thần tập 1',
            episodeNumber: 3,
            totalEpisodes: 6,
        },
    );

    assert.match(meta.title, /Tập 3/i);
    assert.match(meta.socialMessage, /Tập 3/i);
    assert.ok(meta.tags.includes('xuyenkhong'));

    const instructions = buildEpisodeAiInstructions({
        basePrompt: 'Xuyên không dị giới',
        episodeNumber: 5,
        totalEpisodes: 6,
        originalTitle: 'Raw ep 5',
    });
    assert.match(instructions, /Tập 5/);
    assert.match(instructions, /Xuyên không dị giới - Tập 5/);
});

test('mapFilesToEpisodeSlots sorts 6 selected images naturally into episodes 1..6', () => {
    const files = [
        { name: 'thumb_tap10.jpg' },
        { name: 'thumb_tap2.jpg' },
        { name: 'thumb_tap1.jpg' },
        { name: 'thumb_tap6.jpg' },
        { name: 'thumb_tap3.jpg' },
        { name: 'thumb_tap4.jpg' },
    ];
    const sorted = sortFilesForEpisodes(files);
    assert.deepEqual(
        sorted.map((f) => f.name),
        [
            'thumb_tap1.jpg',
            'thumb_tap2.jpg',
            'thumb_tap3.jpg',
            'thumb_tap4.jpg',
            'thumb_tap6.jpg',
            'thumb_tap10.jpg',
        ],
    );

    const slots = mapFilesToEpisodeSlots(files, 6);
    assert.equal(slots.length, 6);
    assert.equal(slots[0].name, 'thumb_tap1.jpg');
    assert.equal(slots[1].name, 'thumb_tap2.jpg');
    assert.equal(slots[5].name, 'thumb_tap10.jpg');
});

test('generateAndPublishEpisode suggests AI content and publishes to YouTube, Facebook, and TikTok with episode thumbnail', async () => {
    const calls = [];
    const fakeYoutubeApi = async (path, options = {}) => {
        const body = options.body ? JSON.parse(options.body) : null;
        calls.push({ path, method: options.method || 'GET', body });
        if (path === 'suggest') {
            return {
                title: 'Xuyên không dị giới - Tập 2: Thức tỉnh thần lực',
                description: 'Tập 2 siêu hấp dẫn #Tap2 #xuyenkhong',
                tags: ['xuyenkhong', 'Tap2'],
            };
        }
        if (path === 'uploads') {
            return { id: 'yt-job-2', state: 'completed', url: 'https://youtu.be/ep2' };
        }
        if (path === 'social/facebook/publish') {
            return { id: 'fb-job-2', state: 'completed', url: 'https://facebook.com/ep2' };
        }
        if (path === 'social/tiktok/publish') {
            return { id: 'tt-job-2', state: 'completed', url: 'https://tiktok.com/@u/video/2' };
        }
        throw new Error(`Unexpected path: ${path}`);
    };

    const outcome = await generateAndPublishEpisode({
        youtubeApi: fakeYoutubeApi,
        accountId: 'user-123',
        video: { video_id: 'vid_ep2', title: 'Episode 2 raw' },
        channel: 'default',
        mode: 'voiceover',
        episodeNumber: 2,
        totalEpisodes: 6,
        basePrompt: 'Xuyên không dị giới tập 1',
        useAiPrompt: true,
        thumbnailDataUrl: 'data:image/jpeg;base64,AAA',
        platforms: { youtube: true, facebook: true, tiktok: true },
        youtubeConfig: { channelId: 'UC_TEST', privacy: 'public', madeForKids: false },
        facebookSaved: { connected: true, token: 'fb_tok', target: { id: 'page_1' } },
        tiktokSaved: { connected: true, token: 'tt_tok', target: { id: 'tt_1' } },
    });

    assert.equal(outcome.errors.length, 0);
    assert.equal(outcome.metadata.title, 'Xuyên không dị giới - Tập 2: Thức tỉnh thần lực');
    assert.equal(outcome.results.youtube.url, 'https://youtu.be/ep2');
    assert.equal(outcome.results.facebook.url, 'https://facebook.com/ep2');
    assert.equal(outcome.results.tiktok.url, 'https://tiktok.com/@u/video/2');

    const ytCall = calls.find((c) => c.path === 'uploads');
    assert.equal(ytCall.body.thumbnail, 'data:image/jpeg;base64,AAA');
    assert.equal(ytCall.body.privacy, 'public');
});

test('buildProcessPayloadFromSavedPreset converts saved preset/lastConfig for batch processing', () => {
    const payload = buildProcessPayloadFromSavedPreset(
        {
            processTargetLanguage: 'en',
            processSubtitleStyle: 'cinema',
            processVoice: 'en-US-JennyNeural',
            processLogoMode: 'custom',
            processLogoShape: 'rect',
            processLogoWidth: '220',
            processLogoHeight: '90',
            processLogoX: '40',
            processLogoY: '36',
            logo_data: 'data:image/png;base64,LOGO',
            logo_filename: 'brand.png',
        },
        { stability_mode: true },
    );

    assert.equal(payload.target_language, 'en');
    assert.equal(payload.subtitle_style, 'cinema');
    assert.equal(payload.voice, 'en-US-JennyNeural');
    assert.equal(payload.logo_mode, 'custom');
    assert.equal(payload.logo_shape, 'rect');
    assert.equal(payload.logo_width, 220);
    assert.equal(payload.logo_height, 90);
    assert.equal(payload.logo_x, 40);
    assert.equal(payload.logo_y, 36);
    assert.equal(payload.logo_data, 'data:image/png;base64,LOGO');
});

test('reorderEpisodeVideos and replaceEpisodeVideoAt swap or replace episode videos cleanly on drag and drop', () => {
    const epVideos = [
        { video_id: 'v1', title: 'Video 1' },
        { video_id: 'v2', title: 'Video 2' },
        { video_id: 'v3', title: 'Video 3' },
    ];

    // Drag Tập 3 onto Tập 1 -> swap v1 and v3
    const swapped = reorderEpisodeVideos(epVideos, 2, 0, { mode: 'swap' });
    assert.deepEqual(swapped.map((v) => v.video_id), ['v3', 'v2', 'v1']);

    // Drag a new source video v99 onto Tập 2 (index 1) -> replaces v2 with v99
    const replaced = replaceEpisodeVideoAt(swapped, 1, { video_id: 'v99', title: 'Video 99' });
    assert.deepEqual(replaced.map((v) => v.video_id), ['v3', 'v99', 'v1']);

    // Drag an already-present video v1 onto Tập 1 (index 0) -> swaps v3 and v1 without duplicating
    const dedupSwapped = replaceEpisodeVideoAt(replaced, 0, { video_id: 'v1', title: 'Video 1' });
    assert.deepEqual(dedupSwapped.map((v) => v.video_id), ['v1', 'v99', 'v3']);
});

test('generateAndPublishEpisode automatically grabs a frame from the video when no custom thumbnail is chosen', async () => {
    const calls = [];
    let resolvedPreview = null;
    const fakeYoutubeApi = async (path, options = {}) => {
        const body = options.body ? JSON.parse(options.body) : null;
        calls.push({ path, body });
        if (path === 'thumbnails') {
            return {
                images: [
                    'data:image/jpeg;base64,FRAME_0',
                    'data:image/jpeg;base64,FRAME_1',
                    'data:image/jpeg;base64,FRAME_2',
                ],
            };
        }
        if (path === 'suggest') {
            return {
                title: 'Xuyên không dị giới - Tập 1',
                description: 'Mô tả Tập 1',
                tags: ['Tap1'],
                thumbnail_index: 2,
            };
        }
        if (path === 'uploads') {
            return { id: 'yt-job-1', state: 'completed', url: 'https://youtu.be/ep1' };
        }
        throw new Error(`Unexpected path: ${path}`);
    };

    const outcome = await generateAndPublishEpisode({
        youtubeApi: fakeYoutubeApi,
        accountId: 'user-123',
        video: { video_id: 'vid_ep1', title: 'Raw ep 1' },
        channel: 'default',
        mode: 'voiceover',
        episodeNumber: 1,
        totalEpisodes: 2,
        basePrompt: 'Xuyên không dị giới',
        useAiPrompt: true,
        thumbnailDataUrl: null,
        platforms: { youtube: true },
        youtubeConfig: { channelId: 'UC_TEST', privacy: 'public', madeForKids: false },
        onThumbnailResolved: (frame) => {
            resolvedPreview = frame;
        },
    });

    assert.equal(outcome.errors.length, 0);
    assert.equal(resolvedPreview, 'data:image/jpeg;base64,FRAME_2');
    const ytCall = calls.find((c) => c.path === 'uploads');
    assert.equal(ytCall.body.thumbnail, 'data:image/jpeg;base64,FRAME_2');
});
