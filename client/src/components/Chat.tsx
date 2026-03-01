import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Circle, Download, LogOut, Paperclip, Users } from "lucide-react";
import type { User } from "../lib/api";
import { downloadAttachment, logout, translateErrorMessageVi } from "../lib/api";
import { useP2PChat } from "../hooks/useP2PChat";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Separator } from "./ui/separator";

type Props = {
  currentUser: User;
  onLoggedOut: () => void;
};

export const Chat = ({ currentUser, onLoggedOut }: Props) => {
  const {
    partnerQuery,
    setPartnerQuery,
    partnerResults,
    onlineUserIds,
    selectedPartner,
    selectPartnerAndConnect,
    sendMessage,
    sendAttachment,
    messages,
    canSend,
    error
  } = useP2PChat(currentUser);
  const [draft, setDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showUsersMobile, setShowUsersMobile] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt)),
    [messages]
  );
  const onlineSet = useMemo(() => new Set(onlineUserIds), [onlineUserIds]);

  const onSend = async (): Promise<void> => {
    const text = draft.trim();
    if (!text) {
      return;
    }
    await sendMessage(text);
    setDraft("");
  };

  const formatFileSize = (sizeBytes: number): string => {
    if (sizeBytes < 1024) {
      return `${sizeBytes} B`;
    }
    if (sizeBytes < 1024 * 1024) {
      return `${(sizeBytes / 1024).toFixed(1)} KB`;
    }
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const onUploadClicked = (): void => {
    fileInputRef.current?.click();
  };

  const onFilePicked = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setLocalError(null);
    setUploading(true);
    try {
      await sendAttachment(file);
    } catch (err) {
      setLocalError(err instanceof Error ? translateErrorMessageVi(err.message) : "Không thể tải tệp lên.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const shownError = localError ?? error;

  useEffect(() => {
    if (!selectedPartner) {
      setShowUsersMobile(true);
    }
  }, [selectedPartner]);

  const onSelectPartner = async (user: User): Promise<void> => {
    await selectPartnerAndConnect(user);
    setShowUsersMobile(false);
  };

  return (
    <main className="container py-2 md:py-4">
      <div className="mx-auto flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border bg-card/50 p-2 shadow-sm md:h-[80vh] md:max-h-[80vh] md:p-3">
      <div className="mb-3 flex flex-col gap-2 rounded-xl bg-gradient-to-r from-primary/10 to-accent/10 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Xin chào, {currentUser.username}</h2>
          <p className="text-xs text-muted-foreground">
            Chọn người dùng để tải lịch sử. Tin nhắn được lưu và gửi lại khi họ online.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="h-8 px-3 text-xs md:hidden"
            onClick={() => setShowUsersMobile((prev) => !prev)}
          >
            <Users className="h-3.5 w-3.5" />
            {showUsersMobile ? "Ẩn người dùng" : "Chọn người dùng"}
          </Button>
          <Button
            variant="outline"
            className="h-8 shrink-0 px-3 text-xs"
            onClick={() => {
              void logout().finally(onLoggedOut);
            }}
          >
            <LogOut className="h-3.5 w-3.5" />
            Đăng xuất
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 md:grid md:grid-cols-[280px_1fr]">
        <Card className={`${showUsersMobile ? "block" : "hidden"} max-h-56 shrink-0 md:block md:max-h-none md:min-h-0`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Người dùng</CardTitle>
            <Input
              placeholder="Lọc theo tên đăng nhập..."
              value={partnerQuery}
              onChange={(e) => setPartnerQuery(e.target.value)}
              className="h-8 text-xs"
            />
          </CardHeader>
          <CardContent className="flex min-h-0 flex-col space-y-2 pt-0">
            {shownError && <p className="text-xs text-destructive">{shownError}</p>}
            <Separator />
            <ScrollArea className="min-h-0 flex-1 pr-2">
              <div className="grid gap-2">
                {partnerResults.map((u) => {
                  const isSelected = selectedPartner?.id === u.id;
                  const online = onlineSet.has(u.id);
                  return (
                    <Button
                      key={u.id}
                      variant={isSelected ? "secondary" : "ghost"}
                      className="h-auto justify-start px-2.5 py-1.5 text-xs"
                      onClick={() => void onSelectPartner(u)}
                    >
                      <Circle className={`mr-2 h-3 w-3 fill-current ${online ? "text-emerald-500" : "text-gray-400"}`} />
                      <span className="truncate">{u.username}</span>
                    </Button>
                  );
                })}
                {partnerResults.length === 0 && (
                  <p className="text-xs text-muted-foreground">Không tìm thấy người dùng.</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {selectedPartner ? `Cuộc trò chuyện với ${selectedPartner.username}` : "Chọn người dùng để bắt đầu chat"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 pt-0">
            <ScrollArea className="min-h-0 flex-1 rounded-md border bg-background/70 p-2.5">
              <div className="grid gap-3">
                {sortedMessages.map((m) => (
                  <div key={m.id} className="rounded-md border bg-background/60 p-2 text-xs">
                    <strong>{m.senderId === currentUser.id ? "Bạn" : selectedPartner?.username ?? "Đối phương"}:</strong>{" "}
                    {m.attachment ? (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <span>{m.attachment.originalName}</span>
                        <span className="text-[11px] text-muted-foreground">({formatFileSize(m.attachment.sizeBytes)})</span>
                        <Button
                          variant="outline"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => {
                            void downloadAttachment(m.attachment!).catch((err: unknown) => {
                              setLocalError(
                                err instanceof Error
                                  ? translateErrorMessageVi(err.message)
                                  : "Không thể tải tệp xuống."
                              );
                            });
                          }}
                        >
                          <Download className="h-3 w-3" />
                          Tải xuống
                        </Button>
                      </span>
                    ) : (
                      m.body
                    )}
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {new Date(m.sentAt).toLocaleTimeString("vi-VN")} {m.persisted ? "" : "(đang đồng bộ...)"}
                    </span>
                  </div>
                ))}
                {sortedMessages.length === 0 && (
                  <p className="text-xs text-muted-foreground">Chưa có tin nhắn nào trong cuộc trò chuyện này.</p>
                )}
              </div>
            </ScrollArea>

            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
              <Input
                placeholder={canSend ? "Nhập tin nhắn..." : "Chọn người dùng để bắt đầu nhắn tin"}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={!selectedPartner}
                className="h-8 text-xs"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.xlsx,.json,.csv"
                className="hidden"
                onChange={(e) => {
                  void onFilePicked(e);
                }}
              />
              <Button
                variant="outline"
                className="h-8 px-3 text-xs"
                onClick={onUploadClicked}
                disabled={!canSend || uploading}
              >
                <Paperclip className="h-3.5 w-3.5" />
                {uploading ? "Đang tải..." : "Gửi tệp"}
              </Button>
              <Button className="h-8 px-3 text-xs" onClick={() => void onSend()} disabled={!canSend}>
                Gửi
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      </div>
    </main>
  );
};
