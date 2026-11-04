"use client";

import { useCallback, useEffect, useState } from "react";
import { sendFeedback } from "./feedback-provider";

const labels = { pending: "Chờ duyệt", approved: "Đã duyệt", disabled: "Đã khóa" };

function draftFor(user) {
  return { limit: String(user.quota?.limit || 3), unlimited: Boolean(user.quota?.unlimited) };
}

export function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không thể tải danh sách tài khoản.");
      const items = data.users || [];
      setUsers(items);
      setDrafts(Object.fromEntries(items.map((user) => [user.id, draftFor(user)])));
    } catch (caught) { setError(caught.message || "Không thể tải danh sách tài khoản."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (error) sendFeedback("error", error); }, [error]);

  async function patchUser(id, payload, success) {
    setBusyId(id); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...payload }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không thể cập nhật tài khoản.");
      setUsers((items) => items.map((item) => item.id === id ? data.user : item));
      setDrafts((values) => ({ ...values, [id]: draftFor(data.user) }));
      setNotice(success);
    } catch (caught) { setError(caught.message || "Không thể cập nhật tài khoản."); }
    finally { setBusyId(""); }
  }

  const setDraft = (id, value) => setDrafts((items) => ({ ...items, [id]: { ...(items[id] || { limit: "3", unlimited: false }), ...value } }));

  return <div className="admin-users-page">
    <div className="native-toolbar"><div><h2>Quản trị tài khoản</h2><p>Duyệt tài khoản, đặt quota từ 1 lượt đến không giới hạn và đặt lại lượt đã dùng.</p></div><button className="local-engine-action" onClick={load} disabled={loading}>Làm mới</button></div>
    {error && <div className="native-error" role="alert">{error}</div>}
    {notice && <div className="native-success" role="status">{notice}</div>}
    {loading ? <div className="native-loading">Đang tải tài khoản…</div> : users.length === 0 ? <div className="native-empty"><h3>Chưa có tài khoản</h3><p>Người dùng đăng ký sẽ xuất hiện tại đây sau khi xác minh email.</p></div> : <div className="admin-user-list">
      {users.map((user) => {
        const draft = drafts[user.id] || draftFor(user);
        const quota = user.quota || { completed: 0, limit: 3, remaining: 3, unlimited: false };
        const busy = busyId === user.id;
        return <article className="admin-user" key={user.id}>
          <div className="admin-user-identity"><strong>{user.display_name || "Chưa đặt tên"}</strong><p>@{user.username || "chưa đặt username"} · {user.email}</p><small>Đăng ký {new Date(user.created_at).toLocaleString("vi-VN")}</small></div>
          {user.role !== "admin" && <div className="admin-quota-panel">
            <div className="admin-quota-summary"><strong>{quota.unlimited ? "Không giới hạn" : `${quota.remaining} lượt còn lại`}</strong><span>Đã hoàn tất {quota.completed}{quota.unlimited ? " video" : ` / ${quota.limit} video`}</span></div>
            <label className="admin-quota-unlimited"><input type="checkbox" checked={draft.unlimited} disabled={busy} onChange={(event) => setDraft(user.id, { unlimited: event.target.checked })} /> Không giới hạn</label>
            <label className="admin-quota-limit">Giới hạn<input type="number" min="1" max="1000000" step="1" value={draft.limit} disabled={busy || draft.unlimited} onChange={(event) => setDraft(user.id, { limit: event.target.value })} /></label>
            <button className="local-engine-action" disabled={busy} onClick={() => patchUser(user.id, draft.unlimited ? { quotaUnlimited: true } : { freeLimit: Number(draft.limit) }, "Đã lưu giới hạn tài khoản.")}>Lưu giới hạn</button>
            <button className="local-engine-action" disabled={busy || quota.completed === 0} onClick={() => patchUser(user.id, { resetUsage: true }, "Đã đặt lượt đã dùng về 0.")}>Đặt lại lượt dùng</button>
          </div>}
          <div className="admin-user-actions"><span className={`account-status ${user.status}`}>{labels[user.status] || user.status}</span>{user.role === "admin" ? <span className="account-role">Admin · Không giới hạn</span> : <><button className="local-engine-action" disabled={busy || user.status === "approved"} onClick={() => patchUser(user.id, { status: "approved" }, "Đã duyệt tài khoản.")}>Duyệt</button><button className="local-engine-action danger" disabled={busy || user.status === "disabled"} onClick={() => patchUser(user.id, { status: "disabled" }, "Đã khóa tài khoản.")}>Khóa</button></>}</div>
        </article>;
      })}
    </div>}
  </div>;
}
