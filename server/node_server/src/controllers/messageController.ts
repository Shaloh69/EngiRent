import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth";
import prisma from "../config/database";
import { ForbiddenError, NotFoundError, ValidationError } from "../utils/errors";
import logger from "../utils/logger";

/**
 * Checklist Stage 5 — in-app messaging, scoped one-to-one with a rental.
 *
 * Before this a renter with a question for the owner (or the reverse) had no
 * route to reach them inside the app at all, and a dispute had no
 * conversation history to adjudicate — only whatever screenshots either side
 * happened to bring, if any. One Conversation per rental, not a general DM
 * system: the mandate ranks this above nicer chat features specifically
 * because of the dispute-transcript need, not because messaging itself was
 * the goal.
 */

async function assertParticipant(rentalId: string, userId: string) {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    select: { id: true, renterId: true, ownerId: true },
  });
  if (!rental) throw new NotFoundError("Rental not found");
  if (rental.renterId !== userId && rental.ownerId !== userId) {
    throw new ForbiddenError("You are not a participant in this rental");
  }
  return rental;
}

/**
 * GET /rentals/:id/conversation
 * Gets or lazily creates the conversation for this rental, and returns every
 * message. Lazy creation (rather than one made at booking time) means a
 * rental nobody ever messaged about never leaves an empty row behind.
 */
export const getConversation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");
    const rentalId = String(req.params.id);
    const rental = await assertParticipant(rentalId, req.user.userId);

    const conversation = await prisma.conversation.upsert({
      where: { rentalId },
      update: {},
      create: { rentalId },
    });

    // Mark the other participant's messages read now that this participant
    // has opened the thread — a simple "seen" model, not per-message read
    // receipts, which this scope doesn't need. Done *before* the messages
    // are fetched below: doing it after would still leave the response
    // reflecting the pre-update state, since Prisma's own `include` on the
    // upsert above runs at upsert time, not at response time — the caller
    // that had just marked something read would see readAt: null in the very
    // same response that changed it.
    await prisma.message.updateMany({
      where: {
        conversationId: conversation.id,
        senderId: { not: req.user.userId },
        readAt: null,
      },
      data: { readAt: new Date() },
    });

    const messages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
      },
    });

    res.json({
      success: true,
      data: {
        conversationId: conversation.id,
        otherParticipantId: rental.renterId === req.user.userId ? rental.ownerId : rental.renterId,
        messages,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /rentals/:id/conversation/messages
 * Persists the message, then delivers it in real time over the socket room
 * the recipient is already listening on for every other rental event
 * (`user:{id}` — see index.ts) — reusing the existing per-user room rather
 * than inventing a per-conversation one, since a participant is only ever
 * in one conversation at a time here (one conversation per rental).
 */
export const sendMessage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) throw new ForbiddenError("Authentication required");
    const rentalId = String(req.params.id);
    const { body } = req.body as { body?: string };

    if (!body || !body.trim()) {
      throw new ValidationError("Message body is required");
    }
    if (body.trim().length > 2000) {
      throw new ValidationError("Message is too long (max 2000 characters)");
    }

    const rental = await assertParticipant(rentalId, req.user.userId);
    const recipientId = rental.renterId === req.user.userId ? rental.ownerId : rental.renterId;

    const conversation = await prisma.conversation.upsert({
      where: { rentalId },
      update: {},
      create: { rentalId },
    });

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: req.user.userId,
        body: body.trim(),
      },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    const io = req.app.get("io");
    if (io) {
      io.to(`user:${recipientId}`).emit("message:new", {
        rentalId,
        conversationId: conversation.id,
        message,
      });
    }

    // A message is exactly the kind of thing a student wants pushed to them
    // even if the app isn't open — reuses the same notification model every
    // other rental event already goes through.
    await prisma.notification.create({
      data: {
        userId: recipientId,
        title: `New message from ${message.sender.firstName}`,
        message: body.trim().length > 80 ? `${body.trim().slice(0, 77)}...` : body.trim(),
        type: "SYSTEM_ANNOUNCEMENT",
        relatedEntityId: rentalId,
        relatedEntityType: "rental",
      },
    });

    logger.info(`Message sent on rental ${rentalId} by ${req.user.userId}`);

    res.status(201).json({ success: true, data: { message } });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /admin/rentals/:id/conversation
 * The whole reason this ranks above a general chat feature: a dispute needs
 * the transcript. Admin-only, read-only, no participant restriction — an
 * admin reviewing a dispute is not one of the two people in it.
 */
export const getConversationForAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const rentalId = String(req.params.id);
    const rental = await prisma.rental.findUnique({ where: { id: rentalId } });
    if (!rental) throw new NotFoundError("Rental not found");

    const conversation = await prisma.conversation.findUnique({
      where: { rentalId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          include: {
            sender: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });

    res.json({
      success: true,
      data: { messages: conversation?.messages ?? [] },
    });
  } catch (error) {
    next(error);
  }
};
