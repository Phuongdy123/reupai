import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const text = String(body?.text || "1 2 3, xin chào! Tôi là bình luận viên AI của bạn.").trim().slice(0, 200);
    if (!text) {
      return NextResponse.json({ error: "Thiếu nội dung đọc thử." }, { status: 400 });
    }
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=vi&q=${encodeURIComponent(text)}`;
    const upstream = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: "Dịch vụ đọc thử tạm bận." }, { status: 502 });
    }
    const buf = await upstream.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Không thể tạo âm thanh nghe thử." }, { status: 500 });
  }
}
