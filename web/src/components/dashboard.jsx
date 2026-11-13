"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEngine } from "./engine-provider";
import { useGuestAccess } from "./guest-access";
import { BillingNotice, useBilling } from "./billing-provider";
import { Icon } from "./icon";
import { WorkspaceAssistant } from "./workspace-assistant";
import { planName, quotaText } from "../lib/plan-display";
import { REUPAI_MICROSOFT_STORE_URL } from "../lib/store-links";
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
  const { status, client, connect, check, preview } = useEngine();
  const { isGuest, requestSignIn } = useGuestAccess();
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
  const stats = !isGuest && status === "connected" ? data?.stats || {} : {};
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
  return <div className={`dashboard-workspace dashboard-circles${isGuest ? " is-guest" : ""}`}>
    <section className="dashboard-welcome">
      <div className="dashboard-welcome-copy"><span className="workspace-eyebrow"><i aria-hidden="true" /> KHÔNG GIAN SÁNG TẠO</span><h2>Từ ý tưởng đến <span>video của bạn.</span></h2><p>{isGuest ? "Khám phá không gian sáng tạo. Đăng nhập khi bạn sẵn sàng xử lý video." : "Tạo phụ đề, thêm giọng đọc và hoàn thiện câu chuyện tiếp theo."}</p><Link className="btn primary dashboard-create" href="/sources"><Icon name="plus" size={16} /> Tạo video mới</Link></div>
      <div className="dashboard-welcome-orbit" aria-hidden="true"><span className="dashboard-orbit-ring ring-outer" /><span className="dashboard-orbit-ring ring-inner" /><span className="dashboard-orbit-core"><Icon name="play" size={29} /></span><span className="dashboard-orbit-node node-spark"><Icon name="spark" size={16} /></span><span className="dashboard-orbit-node node-sound"><Icon name="download" size={15} /></span><span className="dashboard-orbit-point" /></div>
    </section>
    <section className="dashboard-overview" aria-label="Tổng quan công việc">
      <div className="dashboard-overview-grid">{[
        ["play", "Video nguồn", stats.total_videos], ["download", "Đã tải", stats.downloaded], ["spark", "Thành phẩm", stats.outputs], ["settings", "Đang xử lý", !isGuest && status === "connected" ? jobs.length : null],
      ].map(([icon, label, value]) => <article className="dashboard-overview-card" key={label}><span><Icon name={icon} size={18} /></span><div><small>{label}</small><strong>{value == null ? "—" : numberText(value)}</strong></div></article>)}</div>
      {isGuest ? <div className="dashboard-billing-card dashboard-guest-card"><span className="dashboard-plan-orb" aria-hidden="true"><Icon name="user" size={18} /></span><div className="dashboard-plan-copy"><strong>Không gian sáng tạo đang chờ bạn.</strong><span>Đăng nhập để lưu công việc, tạo Vietsub và lồng tiếng AI.</span></div><button type="button" onClick={() => requestSignIn({ next: "/app", reason: "Đăng nhập để bắt đầu sáng tạo và quản lý video của bạn." })}>Đăng nhập</button></div> : <><div className={`dashboard-billing-card plan-${billing?.plan || "free"}`}><span className="dashboard-plan-orb" aria-hidden="true"><Icon name="spark" size={18} /></span><div className="dashboard-plan-copy"><strong className="dashboard-plan-name">{billing ? planName(billing) : billingError ? "Chưa đọc được gói" : "Đang tải gói…"}{billing?.plan === "pro" && <span className="dashboard-plan-badge pro" aria-label="Gói Pro">✦ PRO</span>}{billing?.plan === "free" && <span className="dashboard-plan-badge free" aria-label="Gói Free">✦ FREE</span>}</strong><span>{quotaText(billing)}</span></div><Link href="/plans">Quản lý gói</Link></div><BillingNotice error={billingError} refresh={refreshBilling} /></>}
      {status !== "connected" && !preview && !isGuest && <section className="dashboard-overview-alert dashboard-engine-onboarding" aria-label="Cài phần mềm để bắt đầu xử lý video">
        <Icon name="desktop" size={24} />
        <div className="dashboard-engine-guide"><strong>Bước tiếp theo: cài Local Engine</strong><p>Bạn đã vào workspace. Để tải, Vietsub và lồng tiếng video, cần cài ứng dụng Windows xử lý trên máy của bạn.</p><ol><li>Tải bộ cài, cài đặt và mở ReupAI Local Engine.</li><li>Quay lại trang này và bấm “Đã cài · Kiểm tra kết nối”.</li><li>Vào <Link href="/settings#diagnostics">Cài đặt Gemini</Link>, kết nối Google và chọn project của bạn để bắt đầu.</li></ol><Link href="/local-engine">Xem hướng dẫn cài đặt →</Link></div>
        <div className="dashboard-engine-actions"><a className="dashboard-engine-download" href={REUPAI_MICROSOFT_STORE_URL} target="_blank" rel="noopener noreferrer">Tải Local Engine từ Microsoft Store</a><button type="button" disabled={status === "checking" || status === "authorizing"} onClick={status === "authorization_required" || status === "permission_denied" ? connect : check}>{status === "checking" || status === "authorizing" ? "Đang kiểm tra…" : status === "authorization_required" || status === "permission_denied" ? "Cấp quyền kết nối" : "Đã cài · Kiểm tra kết nối"}</button></div>
      </section>}
      {status === "connected" && jobs.length > 0 && <div className="dashboard-active-jobs">{jobs.slice(0, 2).map((job) => <div className="dashboard-active-job" key={job.id || job.job_key || `${jobVideoId(job)}-${job.mode}`}><div><strong>{jobVideoId(job)}</strong><small>{stageLabel(job.stage)} · {modeLabel(job.mode)}</small></div><span>{progressValue(job.progress)}%</span><div className="dashboard-active-track"><i style={{ width: `${progressValue(job.progress)}%` }} /></div>{ACTIVE_JOBS.has(job.status) && <button type="button" disabled={stopping === jobVideoId(job)} onClick={() => stopJob(job)}>{stopping === jobVideoId(job) ? "Đang dừng…" : "Dừng"}</button>}</div>)}{jobs.length > 2 && <Link href="/history">Xem thêm {jobs.length - 2} job →</Link>}</div>}
    </section>
    <WorkspaceAssistant client={client} connected={status === "connected"} check={check} />
    <DashboardRecentJobs client={client} items={!isGuest && status === "connected" ? data?.recent_jobs || [] : []} media={recentMedia} loading={!isGuest && status === "connected" && !data && !error} guest={isGuest} />
    <DashboardSuggestions />
    {status === "connected" && <ErrorMessage error={error} retry={load} />}
  </div>;
}
function DashboardSuggestions() {
  const links = [["/sources", "Lồng tiếng AI", "Tạo bản Voice tự nhiên", "art-0", "play"], ["/sources", "Vietsub video", "Dịch và tạo phụ đề", "art-1", "spark"], ["/sources", "Chọn giọng đọc", "Xử lý video bằng AI", "art-2", "user"], ["/outputs", "Xem thành phẩm", "Mở và tải kết quả", "art-3", "grid"]];
  return <section className="dashboard-shortcuts" aria-label="Gợi ý bắt đầu"><div className="dashboard-section-title"><h2>Có thể bạn muốn thử</h2><Link href="/sources">Xem nguồn video →</Link></div><div className="dashboard-shortcut-grid">{links.map(([href, title, description, art, icon]) => <Link className="dashboard-shortcut-card dashboard-image-card" href={href} key={art}><span className={`dashboard-feature-art ${art}`} aria-hidden="true" /><span className="dashboard-feature-marker" aria-hidden="true"><Icon name={icon} size={16} /></span><span className="dashboard-feature-copy"><strong>{title}</strong><small>{description}</small></span></Link>)}</div></section>;
}
function DashboardRecentJobs({ client, items, media, loading, guest }) {
  const cards = recentCards(items);
  return <section className="dashboard-recents" aria-label="Công việc gần đây">
    <div className="dashboard-section-title"><h2>Lịch sử gần đây</h2><Link href="/history">Xem tất cả →</Link></div>
    {loading ? <div className="dashboard-recent-grid" role="status" aria-label="Đang tải video gần đây">{[0, 1, 2, 3].map((item) => <div key={item} className="workspace-skeleton-card" aria-hidden="true"><div /><span /><span /></div>)}</div> : cards.length ? <div className="dashboard-recent-grid">{cards.map((job, index) => <Link className="dashboard-recent-card" href={sourceHrefForJob(job)} key={job.id || job.job_key || `${jobVideoId(job)}-${job.mode}-${index}`}>
      <div className={`dashboard-recent-art art-${index % 4}`}>{media[jobVideoId(job)]?.cover_url || media[jobVideoId(job)]?.previewPath ? <VideoCover client={client} video={{ ...job, ...media[jobVideoId(job)] }} previewPath={media[jobVideoId(job)]?.previewPath} /> : <Icon name={job.mode === "voiceover" ? "spark" : "play"} size={34} />}<span>{modeLabel(job.mode)}</span></div>
      <strong>{media[jobVideoId(job)]?.title || job.title || job.video_title || jobVideoId(job) || "Video của bạn"}</strong>
      <small>{stageLabel(job.stage)} · {JOB_LABELS[job.status] || job.status || "Đang chờ"}</small>
    </Link>)}</div> : <div className="dashboard-recent-empty"><span><Icon name="play" size={23} /></span><div><strong>{loading ? "Đang tải công việc…" : guest ? "Câu chuyện đầu tiên bắt đầu từ đây." : "Chưa có video gần đây"}</strong><p>{loading ? "ReupAI đang đọc dữ liệu trên máy của bạn." : guest ? "Công việc và thành phẩm sẽ xuất hiện sau khi bạn đăng nhập và xử lý video." : "Dán link video và tạo Vietsub hoặc Voice để bắt đầu."}</p></div><Link href="/sources">Tạo video đầu tiên</Link></div>}
  </section>;
}
function sourceHrefForJob(job) { return `/sources?${new URLSearchParams({ video: jobVideoId(job), mode: job.mode || "subtitle" })}`; }
