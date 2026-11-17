export function planName(account) {
  if (!account?.configured) return "ReupAI";
  if (account.plan === "admin") return "ReupAI Admin";
  if (account.plan === "pro") return "ReupAI Pro";
  return account.plan === "free" ? "ReupAI Free" : "ReupAI";
}

export function quotaText(account) {
  if (!account?.configured) return "Chưa đọc được thông tin lượt xử lý";
  if (account.plan === "admin") return "Tài khoản quản trị · Không giới hạn";
  if (account.plan === "pro") {
    if (!account.proUntil) return "Không giới hạn lượt Free";
    const parsed = new Date(account.proUntil);
    if (Number.isFinite(parsed.getTime()) && parsed.getUTCFullYear() >= 2090) {
      return "Gói Pro vĩnh viễn · Không giới hạn";
    }
    return `Có hiệu lực đến ${parsed.toLocaleDateString("vi-VN")}`;
  }
  if (account.unlimited) return `Đã hoàn tất ${account.completed || 0} video · Không giới hạn`;
  const limit = Math.max(1, Number(account.limit || account.freeLimit || 3));
  const remaining = Math.max(0, Number(account.remaining || 0));
  return remaining === 0
    ? `Đã dùng hết ${limit} video · Nâng cấp Pro để tiếp tục`
    : `Còn ${remaining} / ${limit} video`;
}
