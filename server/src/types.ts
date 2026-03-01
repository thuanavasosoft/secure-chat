import type { Request } from "express";

export type UserRecord = {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
};

export type PublicUser = {
  id: number;
  username: string;
  createdAt: string;
};

export type SessionRecord = {
  id: number;
  user_id: number;
  token: string;
  expires_at: string;
  created_at: string;
};

export type ConversationRecord = {
  id: number;
  user1_id: number;
  user2_id: number;
  created_at: string;
};

export type MessageRecord = {
  id: number;
  conversation_id: number;
  sender_id: number;
  body: string;
  sent_at: string;
};

export type AttachmentRecord = {
  id: number;
  message_id: number;
  uploader_id: number;
  stored_name: string;
  stored_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export type ApiError = {
  error: string;
  code?: string;
};

export type WsCallMessage = {
  type: "call";
  toUserId: number;
  fromUserId: number;
};

export type WsSignalPayload = {
  sdp?: RTCSessionDescriptionLike;
  ice?: RTCIceCandidateLike;
};

export type WsSignalMessage = {
  type: "signal";
  toUserId: number;
  fromUserId: number;
  data: WsSignalPayload;
};

export type WsHangupMessage = {
  type: "hangup";
  toUserId: number;
  fromUserId: number;
};

export type WsErrorMessage = {
  type: "error";
  code: "PEER_OFFLINE" | "PEER_BUSY" | "INVALID_PAYLOAD" | "UNAUTHORIZED" | "RATE_LIMITED";
  message: string;
};

export type WsPresenceSnapshotMessage = {
  type: "presence_snapshot";
  onlineUserIds: number[];
};

export type WsPresenceUpdateMessage = {
  type: "presence_update";
  userId: number;
  online: boolean;
};

export type WsServerMessage =
  | WsCallMessage
  | WsSignalMessage
  | WsHangupMessage
  | WsErrorMessage
  | WsPresenceSnapshotMessage
  | WsPresenceUpdateMessage;
export type WsClientMessage = WsCallMessage | WsSignalMessage | WsHangupMessage;

export type RTCSessionDescriptionLike = {
  type: "offer" | "answer" | "pranswer" | "rollback";
  sdp: string;
};

export type RTCIceCandidateLike = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

export type AuthenticatedRequest = Request & {
  user?: {
    id: number;
    username: string;
  };
};
