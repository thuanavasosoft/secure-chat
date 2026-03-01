import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import multer from "multer";
import { buildAuthRouter, loadSessionUser, requireAuth } from "./auth";
import { attachmentsRepo, conversationsRepo, getDbPath, messagesRepo, usersRepo } from "./db";
import { logger } from "./logger";
import { createRestRateLimit } from "./rateLimit";
import type { AuthenticatedRequest } from "./types";
import {
  isUploadFileAllowed,
  validatePartnerUserIdQuery,
  validatePartnerUserIdRaw,
  validatePersistMessageBody
} from "./validate";
import { createSignalingServer } from "./ws";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
const MAX_UPLOAD_FILE_SIZE_BYTES = Number.parseInt(process.env.MAX_UPLOAD_FILE_SIZE_BYTES ?? "10485760", 10);

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const parsed = path.parse(file.originalname);
      const extension = parsed.ext.toLowerCase();
      const generated = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${extension}`;
      cb(null, generated);
    }
  }),
  limits: {
    files: 1,
    fileSize: MAX_UPLOAD_FILE_SIZE_BYTES
  },
  fileFilter: (_req, file, cb) => {
    if (isUploadFileAllowed(file.originalname, file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error("INVALID_FILE_TYPE"));
  }
});

const app = express();
app.set("trust proxy", 1);
app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: true
  })
);
app.use(cookieParser());
app.use(express.json({ limit: "100kb" }));
app.use(createRestRateLimit(120, 60_000));
app.use(loadSessionUser);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api", buildAuthRouter());

app.get("/api/users", requireAuth, (req: AuthenticatedRequest, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length === 0) {
    res.json({ users: usersRepo.listUsers(req.user!.id) });
    return;
  }
  const users = usersRepo.searchUsers(q, req.user!.id);
  res.json({ users });
});

app.get("/api/history", requireAuth, (req: AuthenticatedRequest, res) => {
  const partnerUserId = validatePartnerUserIdQuery(req.query.partnerUserId);
  if (!partnerUserId) {
    res.status(400).json({ error: "Invalid partnerUserId" });
    return;
  }
  const partner = usersRepo.findById(partnerUserId);
  if (!partner) {
    res.status(404).json({ error: "Partner user not found" });
    return;
  }
  const conversation = conversationsRepo.findConversation(req.user!.id, partnerUserId);
  if (!conversation) {
    res.json({ conversationId: null, messages: [] });
    return;
  }
  const messages = messagesRepo.getRecentMessages(conversation.id, 200);
  res.json({
    conversationId: conversation.id,
    messages: messages.map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      body: m.body,
      sentAt: m.sent_at,
      attachment:
        m.attachment_id === null
          ? null
          : {
              id: m.attachment_id,
              originalName: m.attachment_original_name!,
              mimeType: m.attachment_mime_type!,
              sizeBytes: m.attachment_size_bytes!
            }
    }))
  });
});

app.post("/api/messages", requireAuth, (req: AuthenticatedRequest, res) => {
  const parsed = validatePersistMessageBody(req.body);
  if (!parsed) {
    res.status(400).json({ error: "Invalid message payload" });
    return;
  }
  const partner = usersRepo.findById(parsed.partnerUserId);
  if (!partner) {
    res.status(404).json({ error: "Partner user not found" });
    return;
  }
  const conversationId = conversationsRepo.getOrCreateConversationId(req.user!.id, parsed.partnerUserId);
  const created = messagesRepo.createMessage(conversationId, req.user!.id, parsed.body, parsed.sentAtClient);
  res.status(201).json({
    message: {
      id: created.id,
      conversationId: created.conversation_id,
      senderId: created.sender_id,
      body: created.body,
      sentAt: created.sent_at,
      attachment: null
    }
  });
});

app.post("/api/attachments", requireAuth, (req: AuthenticatedRequest, res) => {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "File is too large" });
        return;
      }
      res.status(400).json({ error: "Invalid upload request" });
      return;
    }
    if (err) {
      res.status(400).json({ error: "Invalid file type. Allowed: .pdf, .docx, .xlsx, .json, .csv" });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Missing file" });
      return;
    }
    const cleanupUploadedFile = (): void => {
      fs.rm(file.path, { force: true }, () => undefined);
    };

    const partnerUserId = validatePartnerUserIdRaw(req.body?.partnerUserId);
    if (!partnerUserId) {
      cleanupUploadedFile();
      res.status(400).json({ error: "Invalid partnerUserId" });
      return;
    }
    const partner = usersRepo.findById(partnerUserId);
    if (!partner) {
      cleanupUploadedFile();
      res.status(404).json({ error: "Partner user not found" });
      return;
    }

    if (!isUploadFileAllowed(file.originalname, file.mimetype)) {
      cleanupUploadedFile();
      res.status(400).json({ error: "Invalid file type. Allowed: .pdf, .docx, .xlsx, .json, .csv" });
      return;
    }

    try {
      const conversationId = conversationsRepo.getOrCreateConversationId(req.user!.id, partnerUserId);
      const createdMessage = messagesRepo.createMessage(
        conversationId,
        req.user!.id,
        `[FILE] ${file.originalname}`
      );
      const attachment = attachmentsRepo.createAttachment(
        createdMessage.id,
        req.user!.id,
        file.filename,
        path.relative(process.cwd(), file.path),
        file.originalname,
        file.mimetype,
        file.size
      );

      res.status(201).json({
        message: {
          id: createdMessage.id,
          conversationId: createdMessage.conversation_id,
          senderId: createdMessage.sender_id,
          body: createdMessage.body,
          sentAt: createdMessage.sent_at,
          attachment: {
            id: attachment.id,
            originalName: attachment.original_name,
            mimeType: attachment.mime_type,
            sizeBytes: attachment.size_bytes
          }
        }
      });
    } catch (error) {
      cleanupUploadedFile();
      logger.error("Failed to persist uploaded attachment", {
        error: error instanceof Error ? error.message : String(error),
        userId: req.user?.id
      });
      res.status(500).json({ error: "Failed to store attachment" });
    }
  });
});

app.get("/api/attachments/:attachmentId/download", requireAuth, (req: AuthenticatedRequest, res) => {
  const attachmentId = Number.parseInt(req.params.attachmentId, 10);
  if (!Number.isInteger(attachmentId) || attachmentId <= 0) {
    res.status(400).json({ error: "Invalid attachment id" });
    return;
  }

  const attachment = attachmentsRepo.findByIdForUser(attachmentId, req.user!.id);
  if (!attachment) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }

  const absolutePath = path.resolve(process.cwd(), attachment.stored_path);
  if (!fs.existsSync(absolutePath)) {
    res.status(404).json({ error: "Attachment file is missing" });
    return;
  }

  const safeFallbackName = attachment.original_name.replace(/[^\x20-\x7E]+/g, "_").replace(/"/g, "");
  const encodedFilename = encodeURIComponent(attachment.original_name);
  res.setHeader("Content-Type", attachment.mime_type);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${safeFallbackName}"; filename*=UTF-8''${encodedFilename}`
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(absolutePath);
});

const httpServer = http.createServer(app);
const signaling = createSignalingServer();

httpServer.on("upgrade", (req, socket, head) => {
  if (req.url !== "/ws") {
    socket.destroy();
    return;
  }
  signaling.wss.handleUpgrade(req, socket, head, (ws) => {
    signaling.wss.emit("connection", ws, req);
  });
});

httpServer.listen(PORT, () => {
  logger.info("Server started", {
    port: PORT,
    dbPath: getDbPath(),
    clientOrigin: CLIENT_ORIGIN
  });
});
