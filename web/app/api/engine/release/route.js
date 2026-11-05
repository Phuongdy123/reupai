import { NextResponse } from 'next/server';
import document from '../../../../src/lib/engine-release.json';
import { verifiedRelease } from '../../../../src/lib/engine-release';

export const dynamic = 'force-dynamic';
export function GET() {
  if (document.available === false) return NextResponse.json({ available: false });
  try {
    verifiedRelease(document);
    return NextResponse.json(document, { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' } });
  } catch {
    return NextResponse.json({ available: false, error: 'Chưa xác minh được bản phát hành.' }, { status: 503 });
  }
}
