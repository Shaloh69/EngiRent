import { NextFunction, Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { ForbiddenError, ValidationError } from "../utils/errors";
import { recordAudit } from "../services/auditLogService";
import {
  adminGetConcern,
  adminListConcerns,
  concernForParty,
  confirmOwedPayment,
  createConcern,
  decideConcern,
  previewDecision,
  reportOptions,
  respondToConcern,
  submitOwedPayment,
  UploadedFile,
} from "../services/concernService";
import { ConcernKindName } from "../services/concernRules";

/** Concerns v2 — HTTP handlers. Every rule lives in concernService / concernRules. */

const KINDS: ConcernKindName[] = ["DEFECT_ON_RECEIPT", "DAMAGE_ON_RETURN", "RETURN_CHECK"];

function filesOf(req: AuthRequest): { photos: UploadedFile[]; videos: UploadedFile[] } {
  const f = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const map = (x: Express.Multer.File) => ({ buffer: x.buffer, mimetype: x.mimetype, size: x.size, originalname: x.originalname });
  return { photos: (f.photos ?? []).map(map), videos: (f.video ?? []).map(map) };
}

const me = (req: AuthRequest): string => {
  if (!req.user) throw new ForbiddenError("Authentication required");
  return req.user.userId;
};

/** GET /concerns/options/:rentalId — what the viewer may report now, and the cases on this rental. */
export const getReportOptions = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json({ success: true, data: await reportOptions(String(req.params.rentalId), me(req)) });
  } catch (error) {
    next(error);
  }
};

/** POST /concerns (multipart: rentalId, kind, statement, photos[], video) */
export const postConcern = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const kind = String(req.body.kind ?? "") as ConcernKindName;
    if (!KINDS.includes(kind)) throw new ValidationError("Choose what kind of problem you are reporting.");
    const { photos, videos } = filesOf(req);
    const c = await createConcern(req.app.get("io"), {
      userId: me(req),
      rentalId: String(req.body.rentalId ?? ""),
      kind,
      statement: String(req.body.statement ?? ""),
      photos,
      videos,
    });
    res.status(201).json({ success: true, data: c, message: `Report sent (case ${c.referenceNo}).` });
  } catch (error) {
    next(error);
  }
};

/** GET /concerns/:id — the case as one of its two students sees it. */
export const getConcern = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json({ success: true, data: await concernForParty(String(req.params.id), me(req)) });
  } catch (error) {
    next(error);
  }
};

/** POST /concerns/:id/respond (multipart: statement, photos[], video) */
export const postResponse = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { photos, videos } = filesOf(req);
    await respondToConcern(req.app.get("io"), {
      userId: me(req),
      concernId: String(req.params.id),
      statement: String(req.body.statement ?? ""),
      photos,
      videos,
    });
    res.json({ success: true, message: "Your answer was sent. An admin now decides." });
  } catch (error) {
    next(error);
  }
};

/** POST /concerns/:id/pay { reference } — the renter sent what they owe. */
export const postPayment = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await submitOwedPayment(req.app.get("io"), String(req.params.id), me(req), String(req.body.reference ?? ""));
    res.json({ success: true, message: "Payment sent for staff to confirm." });
  } catch (error) {
    next(error);
  }
};

// ── admin ───────────────────────────────────────────────────────────────────

export const adminConcerns = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const filter = String(req.query.filter ?? "open");
    res.json({
      success: true,
      data: { concerns: await adminListConcerns(filter === "decided" || filter === "all" ? filter : "open") },
    });
  } catch (error) {
    next(error);
  }
};

export const adminConcern = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json({ success: true, data: await adminGetConcern(String(req.params.id)) });
  } catch (error) {
    next(error);
  }
};

export const adminPreview = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const pct = Number(req.body.pct);
    const assessed = req.body.assessedAmount == null ? null : Number(req.body.assessedAmount);
    res.json({ success: true, data: await previewDecision(String(req.params.id), pct, assessed) });
  } catch (error) {
    next(error);
  }
};

export const adminDecide = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const pct = Number(req.body.pct);
    const assessed = req.body.assessedAmount == null ? null : Number(req.body.assessedAmount);
    await decideConcern(req.app.get("io"), id, me(req), { pct, assessedAmount: assessed, note: String(req.body.note ?? "") });
    await recordAudit(req, {
      action: "concern.decide",
      targetType: "concern",
      targetId: id,
      reason: String(req.body.note ?? ""),
      metadata: { pct, assessedAmount: assessed },
    });
    res.json({ success: true, message: "Decided. Both students have been told." });
  } catch (error) {
    next(error);
  }
};

export const adminConfirmPayment = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    await confirmOwedPayment(req.app.get("io"), id, me(req));
    await recordAudit(req, { action: "concern.payment_confirm", targetType: "concern", targetId: id });
    res.json({ success: true, message: "Payment confirmed. The renter's account limit is lifted." });
  } catch (error) {
    next(error);
  }
};
