import { listCustomerFeedback, updateCustomerFeedback, FeedbackError } from '../../../../src/lib/customer-feedback';
import { requireFeedbackAccount, feedbackRequestBody, feedbackErrorResponse } from '../../../../src/lib/customer-feedback-server';

export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    const { storage } = await requireFeedbackAccount(true);
    const offset = Number(new URL(request.url).searchParams.get('offset') || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) throw new FeedbackError('Trang không hợp lệ.', 400);
    return Response.json(await listCustomerFeedback(storage, offset), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return feedbackErrorResponse(error); }
}
export async function PATCH(request) {
  try {
    const { storage } = await requireFeedbackAccount(true);
    const body = await feedbackRequestBody(request);
    return Response.json({ item: await updateCustomerFeedback(storage, body?.id, body?.status) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return feedbackErrorResponse(error); }
}
