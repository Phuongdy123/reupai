import { NextResponse } from 'next/server';
import document from '../../../../src/lib/engine-release.json';
import { verifiedRelease } from '../../../../src/lib/engine-release';

export const dynamic = 'force-dynamic';
export function GET() {
  try {
    const release = verifiedRelease(document);
    return NextResponse.redirect(release.downloadUrl, { status: 307, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Bộ cài đang được chuẩn bị. Vui lòng thử lại sau.' }, { status: 503 });
  }
}
