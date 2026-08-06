import { NextRequest, NextResponse } from "next/server";

// Server-side proxy so /payments/mock (see app/payments/mock/page.tsx) can
// hit the Node API's dev-only confirm/fail path without needing CORS or
// exposing the API URL to the browser. Only meaningful when the Node API
// has no PAYMONGO_SECRET_KEY configured (createPayment then hands out this
// mock checkout URL instead of a real PayMongo one) — with a real key set,
// this route is simply never reached.
const NODE_API_URL = process.env.NODE_API_URL || "http://localhost:5000/api/v1";

export async function POST(req: NextRequest) {
  const { transactionId, outcome } = await req.json();

  if (!transactionId || (outcome !== "success" && outcome !== "failure")) {
    return NextResponse.json(
      { success: false, message: "transactionId and outcome ('success'|'failure') are required" },
      { status: 400 },
    );
  }

  const body =
    outcome === "success"
      ? {
          transactionId,
          paymentId: `mock-${Date.now()}`,
          referenceNo: `MOCK-${transactionId.slice(0, 8).toUpperCase()}`,
        }
      : { transactionId, status: "FAILED" };

  const resp = await fetch(`${NODE_API_URL}/payments/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json();

  return NextResponse.json(data, { status: resp.status });
}
