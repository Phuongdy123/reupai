"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { CHANNEL_ACTIVITY_EVENT, CHANNEL_PLATFORMS, readChannelActivity } from "../lib/channel-activity";
import { useYoutubeConnection } from "./youtube-connection";

export function ChannelAnalytics() {
  const youtube = useYoutubeConnection();
  const [account, setAccount] = useState(null);
  const [activity, setActivity] = useState({ account: null, channels: [] });
  const [days, setDays] = useState(30);

  useEffect(() => {
    const { data } = createClient().auth.onAuthStateChange((_event, session) => setAccount(session?.user?.id || null));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    const update = () => setActivity({ account, channels: readChannelActivity(account) });
    update();
    window.addEventListener(CHANNEL_ACTIVITY_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(CHANNEL_ACTIVITY_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, [account]);

  const connected = youtube.connection?.account_id === account && youtube.connection?.connected ? youtube.connection.channel : null;
  const channels = activity.account === account ? activity.channels : [];
  const cutoff = Date.now() - days * 86400000;
  const rows = Object.entries(CHANNEL_PLATFORMS).map(([provider, definition]) => {
    const items = channels.filter(channel => channel.provider === provider);
    if (provider === "youtube" && connected && !items.some(channel => channel.id === connected.id)) {
      items.push({ id: connected.id, name: connected.title, activity: [] });
    }
    const listed = items.map(channel => ({
      ...channel,
      count: channel.activity.filter(activity => activity.at >= cutoff).length,
      state: provider === "youtube" && connected?.id === channel.id ? "Đang kết nối" : provider === "youtube" ? "Kênh đã dùng" : "Đã xác minh trước đó",
    }));
    return { ...definition, provider, items: listed, total: listed.reduce((total, channel) => total + channel.count, 0) };
  });
  const max = Math.max(1, ...rows.map(row => row.total));

  return <section className="channel-analytics" aria-labelledby="channel-analytics-title">
    <header><div><h2 id="channel-analytics-title">Hoạt động các kênh</h2><p>Lượt gửi qua ReupAI ghi nhận trên trình duyệt này.</p></div><label>Khoảng thời gian<select value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>7 ngày</option><option value={30}>30 ngày</option></select></label></header>
    <div className="channel-analytics-grid">
      {rows.map(row => <article key={row.provider} className="channel-analytics-card" style={{ "--channel-color": row.color }}>
        <div className="channel-analytics-total"><h3>{row.label}</h3><strong>{row.total.toLocaleString("vi-VN")}</strong></div>
        <div className="channel-analytics-bar" aria-hidden="true"><i style={{ width: `${row.total / max * 100}%` }} /></div>
        <p>{row.activity}</p>
        {row.items.length ? <ul>{row.items.map(channel => <li key={channel.id}><div><strong>{channel.name || row.label}</strong><small>{channel.state}</small></div><b>{channel.count}</b></li>)}</ul> : <small>Chưa có kênh ghi nhận.</small>}
      </article>)}
    </div>
  </section>;
}
