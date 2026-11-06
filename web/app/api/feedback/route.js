import { submitCustomerFeedback } from '../../../src/lib/customer-feedback';
import { requireFeedbackAccount, feedbackRequestBody, feedbackErrorResponse } from '../../../src/lib/customer-feedback-server';

export const dynamic = 'force-dynamic';
export async function POST(request) {
  try {
    const account = await requireFeedbackAccount();
    const input = await feedbackRequestBody(request);
    const receipt = await submitCustomerFeedback(account.storage, account.user, account.profile, input);
    return Response.json({ ...receipt, message: 'Đã gửi phản hồi đến đội ngũ ReupAI.' }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return feedbackErrorResponse(error); }
}
