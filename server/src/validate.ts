import type {
  RTCIceCandidateLike,
  RTCSessionDescriptionLike,
  WsCallMessage,
  WsClientMessage,
  WsHangupMessage,
  WsSignalMessage
} from "./types";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isPositiveInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

export const ALLOWED_UPLOAD_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".json", ".csv"]);
export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/json",
  "text/json",
  "text/csv",
  "application/csv",
  "text/plain"
]);

export const validateCredentials = (body: unknown): { username: string; password: string } | null => {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const username = Reflect.get(body, "username");
  const password = Reflect.get(body, "password");
  if (!isNonEmptyString(username) || !isNonEmptyString(password)) {
    return null;
  }
  if (username.length < 3 || username.length > 32 || password.length < 8 || password.length > 200) {
    return null;
  }
  return { username: username.trim(), password };
};

export const validatePartnerUserIdQuery = (partnerUserIdRaw: unknown): number | null => {
  if (typeof partnerUserIdRaw !== "string") {
    return null;
  }
  const parsed = Number.parseInt(partnerUserIdRaw, 10);
  return isPositiveInt(parsed) ? parsed : null;
};

export const validatePartnerUserIdRaw = (partnerUserIdRaw: unknown): number | null => {
  if (typeof partnerUserIdRaw !== "string") {
    return null;
  }
  const parsed = Number.parseInt(partnerUserIdRaw, 10);
  return isPositiveInt(parsed) ? parsed : null;
};

export const isUploadFileAllowed = (filename: string, mimeType: string): boolean => {
  const normalizedName = filename.trim().toLowerCase();
  const extension = normalizedName.includes(".") ? normalizedName.slice(normalizedName.lastIndexOf(".")) : "";
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
    return false;
  }
  return ALLOWED_UPLOAD_MIME_TYPES.has(mimeType.toLowerCase());
};

export const validatePersistMessageBody = (
  body: unknown
): { partnerUserId: number; body: string; sentAtClient?: string } | null => {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const partnerUserId = Reflect.get(body, "partnerUserId");
  const messageBody = Reflect.get(body, "body");
  const sentAtClient = Reflect.get(body, "sentAtClient");
  if (!isPositiveInt(partnerUserId) || !isNonEmptyString(messageBody) || messageBody.length > 4000) {
    return null;
  }
  if (sentAtClient !== undefined && !isNonEmptyString(sentAtClient)) {
    return null;
  }
  return {
    partnerUserId,
    body: messageBody.trim(),
    sentAtClient: typeof sentAtClient === "string" ? sentAtClient : undefined
  };
};

const isSessionDescription = (value: unknown): value is RTCSessionDescriptionLike => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const type = Reflect.get(value, "type");
  const sdp = Reflect.get(value, "sdp");
  const validTypes = new Set(["offer", "answer", "pranswer", "rollback"]);
  return typeof type === "string" && validTypes.has(type) && isNonEmptyString(sdp);
};

const isIceCandidate = (value: unknown): value is RTCIceCandidateLike => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = Reflect.get(value, "candidate");
  if (!isNonEmptyString(candidate)) {
    return false;
  }
  const sdpMid = Reflect.get(value, "sdpMid");
  const sdpMLineIndex = Reflect.get(value, "sdpMLineIndex");
  const usernameFragment = Reflect.get(value, "usernameFragment");
  const sdpMidValid = sdpMid === undefined || sdpMid === null || typeof sdpMid === "string";
  const sdpMlineValid =
    sdpMLineIndex === undefined || sdpMLineIndex === null || Number.isInteger(sdpMLineIndex);
  const usernameFragValid =
    usernameFragment === undefined || usernameFragment === null || typeof usernameFragment === "string";
  return sdpMidValid && sdpMlineValid && usernameFragValid;
};

const validateCommonWs = (
  message: unknown
): { type: string; fromUserId: number; toUserId: number; data?: unknown } | null => {
  if (typeof message !== "object" || message === null) {
    return null;
  }
  const type = Reflect.get(message, "type");
  const fromUserId = Reflect.get(message, "fromUserId");
  const toUserId = Reflect.get(message, "toUserId");
  if (typeof type !== "string" || !isPositiveInt(fromUserId) || !isPositiveInt(toUserId)) {
    return null;
  }
  const data = Reflect.get(message, "data");
  return { type, fromUserId, toUserId, data };
};

export const validateWsMessage = (raw: unknown): WsClientMessage | null => {
  const common = validateCommonWs(raw);
  if (!common) {
    return null;
  }

  if (common.type === "call") {
    const out: WsCallMessage = {
      type: "call",
      fromUserId: common.fromUserId,
      toUserId: common.toUserId
    };
    return out;
  }

  if (common.type === "hangup") {
    const out: WsHangupMessage = {
      type: "hangup",
      fromUserId: common.fromUserId,
      toUserId: common.toUserId
    };
    return out;
  }

  if (common.type === "signal") {
    if (typeof common.data !== "object" || common.data === null) {
      return null;
    }
    const sdp = Reflect.get(common.data, "sdp");
    const ice = Reflect.get(common.data, "ice");
    if (sdp === undefined && ice === undefined) {
      return null;
    }
    if (sdp !== undefined && !isSessionDescription(sdp)) {
      return null;
    }
    if (ice !== undefined && !isIceCandidate(ice)) {
      return null;
    }
    const out: WsSignalMessage = {
      type: "signal",
      fromUserId: common.fromUserId,
      toUserId: common.toUserId,
      data: {
        sdp: sdp as RTCSessionDescriptionLike | undefined,
        ice: ice as RTCIceCandidateLike | undefined
      }
    };
    return out;
  }

  return null;
};
