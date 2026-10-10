import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Preserve the tested product controls inside native Next.js DOM.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(root, "web/src/legacy");
mkdirSync(output, { recursive: true });
let runtime = readFileSync(resolve(root, "app/web/static/js/sources.js"), "utf8");
runtime = runtime.replace(/function openProcessConfig\(video, card, mode\)/, "async function openProcessConfig(video, card, mode)");
runtime = runtime.replace("function openPlayer(", "async function openPlayer(");
runtime = runtime.replace("image.src = coverUrl(url);", "image.crossOrigin = 'anonymous';\n        window.reupEngineClient.mediaUrl(coverUrl(url)).then(media => { image.src = media; }).catch(finish);");
runtime = runtime.replaceAll('src="${escapeHtml(coverUrl(', 'data-engine-cover="${escapeHtml(coverUrl(');
runtime = runtime.replace("preview.src = `/api/preview/source/${encodeURIComponent(video.video_id)}`;", "");
runtime = runtime.replace("preview.onresize = drawSelection;", "preview.onresize = drawSelection;\n    preview.crossOrigin = 'anonymous';\n    try { preview.src = await window.reupEngineClient.mediaUrl(`/api/preview/source/${encodeURIComponent(video.video_id)}`); } catch { preview.onerror(); }");
runtime = runtime.replace("preview.onloadedmetadata = () => { preview.style.display = 'block'; canvas.style.display = 'block'; empty.style.display = 'none'; drawSelection(); };", "preview.onloadedmetadata = () => { video.downloaded = true; downloadButton.hidden = true; preview.style.display = 'block'; canvas.style.display = 'block'; empty.style.display = 'none'; drawSelection(); };");
runtime = runtime.replace("preview.onerror = () => { preview.style.display = 'none'; canvas.style.display = 'none'; empty.style.display = 'block'; };", "preview.onerror = () => { downloadButton.hidden = false; preview.style.display = 'none'; canvas.style.display = 'none'; empty.style.display = 'block'; };");
runtime = runtime.replace("downloadButton.hidden = true;\n            preview.load();", "downloadButton.hidden = !!video.downloaded;\n            if (!video.downloaded) return;\n            preview.src = await window.reupEngineClient.mediaUrl(`/api/preview/source/${encodeURIComponent(video.video_id)}`);\n            preview.load();");
runtime = runtime.replace(/player\.src = \(([\s\S]*?)\n    \);/, "player.crossOrigin = 'anonymous';\n    player.src = await window.reupEngineClient.mediaUrl($1\n    );");
runtime = runtime.replace(/    const useEngine = \([\s\S]*?    \);\n    const response = \([\s\S]*?    \);\n\n    let data = \{\};/, "    const response = await window.reupEngineClient.request(url, options);\n\n    let data = {};");
runtime = runtime.replace(/    const writePresets = presets => \{[\s\S]*?\n    \};/, `    const writePresets = async presets => {
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
    };`);
runtime = runtime.replace("dialog.querySelector('#saveProcessPreset').onclick = () => {", "dialog.querySelector('#saveProcessPreset').onclick = async () => {");
runtime = runtime.replace("dialog.querySelector('#deleteProcessPreset').onclick = () => {", "dialog.querySelector('#deleteProcessPreset').onclick = async () => {");
runtime = runtime.replace("const saveSection = (section, label) => {", "const saveSection = async (section, label) => {");
runtime = runtime.replaceAll("writePresets(presets);", "if (!await writePresets(presets)) return;");
runtime = runtime.replace("    card\n    .querySelector(\n        '.video-select'", `    if (!video.cover_url && video.downloaded) {
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
        '.video-select'`);
runtime = runtime.replace("function renderPagination() {", `function renderPagination() {
    if (!currentVideos.length && !Object.keys(pageCache).length) {
        const pages = document.getElementById('bottomPages');
        const info = document.getElementById('pageInfo');
        if (pages) { pages.innerHTML = ''; pages.style.display = 'none'; }
        if (info) info.textContent = '';
        return;
    }
`);
const finalInit = runtime.lastIndexOf("initializeV13()\n.catch(");
if (finalInit < 0) throw new Error("Source initialization marker changed; audit before syncing.");
runtime = runtime.slice(0, finalInit) + `
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
        return eval('(function(event){' + source + '\\n})').call(element, event);
    },
};
`;
runtime = runtime.replace(/[ \t]+$/gm, "");
writeFileSync(resolve(output, "sources-runtime.js"), `// Generated from the mature local Sources UI by web/scripts/sync-source-ui.mjs.
// All API and media transport is supplied by the shared LocalEngineClient.
export function startSourcesRuntime(environment) {
const { document, window, localStorage, setTimeout, clearTimeout, setInterval, clearInterval, fetch, history } = environment;
${runtime}
}
`);
const template = readFileSync(resolve(root, "app/web/templates/sources.html"), "utf8");
const content = template.match(/{% block content %}([\s\S]*?){% endblock %}/)?.[1];
const modal = template.match(/{% block modal %}([\s\S]*?){% endblock %}/)?.[1];
if (!content || !modal) throw new Error("Sources template blocks changed; audit before syncing.");
const markup = (content + modal).replace(/value="https:\/\/space\.bilibili\.com\/\d+"/, 'value=""');
writeFileSync(resolve(output, "sources-markup.js"), `// Native product DOM copied from app/web/templates/sources.html.
export const sourcesMarkup = ${JSON.stringify(markup)};\n`);
console.log("Synchronized native Sources DOM and mature runtime.");
