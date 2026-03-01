import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  AttachmentRecord,
  ConversationRecord,
  MessageRecord,
  PublicUser,
  SessionRecord,
  UserRecord
} from "./types";

const DB_PATH = process.env.DB_PATH ?? path.resolve(process.cwd(), "data.sqlite");
const candidateSchemaPaths = [
  path.resolve(__dirname, "schema.sql"),
  path.resolve(__dirname, "../src/schema.sql"),
  path.resolve(process.cwd(), "src/schema.sql")
];
const SCHEMA_PATH = candidateSchemaPaths.find((candidate) => fs.existsSync(candidate));
if (!SCHEMA_PATH) {
  throw new Error("Could not locate schema.sql");
}
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

const schemaSql = fs.readFileSync(SCHEMA_PATH, "utf8");
db.exec(schemaSql);

const toPublicUser = (row: { id: number; username: string; created_at: string }): PublicUser => ({
  id: row.id,
  username: row.username,
  createdAt: row.created_at
});

export const getDbPath = (): string => DB_PATH;

export const usersRepo = {
  createUser(username: string, passwordHash: string): PublicUser {
    const stmt = db.prepare(
      "INSERT INTO users (username, password_hash) VALUES (?, ?) RETURNING id, username, created_at"
    );
    const row = stmt.get(username, passwordHash) as { id: number; username: string; created_at: string };
    return toPublicUser(row);
  },

  findByUsername(username: string): UserRecord | undefined {
    const stmt = db.prepare(
      "SELECT id, username, password_hash, created_at FROM users WHERE username = ? LIMIT 1"
    );
    return stmt.get(username) as UserRecord | undefined;
  },

  updatePasswordHash(id: number, passwordHash: string): void {
    const stmt = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?");
    stmt.run(passwordHash, id);
  },

  findById(id: number): PublicUser | undefined {
    const stmt = db.prepare("SELECT id, username, created_at FROM users WHERE id = ? LIMIT 1");
    const row = stmt.get(id) as { id: number; username: string; created_at: string } | undefined;
    return row ? toPublicUser(row) : undefined;
  },

  searchUsers(query: string, excludeUserId: number, limit = 10): PublicUser[] {
    const normalized = `%${query.toLowerCase()}%`;
    const stmt = db.prepare(
      `SELECT id, username, created_at
       FROM users
       WHERE id != ? AND lower(username) LIKE ?
       ORDER BY username ASC
       LIMIT ?`
    );
    const rows = stmt.all(excludeUserId, normalized, limit) as Array<{
      id: number;
      username: string;
      created_at: string;
    }>;
    return rows.map(toPublicUser);
  },

  listUsers(excludeUserId: number): PublicUser[] {
    const stmt = db.prepare(
      `SELECT id, username, created_at
       FROM users
       WHERE id != ?
       ORDER BY username ASC`
    );
    const rows = stmt.all(excludeUserId) as Array<{
      id: number;
      username: string;
      created_at: string;
    }>;
    return rows.map(toPublicUser);
  }
};

const expiryIsoFromNow = (): string => new Date(Date.now() + SESSION_TTL_MS).toISOString();

export const sessionsRepo = {
  createSession(userId: number, token: string): SessionRecord {
    const stmt = db.prepare(
      `INSERT INTO sessions (user_id, token, expires_at)
       VALUES (?, ?, ?)
       RETURNING id, user_id, token, expires_at, created_at`
    );
    return stmt.get(userId, token, expiryIsoFromNow()) as SessionRecord;
  },

  deleteSession(token: string): void {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  },

  deleteExpiredSessions(): void {
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
  },

  findValidSessionByToken(token: string): SessionRecord | undefined {
    this.deleteExpiredSessions();
    const stmt = db.prepare(
      `SELECT id, user_id, token, expires_at, created_at
       FROM sessions
       WHERE token = ? AND expires_at > ?
       LIMIT 1`
    );
    return stmt.get(token, new Date().toISOString()) as SessionRecord | undefined;
  }
};

const sortPair = (a: number, b: number): [number, number] => {
  return a < b ? [a, b] : [b, a];
};

export const conversationsRepo = {
  getOrCreateConversationId(userA: number, userB: number): number {
    const [u1, u2] = sortPair(userA, userB);
    const insertStmt = db.prepare(
      `INSERT INTO conversations (user1_id, user2_id)
       VALUES (?, ?)
       ON CONFLICT(user1_id, user2_id) DO NOTHING`
    );
    insertStmt.run(u1, u2);
    const selectStmt = db.prepare(
      `SELECT id FROM conversations WHERE user1_id = ? AND user2_id = ? LIMIT 1`
    );
    const row = selectStmt.get(u1, u2) as { id: number };
    return row.id;
  },

  findConversation(userA: number, userB: number): ConversationRecord | undefined {
    const [u1, u2] = sortPair(userA, userB);
    const stmt = db.prepare(
      `SELECT id, user1_id, user2_id, created_at
       FROM conversations
       WHERE user1_id = ? AND user2_id = ?
       LIMIT 1`
    );
    return stmt.get(u1, u2) as ConversationRecord | undefined;
  }
};

export const messagesRepo = {
  createMessage(conversationId: number, senderId: number, body: string, sentAt?: string): MessageRecord {
    const effectiveSentAt = sentAt ?? new Date().toISOString();
    const stmt = db.prepare(
      `INSERT INTO messages (conversation_id, sender_id, body, sent_at)
       VALUES (?, ?, ?, ?)
       RETURNING id, conversation_id, sender_id, body, sent_at`
    );
    return stmt.get(conversationId, senderId, body, effectiveSentAt) as MessageRecord;
  },

  getRecentMessages(
    conversationId: number,
    limit = 100
  ): Array<
    MessageRecord & {
      attachment_id: number | null;
      attachment_original_name: string | null;
      attachment_mime_type: string | null;
      attachment_size_bytes: number | null;
    }
  > {
    const stmt = db.prepare(
      `SELECT
         m.id,
         m.conversation_id,
         m.sender_id,
         m.body,
         m.sent_at,
         a.id AS attachment_id,
         a.original_name AS attachment_original_name,
         a.mime_type AS attachment_mime_type,
         a.size_bytes AS attachment_size_bytes
       FROM messages m
       LEFT JOIN attachments a ON a.message_id = m.id
       WHERE conversation_id = ?
       ORDER BY m.sent_at DESC
       LIMIT ?`
    );
    const rows = stmt.all(conversationId, limit) as Array<
      MessageRecord & {
        attachment_id: number | null;
        attachment_original_name: string | null;
        attachment_mime_type: string | null;
        attachment_size_bytes: number | null;
      }
    >;
    return rows.reverse();
  }
};

type AuthorizedAttachmentRecord = AttachmentRecord & {
  conversation_id: number;
};

export const attachmentsRepo = {
  createAttachment(
    messageId: number,
    uploaderId: number,
    storedName: string,
    storedPath: string,
    originalName: string,
    mimeType: string,
    sizeBytes: number
  ): AttachmentRecord {
    const stmt = db.prepare(
      `INSERT INTO attachments (
         message_id,
         uploader_id,
         stored_name,
         stored_path,
         original_name,
         mime_type,
         size_bytes
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING
         id,
         message_id,
         uploader_id,
         stored_name,
         stored_path,
         original_name,
         mime_type,
         size_bytes,
         created_at`
    );
    return stmt.get(
      messageId,
      uploaderId,
      storedName,
      storedPath,
      originalName,
      mimeType,
      sizeBytes
    ) as AttachmentRecord;
  },

  findByIdForUser(attachmentId: number, userId: number): AuthorizedAttachmentRecord | undefined {
    const stmt = db.prepare(
      `SELECT
         a.id,
         a.message_id,
         a.uploader_id,
         a.stored_name,
         a.stored_path,
         a.original_name,
         a.mime_type,
         a.size_bytes,
         a.created_at,
         m.conversation_id
       FROM attachments a
       JOIN messages m ON m.id = a.message_id
       JOIN conversations c ON c.id = m.conversation_id
       WHERE a.id = ?
         AND (c.user1_id = ? OR c.user2_id = ?)
       LIMIT 1`
    );
    return stmt.get(attachmentId, userId, userId) as AuthorizedAttachmentRecord | undefined;
  }
};
