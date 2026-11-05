export function planName(account) {
  if (!account?.configured) return "ReupAI";
  if (account.plan === "admin") return "ReupAI Admin";
  if (account.plan === "pro") return "ReupAI Pro";
  return account.plan === "free" ? "ReupAI Free" : "ReupAI";
}

export function quotaText(account) {
  if (!account?.configured) return "Chưa đọc được thông tin lượt xử lý";
  if (account.plan === "admin") return "Tài khoản quản trị · Không giới hạn";
  if (account.plan === "pro") return account.proUntil
    ? `Có hiệu lực đến ${new Date(account.proUntil).toLocaleDateString("vi-VN")}`
    : "Không giới hạn lượt Free";
  if (account.unlimited) return `Đã hoàn tất ${account.completed || 0} video · Không giới hạn`;
  const limit = Math.max(1, Number(account.limit || account.freeLimit || 3));
  const remaining = Math.max(0, Number(account.remaining || 0));
  return remaining === 0
    ? `Đã dùng hết ${limit} video · Nâng cấp Pro để tiếp tục`
    : `Còn ${remaining} / ${limit} video`;
}
