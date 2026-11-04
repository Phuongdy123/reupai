import { PlansPage } from "../../src/components/plans-page";

export const metadata = {
  title: "Bảng giá ReupAI Free và Pro | Gói Vietsub AI",
  description: "Xem giá ReupAI Free và Pro: dùng thử Vietsub AI, dịch video và lồng tiếng AI. So sánh quyền lợi gói và đăng ký ReupAI Pro.",
  alternates: { canonical: "/plans" },
  robots: { index: true, follow: true },
};

export default function Page() { return <PlansPage />; }
