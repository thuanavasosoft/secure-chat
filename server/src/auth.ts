import crypto from "node:crypto";
import bcrypt from "bcrypt";
import express, { type RequestHandler } from "express";
import type { Response } from "express";
import { sessionsRepo, usersRepo } from "./db";
import type { AuthenticatedRequest, PublicUser } from "./types";
import { validateCredentials } from "./validate";

const BCRYPT_ROUNDS = 12;
const SESSION_COOKIE = "sid";
const SESSION_BYTES = 32;
const FIXED_ACCOUNT_ENV_KEYS = [
  "CHAT_USER1_USERNAME",
  "CHAT_USER1_PASSWORD",
  "CHAT_USER2_USERNAME",
  "CHAT_USER2_PASSWORD"
] as const;

type FixedAccount = {
  username: string;
  password: string;
};

const getFixedAccountsFromEnv = (): [FixedAccount, FixedAccount] => {
  const env = process.env;
  for (const key of FIXED_ACCOUNT_ENV_KEYS) {
    if (!env[key] || env[key]!.trim().length === 0) {
      throw new Error(`Missing required env variable: ${key}`);
    }
  }
  const account1: FixedAccount = {
    username: env.CHAT_USER1_USERNAME!.trim(),
    password: env.CHAT_USER1_PASSWORD!
  };
  const account2: FixedAccount = {
    username: env.CHAT_USER2_USERNAME!.trim(),
    password: env.CHAT_USER2_PASSWORD!
  };
  if (account1.username === account2.username) {
    throw new Error("CHAT_USER1_USERNAME and CHAT_USER2_USERNAME must be different");
  }
  return [account1, account2];
};

const ensureFixedUsers = async (): Promise<FixedAccount[]> => {
  const accounts = getFixedAccountsFromEnv();
  for (const account of accounts) {
    const existing = usersRepo.findByUsername(account.username);
    if (!existing) {
      const passwordHash = await bcrypt.hash(account.password, BCRYPT_ROUNDS);
      usersRepo.createUser(account.username, passwordHash);
      continue;
    }
    const alreadyMatches = await bcrypt.compare(account.password, existing.password_hash);
    if (!alreadyMatches) {
      const passwordHash = await bcrypt.hash(account.password, BCRYPT_ROUNDS);
      usersRepo.updatePasswordHash(existing.id, passwordHash);
    }
  }
  return accounts;
};

const toSafeUser = (user: PublicUser): { id: number; username: string; createdAt: string } => ({
  id: user.id,
  username: user.username,
  createdAt: user.createdAt
});

const setSessionCookie = (res: Response, token: string): void => {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
};

export const getSessionTokenFromCookies = (cookieHeader: string | undefined): string | null => {
  if (!cookieHeader) {
    return null;
  }
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const part of parts) {
    const [key, ...rest] = part.split("=");
    if (key === SESSION_COOKIE && rest.length > 0) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
};

export const loadSessionUser: RequestHandler = (req: AuthenticatedRequest, _res, next) => {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) {
    next();
    return;
  }
  const session = sessionsRepo.findValidSessionByToken(token);
  if (!session) {
    next();
    return;
  }
  const user = usersRepo.findById(session.user_id);
  if (!user) {
    next();
    return;
  }
  req.user = { id: user.id, username: user.username };
  next();
};

export const requireAuth: RequestHandler = (req: AuthenticatedRequest, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
    return;
  }
  next();
};

export const buildAuthRouter = (): express.Router => {
  const router = express.Router();
  const fixedAccountsPromise = ensureFixedUsers();

  router.post("/register", async (_req, res) => {
    await fixedAccountsPromise;
    res.status(403).json({ error: "Registration is disabled. Use configured accounts only." });
  });

  router.post("/login", async (req, res) => {
    const fixedAccounts = await fixedAccountsPromise;
    const parsed = validateCredentials(req.body);
    if (!parsed) {
      res.status(400).json({ error: "Invalid username or password payload" });
      return;
    }
    const matchingFixedAccount = fixedAccounts.find((account) => account.username === parsed.username);
    if (!matchingFixedAccount) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const user = usersRepo.findByUsername(parsed.username);
    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const ok = await bcrypt.compare(parsed.password, user.password_hash);
    if (!ok) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const token = crypto.randomBytes(SESSION_BYTES).toString("hex");
    sessionsRepo.createSession(user.id, token);
    setSessionCookie(res, token);
    res.json({
      user: {
        id: user.id,
        username: user.username,
        createdAt: user.created_at
      }
    });
  });

  router.post("/logout", (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) {
      sessionsRepo.deleteSession(token);
    }
    res.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/"
    });
    res.json({ ok: true });
  });

  router.get("/me", requireAuth, (req: AuthenticatedRequest, res) => {
    res.json({
      user: {
        id: req.user!.id,
        username: req.user!.username
      }
    });
  });

  return router;
};
