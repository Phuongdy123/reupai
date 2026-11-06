"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEngine } from "./engine-provider";
import { BillingNotice, useBilling } from "./billing-provider";
import { Icon } from "./icon";
import { WorkspaceAssistant } from "./workspace-assistant";
import { planName, quotaText } from "../lib/plan-display";
import { ACTIVE_JOBS, ErrorMessage, JOB_LABELS, VideoCover, jobVideoId, modeLabel, numberText, outputPath, progressValue, sourcePath, stageLabel } from "./library-ui";

function recentCards(items) {
  const seen = new Set();
  return items.filter((job) => {
    const id = jobVideoId(job);
    const key = `${id}:${job.mode || "subtitle"}`;
    if (!id || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

export function Dashboard() {
  const { status, client, connect, check } = useEngine();
  const [data, setData] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState(null);
  const [stopping, setStopping] = useState(null);
  const [recentMedia, setRecentMedia] = useState({});
  const { account: billing, error: billingError, refresh: refreshBilling } = useBilling();
  const jobsRequest = useRef(false);
  const dashboardRequest = useRef(false);
  const loadJobs = useCallback(async () => {
    if (status !== "connected" || jobsRequest.current) return;
    jobsRequest.current = true;
    try { const result = await client.json("/api/jobs", { cache: "no-store" }); setJobs(result.jobs || []); }
    catch (requestError) { setError(requestError.message || "Không thể đọc tiến độ xử lý."); }
    finally { jobsRequest.current = false; }
  }, [client, status]);
  const load = useCallback(async () => {
    if (status !== "connected" || dashboardRequest.current) return;
    dashboardRequest.current = true;
    setError(null);
    try {
      const result = await client.json("/api/library/dashboard", { cache: "no-store" });
      setData(result);
    } catch (requestError) { setError(requestError.message || "Không thể tải Dashboard."); }
    finally { dashboardRequest.current = false; }
  }, [client, status]);
  useEffect(() => { load(); loadJobs(); }, [load, loadJobs]);
  const recentIds = recentCards(data?.recent_jobs || []).map(jobVideoId).join(",");
  useEffect(() => {
    if (status !== "connected" || !recentIds) return undefined;
    let active = true;
    Promise.allSettled([client.json("/api/library/downloads"), client.json("/api/library/outputs")]).then(([downloadResult, outputResult]) => {
      if (!active) return;
      const downloads = downloadResult.status === "fulfilled" ? downloadResult.value.videos || [] : [];
      const outputs = outputResult.status === "fulfilled" ? outputResult.value.outputs || [] : [];
      const wanted = new Set(recentIds.split(","));
      const media = {};
      for (const item of [...downloads, ...outputs]) {
        if (!wanted.has(item.video_id)) continue;
        const previous = media[item.video_id] || {};
        media[item.video_id] = {
          title: previous.title || (item.title !== item.video_id ? item.title : ""),
          cover_url: previous.cover_url || item.cover_url || "",
          previewPath: previous.previewPath || (item.mode ? outputPath(item) : sourcePath(item)),
        };
      }
      setRecentMedia(media);
    });
    return () => { active = false; };
  }, [client, recentIds, status]);
  const stopJob = async (job) => {
    const id = jobVideoId(job);
    if (!id) return;
    setStopping(id);
    try {
      const query = new URLSearchParams({ channel: job.channel_key || "2d_animation", mode: job.mode || "subtitle" });
      await client.json(`/api/jobs/${encodeURIComponent(id)}/stop?${query}`, { method: "POST" });
      await Promise.all([load(), loadJobs()]);
    } catch (requestError) { setError(requestError.message || "Không thể dừng job."); }
    finally { setStopping(null); }
  };
  const stats = status === "connected" ? data?.stats || {} : {};
  const hasActiveJobs = jobs.some((job) => ACTIVE_JOBS.has(job.status));
  useEffect(() => {
    if (status !== "connected") return undefined;
    const pollJobs = () => { if (document.visibilityState === "visible") loadJobs(); };
    const pollDashboard = () => { if (document.visibilityState === "visible") load(); };
    const onVisible = () => { if (document.visibilityState === "visible") { load(); loadJobs(); } };
    const jobTimer = window.setInterval(pollJobs, hasActiveJobs ? 2000 : 15000);
    const dataTimer = window.setInterval(pollDashboard, hasActiveJobs ? 10000 : 30000);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(jobTimer); window.clearInterval(dataTimer); document.removeEventListener("visibilitychange", onVisible); };
  }, [hasActiveJobs, load, loadJobs, status]);
  return <div className="dashboard-workspace">
    <section className="dashboard-welcome">
      <div><span className="workspace-eyebrow">KHÔNG GIAN SÁNG TẠO</span><h2>Từ ý tưởng đến <span>video của bạn.</span></h2><p>Tạo phụ đề, thêm giọng đọc và hoàn thiện câu chuyện tiếp theo.</p></div>
      <Link className="btn primary dashboard-create" href="/sources"><Icon name="plus" size={18} /> Tạo video mới</Link>
    </section>
    <section className="dashboard-overview" aria-label="Tổng quan công việc">
      <div className="dashboard-overview-grid">{[
        ["play", "Video nguồn", stats.total_videos], ["download", "Đã tải", stats.downloaded], ["spark", "Thành phẩm", stats.outputs], ["settings", "Đang xử lý", status === "connected" ? jobs.length : null],
      ].map(([icon, label, value]) => <article className="dashboard-overview-card" key={label}><span><Icon name={icon} size={18} /></span><div><small>{label}</small><strong>{value == null ? "—" : numberText(value)}</strong></div></article>)}</div>
      <div className={`dashboard-billing-card plan-${billing?.plan || "free"}`}><div><strong className="dashboard-plan-name">{billing ? planName(billing) : billingError ? "Chưa đọc được gói" : "Đang tải gói…"}{billing?.plan === "pro" && <span className="dashboard-plan-badge pro" aria-label="Gói Pro">✦ PRO</span>}{billing?.plan === "free" && <span className="dashboard-plan-badge free" aria-label="Gói Free">✦ FREE</span>}</strong><span>{quotaText(billing)}</span></div><Link href="/plans">Quản lý gói <span aria-hidden="true">↗</span></Link></div>
      <BillingNotice error={billingError} refresh={refreshBilling} />
      {status !== "connected" && <section className="dashboard-overview-alert dashboard-engine-onboarding" aria-label="Cài phần mềm để bắt đầu xử lý video">
        <Icon name="desktop" size={24} />
        <div className="dashboard-engine-guide"><strong>Bước tiếp theo: cài Local Engine</strong><p>Bạn đã vào workspace. Để tải, Vietsub và lồng tiếng video, cần cài ứng dụng Windows xử lý trên máy của bạn.</p><ol><li>Tải bộ cài, cài đặt và mở ReupAI Local Engine.</li><li>Quay lại trang này và bấm “Đã cài · Kiểm tra kết nối”.</li><li>Vào <Link href="/settings#diagnostics">Cài đặt Gemini</Link>, kết nối Google và chọn project của bạn để bắt đầu.</li></ol><Link href="/local-engine">Xem hướng dẫn cài đặt →</Link></div>
        <div className="dashboard-engine-actions"><a className="dashboard-engine-download" href="/api/engine/download">Tải Local Engine cho Windows</a><button type="button" disabled={status === "checking" || status === "authorizing"} onClick={status === "authorization_required" || status === "permission_denied" ? connect : check}>{status === "checking" || status === "authorizing" ? "Đang kiểm tra…" : status === "authorization_required" || status === "permission_denied" ? "Cấp quyền kết nối" : "Đã cài · Kiểm tra kết nối"}</button></div>
      </section>}
      {status === "connected" && jobs.length > 0 && <div className="dashboard-active-jobs">{jobs.slice(0, 2).map((job) => <div className="dashboard-active-job" key={job.id || job.job_key || `${jobVideoId(job)}-${job.mode}`}><div><strong>{jobVideoId(job)}</strong><small>{stageLabel(job.stage)} · {modeLabel(job.mode)}</small></div><span>{progressValue(job.progress)}%</span><div className="dashboard-active-track"><i style={{ width: `${progressValue(job.progress)}%` }} /></div>{ACTIVE_JOBS.has(job.status) && <button type="button" disabled={stopping === jobVideoId(job)} onClick={() => stopJob(job)}>{stopping === jobVideoId(job) ? "Đang dừng…" : "Dừng"}</button>}</div>)}{jobs.length > 2 && <Link href="/history">Xem thêm {jobs.length - 2} job →</Link>}</div>}
    </section>
    <WorkspaceAssistant client={client} connected={status === "connected"} check={check} />
    <DashboardRecentJobs client={client} items={status === "connected" ? data?.recent_jobs || [] : []} media={recentMedia} loading={status === "connected" && !data && !error} />
    <DashboardSuggestions />
    {status === "connected" && <ErrorMessage error={error} retry={load} />}
  </div>;
}
function DashboardSuggestions() {
  const links = [["/sources", "Lồng tiếng AI", "Tạo bản Voice tự nhiên", "art-0"], ["/sources", "Vietsub video", "Dịch và tạo phụ đề", "art-1"], ["/sources", "Chọn giọng đọc", "Xử lý video bằng AI", "art-2"], ["/outputs", "Xem thành phẩm", "Mở và tải kết quả", "art-3"]];
  return <section className="dashboard-shortcuts" aria-label="Gợi ý bắt đầu"><div className="dashboard-section-title"><h2>Có thể bạn muốn thử</h2><Link href="/sources">Xem nguồn video →</Link></div><div className="dashboard-shortcut-grid">{links.map(([href, title, description, art]) => <Link className="dashboard-shortcut-card dashboard-image-card" href={href} key={art}><span className={`dashboard-feature-art ${art}`} aria-hidden="true" /><span className="dashboard-feature-copy"><strong>{title}</strong><small>{description}</small></span><span className="dashboard-shortcut-arrow">↗</span></Link>)}</div></section>;
}
function DashboardRecentJobs({ client, items, media, loading }) {
  const cards = recentCards(items);
  return <section className="dashboard-recents" aria-label="Công việc gần đây">
    <div className="dashboard-section-title"><h2>Lịch sử gần đây</h2><Link href="/history">Xem tất cả →</Link></div>
    {loading ? <div className="dashboard-recent-grid" role="status" aria-label="Đang tải video gần đây">{[0, 1, 2, 3].map((item) => <div key={item} className="workspace-skeleton-card" aria-hidden="true"><div /><span /><span /></div>)}</div> : cards.length ? <div className="dashboard-recent-grid">{cards.map((job, index) => <Link className="dashboard-recent-card" href={sourceHrefForJob(job)} key={job.id || job.job_key || `${jobVideoId(job)}-${job.mode}-${index}`}>
      <div className={`dashboard-recent-art art-${index % 4}`}>{media[jobVideoId(job)]?.cover_url || media[jobVideoId(job)]?.previewPath ? <VideoCover client={client} video={{ ...job, ...media[jobVideoId(job)] }} previewPath={media[jobVideoId(job)]?.previewPath} /> : <Icon name={job.mode === "voiceover" ? "spark" : "play"} size={34} />}<span>{modeLabel(job.mode)}</span></div>
      <strong>{media[jobVideoId(job)]?.title || job.title || job.video_title || jobVideoId(job) || "Video của bạn"}</strong>
      <small>{stageLabel(job.stage)} · {JOB_LABELS[job.status] || job.status || "Đang chờ"}</small>
    </Link>)}</div> : <div className="dashboard-recent-empty"><span><Icon name="play" size={27} /></span><div><strong>{loading ? "Đang tải công việc…" : "Chưa có video gần đây"}</strong><p>{loading ? "ReupAI đang đọc dữ liệu trên máy của bạn." : "Dán link video và tạo Vietsub hoặc Voice để bắt đầu."}</p></div><Link href="/sources">Tạo video đầu tiên →</Link></div>}
  </section>;
}
function sourceHrefForJob(job) { return `/sources?${new URLSearchParams({ video: jobVideoId(job), mode: job.mode || "subtitle" })}`; }
