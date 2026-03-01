export type User = {
  id: number;
  username: string;
  createdAt?: string;
};

export type ChatMessage = {
  id: number;
  senderId: number;
  body: string;
  sentAt: string;
  attachment: AttachmentMeta | null;
};

export type AttachmentMeta = {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8080";

const VI_ERROR_MAP: Record<string, string> = {
  Unauthorized: "Bạn chưa đăng nhập.",
  "Invalid credentials": "Tên đăng nhập hoặc mật khẩu không đúng.",
  "Invalid credentials payload": "Dữ liệu đăng nhập không hợp lệ.",
  "Invalid message payload": "Nội dung tin nhắn không hợp lệ.",
  "Invalid partnerUserId": "Người nhận không hợp lệ.",
  "Partner user not found": "Không tìm thấy người dùng nhận tin.",
  "File is too large": "Tệp quá lớn.",
  "Invalid upload request": "Yêu cầu tải tệp lên không hợp lệ.",
  "Invalid file type. Allowed: .pdf, .docx, .xlsx, .json, .csv":
    "Định dạng tệp không hợp lệ. Chỉ chấp nhận .pdf, .docx, .xlsx, .json, .csv.",
  "Missing file": "Vui lòng chọn tệp để tải lên.",
  "Failed to store attachment": "Không thể lưu tệp đính kèm.",
  "Attachment not found": "Không tìm thấy tệp đính kèm.",
  "Attachment file is missing": "Tệp đính kèm đã bị thiếu trên máy chủ.",
  "Too many requests. Please try again shortly.": "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút."
};

export const translateErrorMessageVi = (message: string): string => {
  const normalized = message.trim();
  if (normalized in VI_ERROR_MAP) {
    return VI_ERROR_MAP[normalized];
  }
  if (normalized.startsWith("HTTP ")) {
    return "Yêu cầu thất bại. Vui lòng thử lại.";
  }
  return normalized;
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const hasFormDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: hasFormDataBody
      ? init?.headers
      : {
          "Content-Type": "application/json",
          ...(init?.headers ?? {})
        }
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(translateErrorMessageVi(data.error ?? `HTTP ${res.status}`));
  }
  return (await res.json()) as T;
};

export const register = async (username: string, password: string): Promise<User> => {
  const data = await request<{ user: User }>("/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  return data.user;
};

export const login = async (username: string, password: string): Promise<User> => {
  const data = await request<{ user: User }>("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  return data.user;
};

export const logout = async (): Promise<void> => {
  await request<{ ok: true }>("/api/logout", { method: "POST" });
};

export const getMe = async (): Promise<User | null> => {
  const res = await fetch(`${API_BASE}/api/me`, { credentials: "include" });
  if (res.status === 401) {
    return null;
  }
  if (!res.ok) {
    throw new Error(translateErrorMessageVi(`HTTP ${res.status}`));
  }
  const data = (await res.json()) as { user: User };
  return data.user;
};

export const searchUsers = async (q: string): Promise<User[]> => {
  const data = await request<{ users: User[] }>(`/api/users?q=${encodeURIComponent(q)}`);
  return data.users;
};

export const getUsers = async (): Promise<User[]> => {
  const data = await request<{ users: User[] }>("/api/users");
  return data.users;
};

export const getHistory = async (partnerUserId: number): Promise<{ conversationId: number | null; messages: ChatMessage[] }> => {
  return request<{ conversationId: number | null; messages: ChatMessage[] }>(
    `/api/history?partnerUserId=${partnerUserId}`
  );
};

export const persistOutgoingMessage = async (
  partnerUserId: number,
  body: string,
  sentAtClient?: string
): Promise<ChatMessage> => {
  const data = await request<{ message: ChatMessage }>("/api/messages", {
    method: "POST",
    body: JSON.stringify({ partnerUserId, body, sentAtClient })
  });
  return data.message;
};

export const uploadAttachment = async (partnerUserId: number, file: File): Promise<ChatMessage> => {
  const formData = new FormData();
  formData.append("partnerUserId", String(partnerUserId));
  formData.append("file", file);
  const data = await request<{ message: ChatMessage }>("/api/attachments", {
    method: "POST",
    body: formData
  });
  return data.message;
};

export const downloadAttachment = async (attachment: AttachmentMeta): Promise<void> => {
  const res = await fetch(`${API_BASE}/api/attachments/${attachment.id}/download`, {
    method: "GET",
    credentials: "include"
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(translateErrorMessageVi(data.error ?? `HTTP ${res.status}`));
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = attachment.originalName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
};
