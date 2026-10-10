"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useEngine } from "./engine-provider";
import { Icon } from "./icon";
import { ACTIVE_JOBS, EngineGate, ErrorMessage, HistoryTable, JOB_LABELS, Loading, jobVideoId, modeLabel, numberText, progressValue, stageLabel } from "./library-ui";

export function Dashboard() {
  const { status, client, connect, check } = useEngine();
  const [data, setData] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState(null);
  const [stopping, setStopping] = useState(null);
  const loadJobs = useCallback(async () => {
    if (status !== "connected") return;
    try { const result = await client.json("/api/jobs", { cache: "no-store" }); setJobs(result.jobs || []); }
    catch (requestError) { setError(requestError.message || "Không thể đọc tiến độ xử lý."); }
  }, [client, status]);
  const load = useCallback(async () => {
    if (status !== "connected") return;
    setError(null);
    try {
      const [result, active] = await Promise.all([client.json("/api/library/dashboard", { cache: "no-store" }), client.json("/api/jobs", { cache: "no-store" })]);
      setData(result); setJobs(active.jobs || []);
    } catch (requestError) { setError(requestError.message || "Không thể tải Dashboard."); }
  }, [client, status]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (status !== "connected") return undefined;
    const jobTimer = window.setInterval(loadJobs, 2000);
    const dataTimer = window.setInterval(load, 10000);
    return () => { window.clearInterval(jobTimer); window.clearInterval(dataTimer); };
  }, [load, loadJobs, status]);
  const stopJob = async (job) => {
    const id = jobVideoId(job);
    if (!id) return;
    setStopping(id);
    try {
      const query = new URLSearchParams({ channel: job.channel_key || "2d_animation", mode: job.mode || "subtitle" });
      await client.json(`/api/jobs/${encodeURIComponent(id)}/stop?${query}`, { method: "POST" });
      await load();
    } catch (requestError) { setError(requestError.message || "Không thể dừng job."); }
    finally { setStopping(null); }
  };
  if (status !== "connected") return <EngineGate status={status} connect={connect} check={check} title="Dashboard" />;
  const stats = data?.stats || {};
  return <>
    <ErrorMessage error={error} retry={load} />
    {!data && !error && <Loading />}
    <div className="stats-grid">{[
      ["play", "Video trong DB", stats.total_videos], ["download", "Đã tải", stats.downloaded], ["spark", "Thành phẩm", stats.outputs], ["settings", "Đang xử lý", jobs.length],
    ].map(([icon, label, value]) => <article className="stat-card" key={label}><span><Icon name={icon} size={22} /></span><small>{label}</small><strong>{value == null ? "—" : numberText(value)}</strong></article>)}</div>
    <section className="panel"><div className="panel-head"><div><h2>Đang xử lý realtime</h2><p>Tự cập nhật tiến độ mỗi 2 giây.</p></div><span className="status processing">{jobs.length} job</span></div>
      {jobs.length ? jobs.map((job) => <article className="live-job" key={job.id || job.job_key || `${jobVideoId(job)}-${job.mode}`}><div className="live-job-head"><div><strong>{jobVideoId(job)}</strong><span>{modeLabel(job.mode)} · {job.channel_key}</span></div><span className={`status ${job.status}`}>{JOB_LABELS[job.status] || job.status}</span></div><div className="live-job-stage"><span>{stageLabel(job.stage)}</span><strong>{progressValue(job.progress)}%</strong></div><div className="live-progress"><div className="live-progress-bar" style={{ width: `${progressValue(job.progress)}%` }} /></div><div className="library-actions" style={{ marginTop: 10 }}><Link href={sourceHrefForJob(job)} className="text-link">Chi tiết video</Link>{ACTIVE_JOBS.has(job.status) && <button className="btn danger" disabled={stopping === jobVideoId(job)} onClick={() => stopJob(job)}>{stopping === jobVideoId(job) ? "Đang dừng…" : "Dừng xử lý"}</button>}</div></article>) : <div className="empty-state compact">Hiện không có pipeline nào đang chạy.</div>}
    </section>
    <div className="dashboard-grid"><section className="panel"><div className="panel-head"><div><h2>Tình trạng hệ thống</h2><p>Dữ liệu local từ SQLite và thư viện file.</p></div><button className="btn secondary" onClick={load}><Icon name="refresh" size={15} />Làm mới</button></div><div className="status-list"><div><span>Nguồn đang bật</span><strong>{stats.total_sources == null ? "—" : numberText(stats.total_sources)}</strong></div><div><span>Job hoàn tất</span><strong>{stats.completed_jobs == null ? "—" : numberText(stats.completed_jobs)}</strong></div><div><span>Job lỗi</span><strong className="danger-text">{stats.failed_jobs == null ? "—" : numberText(stats.failed_jobs)}</strong></div><div><span>Dung lượng được index</span><strong>{stats.storage || "—"}</strong></div></div></section>
      <section className="panel"><div className="panel-head"><div><h2>Thao tác nhanh</h2><p>Đi tới khu vực cần làm việc.</p></div></div><div className="quick-actions">{[["/sources", "play", "Lấy video nguồn", "Bilibili / Douyin → Vietsub / Voice"], ["/downloads", "download", "Video đã tải", "Quản lý video nguồn trên máy"], ["/outputs", "spark", "Thành phẩm", "Xem và tải video hoàn tất"]].map(([href, icon, label, description]) => <Link className="quick-card" href={href} key={href}><span><Icon name={icon} size={22} /></span><strong>{label}</strong><small>{description}</small></Link>)}</div></section></div>
    <section className="panel"><div className="panel-head"><div><h2>Job gần đây</h2><p>Lịch sử mới nhất trong database.</p></div><Link className="text-link" href="/history">Xem tất cả →</Link></div>{data?.recent_jobs?.length ? <HistoryTable items={data.recent_jobs} onStop={stopJob} stopping={stopping} /> : <div className="empty-state">Chưa có job nào. Chạy Vietsub hoặc Voice ở “Nguồn video” để tạo job đầu tiên.</div>}</section>
  </>;
}
function sourceHrefForJob(job) { return `/sources?${new URLSearchParams({ video: jobVideoId(job), mode: job.mode || "subtitle" })}`; }
