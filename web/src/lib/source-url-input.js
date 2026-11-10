// Keep source identifiers case-sensitive. The Engine validates and resolves short links.
export function prepareSourceInput(value) {
  let text = String(value || '').trim().replace(/&amp;/g, '&');
  if (/^BV[\da-z]{10}$/i.test(text)) return `https://www.bilibili.com/video/BV${text.slice(2)}/`;
  if (/^av\d{1,20}$/i.test(text)) return `https://www.bilibili.com/video/${text.toLowerCase()}/`;
  if (/^https?%3a%2f%2f/i.test(text)) {
    try { text = decodeURIComponent(text); } catch { return text; }
  }
  const links = [...new Set((text.match(/https?:\/\/[^\s<>"“”]+/gi) || [])
    .map(link => link.replace(/[.,，。!！;；)\]}》」』]+$/, '')))].filter(link => {
      try { return /(^|\.)(bilibili\.com|b23\.tv|douyin\.com|iesdouyin\.com)$/.test(new URL(link).hostname); }
      catch { return false; }
    });
  if (links.length === 1) text = links[0];
  if (/^(?:(?:www|m|v)\.)?(?:bilibili\.com|b23\.tv|douyin\.com|iesdouyin\.com)\//i.test(text)) text = `https://${text}`;
  return text;
}

export function isDirectVideoInput(value) {
  try {
    const url = new URL(prepareSourceInput(value));
    return /(^|\.)b23\.tv$/.test(url.hostname) || url.hostname === 'v.douyin.com'
      || (/^(?:www\.|m\.)?bilibili\.com$/.test(url.hostname) && /\/video\/(?:BV[\da-z]{10}|av\d+)(?:\/|$)/i.test(url.pathname))
      || (/(^|\.)(?:douyin\.com|iesdouyin\.com)$/.test(url.hostname) && (/\/(?:share\/)?video\/\d+/.test(url.pathname) || url.searchParams.has('modal_id')));
  } catch { return false; }
}
