export const CHANNEL_ACTIVITY_EVENT = "reupai:channel-activity";

export const CHANNEL_PLATFORMS = {
  youtube: { label: "YouTube", activity: "Video đã gửi", color: "#ff6275" },
  facebook: { label: "Facebook Page", activity: "Bài đã gửi", color: "#78a8ff" },
  tiktok: { label: "TikTok", activity: "Bản nháp đã gửi", color: "#60e4d7" },
};

export function readChannelActivity(accountId) {
  if (!accountId) return [];
  try {
    const value = JSON.parse(localStorage.getItem(`reupai:channels:v1:${accountId}`));
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

export function recordChannelActivity(accountId, provider, identity, jobId) {
  if (!accountId || !Object.hasOwn(CHANNEL_PLATFORMS, provider) || !identity?.id) return;
  const channels = readChannelActivity(accountId);
  const index = channels.findIndex(channel => channel.provider === provider && channel.id === identity.id);
  const previous = channels[index];
  const activity = previous?.activity ? [...previous.activity] : [];
  if (jobId && !activity.some(job => job.id === jobId)) activity.push({ id: jobId, at: Date.now() });
  const channel = { provider, id: identity.id, name: identity.name || identity.title, activity: activity.slice(-2000) };
  if (index < 0) channels.push(channel);
  else channels[index] = channel;
  try {
    localStorage.setItem(`reupai:channels:v1:${accountId}`, JSON.stringify(channels));
    window.dispatchEvent(new Event(CHANNEL_ACTIVITY_EVENT));
  } catch { /* Posting remains available when browser storage is disabled. */ }
}
