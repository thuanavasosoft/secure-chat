import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { getSessionTokenFromCookies } from "./auth";
import { sessionsRepo, usersRepo } from "./db";
import { logger } from "./logger";
import { createWsTokenBucket } from "./rateLimit";
import type { WsClientMessage, WsErrorMessage, WsServerMessage } from "./types";
import { validateWsMessage } from "./validate";

type AuthedWs = WebSocket & {
  userId?: number;
};

type WsContext = {
  wss: WebSocketServer;
  userSockets: Map<number, AuthedWs>;
  activePeerByUserId: Map<number, number>;
};

const sendWs = (socket: WebSocket, message: WsServerMessage): void => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
};

const sendError = (socket: WebSocket, message: WsErrorMessage): void => {
  sendWs(socket, message);
};

const broadcastPresenceUpdate = (context: WsContext, userId: number, online: boolean): void => {
  const message: WsServerMessage = { type: "presence_update", userId, online };
  context.userSockets.forEach((peerSocket) => {
    sendWs(peerSocket, message);
  });
};

const sendPresenceSnapshot = (socket: WebSocket, userSockets: Map<number, AuthedWs>): void => {
  sendWs(socket, {
    type: "presence_snapshot",
    onlineUserIds: [...userSockets.keys()]
  });
};

const clearBusyRelationship = (activePeerByUserId: Map<number, number>, userId: number): void => {
  const peerId = activePeerByUserId.get(userId);
  if (!peerId) {
    return;
  }
  activePeerByUserId.delete(userId);
  if (activePeerByUserId.get(peerId) === userId) {
    activePeerByUserId.delete(peerId);
  }
};

const relayToPeer = (
  context: WsContext,
  message: WsClientMessage,
  senderSocket: AuthedWs
): { ok: boolean; code?: WsErrorMessage["code"] } => {
  const target = context.userSockets.get(message.toUserId);
  if (!target || target.readyState !== WebSocket.OPEN) {
    sendError(senderSocket, {
      type: "error",
      code: "PEER_OFFLINE",
      message: "Target peer is offline"
    });
    return { ok: false, code: "PEER_OFFLINE" };
  }
  sendWs(target, message);
  return { ok: true };
};

const validateSender = (socket: AuthedWs, message: WsClientMessage): boolean => {
  return socket.userId === message.fromUserId;
};

const authenticateUpgrade = (req: IncomingMessage): { ok: true; userId: number } | { ok: false } => {
  const token = getSessionTokenFromCookies(req.headers.cookie);
  if (!token) {
    return { ok: false };
  }
  const session = sessionsRepo.findValidSessionByToken(token);
  if (!session) {
    return { ok: false };
  }
  const user = usersRepo.findById(session.user_id);
  if (!user) {
    return { ok: false };
  }
  return { ok: true, userId: user.id };
};

const onMessage = (context: WsContext, socket: AuthedWs, raw: Buffer): void => {
  const parsedUnknown: unknown = (() => {
    try {
      return JSON.parse(raw.toString("utf8"));
    } catch {
      return null;
    }
  })();

  const parsed = validateWsMessage(parsedUnknown);
  if (!parsed || !validateSender(socket, parsed)) {
    sendError(socket, {
      type: "error",
      code: "INVALID_PAYLOAD",
      message: "Invalid websocket payload"
    });
    return;
  }

  if (parsed.type === "call") {
    const caller = parsed.fromUserId;
    const callee = parsed.toUserId;
    const callerBusyWith = context.activePeerByUserId.get(caller);
    const calleeBusyWith = context.activePeerByUserId.get(callee);
    if ((callerBusyWith && callerBusyWith !== callee) || (calleeBusyWith && calleeBusyWith !== caller)) {
      sendError(socket, {
        type: "error",
        code: "PEER_BUSY",
        message: "Peer is busy"
      });
      return;
    }
    const relayed = relayToPeer(context, parsed, socket);
    if (relayed.ok) {
      context.activePeerByUserId.set(caller, callee);
      context.activePeerByUserId.set(callee, caller);
      logger.info("Relayed call", { fromUserId: caller, toUserId: callee });
    }
    return;
  }

  if (parsed.type === "hangup") {
    relayToPeer(context, parsed, socket);
    clearBusyRelationship(context.activePeerByUserId, parsed.fromUserId);
    return;
  }

  const sdpLen = parsed.data.sdp?.sdp.length ?? 0;
  const hasIce = parsed.data.ice !== undefined;
  logger.info("Relayed signal", {
    fromUserId: parsed.fromUserId,
    toUserId: parsed.toUserId,
    sdpLength: sdpLen,
    hasIce
  });
  relayToPeer(context, parsed, socket);
};

export const createSignalingServer = (): WsContext => {
  const wss = new WebSocketServer({ noServer: true });
  const userSockets = new Map<number, AuthedWs>();
  const activePeerByUserId = new Map<number, number>();
  const context: WsContext = { wss, userSockets, activePeerByUserId };

  wss.on("connection", (socket: AuthedWs, req) => {
    const auth = authenticateUpgrade(req);
    if (!auth.ok) {
      sendError(socket, {
        type: "error",
        code: "UNAUTHORIZED",
        message: "Unauthorized websocket"
      });
      socket.close(4401, "Unauthorized");
      return;
    }

    socket.userId = auth.userId;
    const existing = userSockets.get(auth.userId);
    if (existing && existing.readyState === WebSocket.OPEN) {
      existing.close(4000, "Replaced by newer connection");
    }
    userSockets.set(auth.userId, socket);
    const limiter = createWsTokenBucket(20, 10);
    logger.info("WS connected", { userId: auth.userId });
    sendPresenceSnapshot(socket, userSockets);
    broadcastPresenceUpdate(context, auth.userId, true);

    socket.on("message", (raw) => {
      if (!limiter.consume()) {
        sendError(socket, {
          type: "error",
          code: "RATE_LIMITED",
          message: "WS rate limit exceeded"
        });
        return;
      }
      const asBuffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw.toString());
      onMessage(context, socket, asBuffer);
    });

    socket.on("close", () => {
      if (socket.userId !== undefined) {
        if (userSockets.get(socket.userId) === socket) {
          userSockets.delete(socket.userId);
          broadcastPresenceUpdate(context, socket.userId, false);
        }
        clearBusyRelationship(activePeerByUserId, socket.userId);
        logger.info("WS disconnected", { userId: socket.userId });
      }
    });
  });

  return context;
};
