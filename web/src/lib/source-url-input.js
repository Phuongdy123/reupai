// Keep source identifiers case-sensitive. The Engine validates and resolves short links.
const BARE_SOURCE_HOST = /^(?:(?:[a-z0-9-]+)\.)?(?:bilibili\.com|b23\.tv|douyin\.com|iesdouyin\.com|youtube\.com|youtu\.be|tiktok\.com|facebook\.com|fb\.watch|instagram\.com|x\.com|twitter\.com|xiaohongshu\.com|xhslink\.com|vimeo\.com|twitch\.tv|dailymotion\.com)\//i;

export function isPublicSourceHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.+$/, '');
  if (!host || host === 'localhost' || /\.(?:localhost|local|internal|arpa|test)$/.test(host)) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')) return false;
  return host.includes('.');
}

export function prepareSourceInput(value) {
  let text = String(value || '').trim().replace(/&amp;/g, '&');
  if (/^BV[\da-z]{10}$/i.test(text)) return `https://www.bilibili.com/video/BV${text.slice(2)}/`;
  if (/^av\d{1,20}$/i.test(text)) return `https://www.bilibili.com/video/${text.toLowerCase()}/`;
  if (/^https?%3a%2f%2f/i.test(text)) {
    try { text = decodeURIComponent(text); } catch { return text; }
  }
  const allLinks = [...new Set((text.match(/https?:\/\/[^\s<>"“”]+/gi) || [])
    .map(link => link.replace(/[.,，。!！;；)\]}》」』]+$/, '')))].filter(link => {
      try {
        const u = new URL(link);
        return ['http:', 'https:'].includes(u.protocol) && isPublicSourceHost(u.hostname);
      } catch { return false; }
    });
  const primaryLinks = allLinks.filter(link => {
    try { return /(^|\.)(bilibili\.com|b23\.tv|douyin\.com|iesdouyin\.com)$/.test(new URL(link).hostname); }
    catch { return false; }
  });
  if (primaryLinks.length === 1) text = primaryLinks[0];
  else if (allLinks.length === 1) text = allLinks[0];
  if (BARE_SOURCE_HOST.test(text)) text = `https://${text}`;
  const biliSpace = text.match(/^https?:\/\/(?:space\.bilibili\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?|m\.bilibili\.com\/space\/)(\d+)(?:\/.*)?(?:\?.*)?$/i);
  if (biliSpace) return `https://space.bilibili.com/${biliSpace[1]}`;
  return text;
}

export function isDirectVideoInput(value) {
  try {
    const url = new URL(prepareSourceInput(value));
    const host = url.hostname.toLowerCase();
    const path = url.pathname || '';
    if (!['http:', 'https:'].includes(url.protocol) || !isPublicSourceHost(host)) return false;
    if (/^(?:space\.bilibili\.com|m\.bilibili\.com)$/.test(host) && (host === 'space.bilibili.com' || /^\/space\//.test(path))) return false;
    if (/(^|\.)douyin\.com$/.test(host) && /\/user\//.test(path)) return false;
    if (/(^|\.)b23\.tv$/.test(host) || host === 'v.douyin.com') return true;
    if (/^(?:www\.|m\.)?bilibili\.com$/.test(host)) {
      return /\/video\/(?:BV[\da-z]{10}|av\d+)(?:\/|$)/i.test(path);
    }
    if (/(^|\.)(?:douyin\.com|iesdouyin\.com)$/.test(host)) {
      return /\/(?:share\/)?video\/\d+/.test(path) || url.searchParams.has('modal_id');
    }
    if (host === 'youtu.be' || host.endsWith('.youtu.be')) return path.replace(/^\/+|\/+$/g, '').length > 0;
    if (/(^|\.)(?:youtube\.com|youtube-nocookie\.com)$/.test(host)) {
      if (/^\/(?:channel\/|@|c\/|user\/|playlist)/i.test(path)) return false;
      return (path === '/watch' && url.searchParams.has('v')) || /^\/(?:shorts|live|embed)\/[^/]+/i.test(path);
    }
    if (/(^|\.)(?:tiktok\.com|tiktokv\.com)$/.test(host)) {
      return /^(?:vt|vm)\.tiktok\.com$/.test(host) || /\/(?:video|v)\/\d+|\/t\/[^/]+/i.test(path);
    }
    if (/(^|\.)(?:fb\.watch|facebook\.com|fb\.com)$/.test(host)) {
      return host === 'fb.watch' || /^\/(?:watch|reel|videos|share\/[vr])\b/i.test(path) || /\/videos\/\d+/i.test(path) || url.searchParams.has('v');
    }
    if (/(^|\.)(?:instagram\.com|instagr\.am)$/.test(host)) {
      return /^\/(?:p|reel|reels|tv)\/[^/]+/i.test(path);
    }
    if (/(^|\.)(?:x\.com|twitter\.com|t\.co)$/.test(host)) {
      return host === 't.co' || /\/status\/\d+/i.test(path);
    }
    if (/(^|\.)(?:xiaohongshu\.com|xhslink\.com)$/.test(host)) {
      return host === 'xhslink.com' || /^\/(?:explore|discovery\/item)\/[^/]+/i.test(path);
    }
    if (/(^|\.)vimeo\.com$/.test(host)) return /^\/\d+/.test(path);
    if (/(^|\.)twitch\.tv$/.test(host)) return /^\/videos\/\d+|^\/[^/]+\/clip\//i.test(path) || host.startsWith('clips.');
    if (/(^|\.)(?:dailymotion\.com|dai\.ly)$/.test(host)) return host === 'dai.ly' || /^\/video\/[^/]+/i.test(path);
    return /\.(?:mp4|webm|mov|mkv)(?:$|\?)/i.test(path);
  } catch { return false; }
}

export function videoUrlForIdentity(value) {
  const id = String(value || '');
  const bili = /^(BV[\da-z]{10}|av\d{1,20})(?:_p([1-9]\d{0,4}))?$/i.exec(id);
  if (bili) return `https://www.bilibili.com/video/${bili[1]}/${bili[2] ? `?p=${Number(bili[2])}` : ''}`;
  if (/^\d{10,25}$/.test(id)) return `https://www.douyin.com/video/${id}`;
  if (/^yt_[A-Za-z0-9_-]{6,32}$/.test(id)) return `https://www.youtube.com/watch?v=${id.slice(3)}`;
  return '';
}
