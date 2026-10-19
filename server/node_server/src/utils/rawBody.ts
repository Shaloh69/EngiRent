import type { IncomingMessage } from "http";

/**
 * express.json `verify` hook: keeps the exact request bytes for the routes
 * that check a signature over them (the payment gateway signs `${ts}.${body}`,
 * paymentController.gatewayEvent). Every other route parses as before.
 */
export const RAW_BODY_PATHS = ["/payments/gateway-event"];

export function keepRawBody(req: IncomingMessage, _res: unknown, buf: Buffer): void {
  const url = req.url ?? "";
  if (RAW_BODY_PATHS.some((p) => url.includes(p))) {
    (req as unknown as { rawBody?: string }).rawBody = buf.toString("utf8");
  }
}
