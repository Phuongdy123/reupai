import crypto from 'node:crypto';
import { NextResponse } from 'next/server';

const MAX_CLIP_BYTES = 4 * 1024 * 1024;

export async function POST(request) {
    try {
        const formData = await request.formData();
        const file = formData.get('file');
        const provider = String(formData.get('provider') || 'audd').trim().toLowerCase();
        const auddToken = String(formData.get('audd_api_token') || process.env.AUDD_API_TOKEN || '').trim();
        const acrHost = String(formData.get('acrcloud_host') || process.env.ACRCLOUD_HOST || '')
            .trim()
            .replace(/^https?:\/\//i, '')
            .replace(/\/+$/, '');
        const acrKey = String(formData.get('acrcloud_access_key') || process.env.ACRCLOUD_ACCESS_KEY || '').trim();
        const acrSecret = String(formData.get('acrcloud_access_secret') || process.env.ACRCLOUD_ACCESS_SECRET || '').trim();

        if (!file || typeof file.arrayBuffer !== 'function') {
            return NextResponse.json({ ok: false, error: 'Thiếu đoạn âm thanh/video để nhận diện nhạc.' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        if (!buffer.length || buffer.length > MAX_CLIP_BYTES) {
            return NextResponse.json({ ok: false, error: 'Kích thước đoạn mẫu vượt quá giới hạn 4 MB.' }, { status: 400 });
        }

        if (provider === 'acrcloud' || (!auddToken && acrHost && acrKey && acrSecret)) {
            if (!acrHost || !acrKey || !acrSecret) {
                return NextResponse.json({ ok: false, error: 'Chưa cấu hình đầy đủ ACRCloud Host / Access Key / Secret.' }, { status: 400 });
            }
            const timestamp = String(Math.floor(Date.now() / 1000));
            const stringToSign = ['POST', '/v1/identify', acrKey, 'audio', '1', timestamp].join('\n');
            const signature = crypto
                .createHmac('sha1', acrSecret)
                .update(stringToSign)
                .digest('base64');

            const upstreamForm = new FormData();
            upstreamForm.append('access_key', acrKey);
            upstreamForm.append('sample_bytes', String(buffer.length));
            upstreamForm.append('timestamp', timestamp);
            upstreamForm.append('signature', signature);
            upstreamForm.append('data_type', 'audio');
            upstreamForm.append('signature_version', '1');
            upstreamForm.append('sample', new Blob([buffer], { type: file.type || 'video/mp4' }), file.name || 'sample.mp4');

            const upstream = await fetch(`https://${acrHost}/v1/identify`, {
                method: 'POST',
                body: upstreamForm,
            });
            const data = await upstream.json().catch(() => ({}));
            const top = data?.metadata?.music?.[0];
            if (!top) {
                return NextResponse.json({ ok: true, matched: false, provider: 'acrcloud', track: null });
            }
            const artists = Array.isArray(top.artists)
                ? top.artists.map((a) => a?.name).filter(Boolean).join(', ')
                : '';
            return NextResponse.json({
                ok: true,
                matched: true,
                provider: 'acrcloud',
                track: {
                    provider: 'acrcloud',
                    title: String(top.title || '').trim(),
                    artist: artists,
                    album: String(top.album?.name || '').trim(),
                    label: String(top.label || '').trim(),
                    release_date: String(top.release_date || '').trim(),
                    song_link: '',
                    isrc: String(top.external_ids?.isrc || '').trim(),
                },
            });
        }

        if (!auddToken) {
            return NextResponse.json({ ok: false, error: 'Chưa nhập AudD API Token.' }, { status: 400 });
        }

        const auddForm = new FormData();
        auddForm.append('api_token', auddToken);
        auddForm.append('return', 'spotify,apple_music');
        auddForm.append('file', new Blob([buffer], { type: file.type || 'video/mp4' }), file.name || 'sample.mp4');

        const upstream = await fetch('https://api.audd.io/', {
            method: 'POST',
            body: auddForm,
        });
        const data = await upstream.json().catch(() => ({}));
        if (data?.status !== 'success') {
            const msg = data?.error?.error_message || 'AudD không xử lý được đoạn mẫu này.';
            return NextResponse.json({ ok: false, error: msg }, { status: 502 });
        }
        const res = data.result;
        if (!res || typeof res !== 'object') {
            return NextResponse.json({ ok: true, matched: false, provider: 'audd', track: null });
        }
        return NextResponse.json({
            ok: true,
            matched: true,
            provider: 'audd',
            track: {
                provider: 'audd',
                title: String(res.title || '').trim(),
                artist: String(res.artist || '').trim(),
                album: String(res.album || '').trim(),
                label: String(res.label || res.apple_music?.recordLabel || '').trim(),
                release_date: String(res.release_date || '').trim(),
                song_link: String(res.song_link || '').trim(),
                isrc: String(res.spotify?.external_ids?.isrc || res.apple_music?.isrc || '').trim(),
            },
        });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: error?.message || 'Lỗi máy chủ khi nhận diện nhạc.' },
            { status: 500 },
        );
    }
}
