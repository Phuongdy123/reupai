"use client";

import { useCallback, useEffect, useState } from "react";

const labels = { pending: "Chờ duyệt", approved: "Đã duyệt", disabled: "Đã khóa" };

export function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không thể tải danh sách tài khoản.");
      setUsers(data.users || []);
    } catch (caught) { setError(caught.message || "Không thể tải danh sách tài khoản."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  async function setStatus(id, status) {
    setBusyId(id); setError("");
    try {
      const response = await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không thể cập nhật quyền.");
      setUsers((items) => items.map((item) => item.id === id ? data.user : item));
    } catch (caught) { setError(caught.message || "Không thể cập nhật quyền."); }
    finally { setBusyId(""); }
  }
  return <div className="admin-users-page"><div className="native-toolbar"><div><h2>Quản trị tài khoản</h2><p>Phê duyệt hoặc khóa quyền truy cập Reup AI Workspace.</p></div><button className="local-engine-action" onClick={load} disabled={loading}>Làm mới</button></div>{error && <div className="native-error">{error}</div>}{loading ? <div className="native-loading">Đang tải tài khoản…</div> : users.length === 0 ? <div className="native-empty"><h3>Chưa có tài khoản</h3><p>Người dùng đăng ký sẽ xuất hiện tại đây sau khi xác minh email.</p></div> : <div className="admin-user-list">{users.map((user) => <article className="admin-user" key={user.id}><div><strong>{user.display_name || "Chưa đặt tên"}</strong><p>{user.email}</p><small>Đăng ký {new Date(user.created_at).toLocaleString("vi-VN")}</small></div><div className="admin-user-actions"><span className={`account-status ${user.status}`}>{labels[user.status] || user.status}</span>{user.role === "admin" ? <span className="account-role">Admin</span> : <><button className="local-engine-action" disabled={busyId === user.id || user.status === "approved"} onClick={() => setStatus(user.id, "approved")}>Duyệt</button><button className="local-engine-action danger" disabled={busyId === user.id || user.status === "disabled"} onClick={() => setStatus(user.id, "disabled")}>Khóa</button></>}</div></article>)}</div>}</div>;
}
