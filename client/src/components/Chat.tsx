import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { ArrowLeft, Circle, Download, LogOut, Paperclip } from "lucide-react";
import type { User } from "../lib/api";
import { downloadAttachment, logout } from "../lib/api";
import { useP2PChat } from "../hooks/useP2PChat";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";
import { Separator } from "./ui/separator";

type Props = {
  currentUser: User;
  onLoggedOut: () => void;
};

const MIN_COMPOSER_HEIGHT = 52;
const MAX_COMPOSER_HEIGHT = 220;

export const Chat = ({ currentUser, onLoggedOut }: Props) => {
  const {
    partnerResults,
    onlineUserIds,
    selectedPartner,
    selectPartnerAndConnect,
    sendMessage,
    sendAttachment,
    messages,
    partnerLastMessageById,
    canSend
  } = useP2PChat(currentUser);
  const [draft, setDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showUsersMobile, setShowUsersMobile] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageBoxRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesScrollRootRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false);
  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt)),
    [messages]
  );
  const onlineSet = useMemo(() => new Set(onlineUserIds), [onlineUserIds]);

  const resizeDraftBox = useCallback(() => {
    if (!messageBoxRef.current) {
      return;
    }
    const input = messageBoxRef.current;
    input.style.height = "0px";
    const dynamicMaxHeight =
      typeof window !== "undefined" ? Math.min(MAX_COMPOSER_HEIGHT, Math.floor(window.innerHeight * 0.35)) : MAX_COMPOSER_HEIGHT;
    const nextHeight = Math.max(MIN_COMPOSER_HEIGHT, Math.min(input.scrollHeight, dynamicMaxHeight));
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > dynamicMaxHeight ? "auto" : "hidden";
  }, []);

  const getMessagesViewport = useCallback((): HTMLDivElement | null => {
    if (!messagesScrollRootRef.current) {
      return null;
    }
    return messagesScrollRootRef.current.querySelector("[data-radix-scroll-area-viewport]");
  }, []);

  const isNearBottom = useCallback((viewport: HTMLDivElement): boolean => {
    const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    return distance < 80;
  }, []);

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior, block: "end" });
  }, []);

  const onSend = async (): Promise<void> => {
    const text = draft.trim();
    if (!text) {
      return;
    }
    await sendMessage(text);
    setDraft("");
    resizeDraftBox();
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

  const formatMessageTimestamp = (isoDate: string): string =>
    new Date(isoDate).toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

  const formatCompactDateTime = (isoDate: string): string =>
    new Date(isoDate).toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });

  const onUploadClicked = (): void => {
    fileInputRef.current?.click();
  };

  const onFilePicked = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setUploading(true);
    try {
      await sendAttachment(file);
    } catch {
      // Errors are intentionally not surfaced in UI.
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  useEffect(() => {
    if (!selectedPartner) {
      setShowUsersMobile(true);
    }
  }, [selectedPartner]);

  useEffect(() => {
    resizeDraftBox();
  }, [draft, resizeDraftBox]);

  useEffect(() => {
    const viewport = getMessagesViewport();
    if (!viewport) {
      return;
    }

    const onScroll = (): void => {
      const nearBottom = isNearBottom(viewport);
      shouldAutoScrollRef.current = nearBottom;
      if (nearBottom) {
        setHasUnreadBelow(false);
      }
    };

    onScroll();
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", onScroll);
    };
  }, [getMessagesViewport, isNearBottom]);

  useEffect(() => {
    shouldAutoScrollRef.current = true;
    setHasUnreadBelow(false);
    requestAnimationFrame(() => {
      scrollMessagesToBottom("auto");
    });
  }, [selectedPartner?.id, scrollMessagesToBottom]);

  useEffect(() => {
    if (!selectedPartner) {
      return;
    }
    const lastMessage = sortedMessages[sortedMessages.length - 1];
    if (!lastMessage) {
      return;
    }

    if (shouldAutoScrollRef.current || lastMessage.senderId === currentUser.id) {
      requestAnimationFrame(() => {
        scrollMessagesToBottom("smooth");
      });
      setHasUnreadBelow(false);
      return;
    }

    setHasUnreadBelow(true);
  }, [currentUser.id, selectedPartner, sortedMessages, scrollMessagesToBottom]);

  const onSelectPartner = async (user: User): Promise<void> => {
    await selectPartnerAndConnect(user);
    setShowUsersMobile(false);
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (canSend) {
        void onSend();
      }
    }
  };

  const showUsersPanel = showUsersMobile || !selectedPartner;
  const isMobileChatView = !showUsersPanel;
  const selectedPartnerOnline = selectedPartner ? onlineSet.has(selectedPartner.id) : false;
  const shellClassName = isMobileChatView
    ? "mx-auto flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col overflow-hidden border-0 bg-card/50 p-0 shadow-none md:h-[80vh] md:max-h-[80vh] md:max-w-6xl md:rounded-2xl md:border md:p-3 md:shadow-sm"
    : "mx-auto flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border bg-card/50 p-2 shadow-sm md:h-[80vh] md:max-h-[80vh] md:p-3";

  return (
    <main className={`${isMobileChatView ? "w-full py-0" : "container py-2"} md:py-4`}>
      <div className={shellClassName}>
        <div className={`${isMobileChatView ? "hidden md:flex" : "flex"} mb-3 items-center justify-end gap-3 rounded-xl bg-gradient-to-r from-primary/10 to-accent/10 p-3 sm:justify-between`}>
          <div className="hidden md:block">
            <h2 className="text-lg font-semibold">Xin chào, {currentUser.username}</h2>
            <p className="text-sm text-muted-foreground">
              Chọn người dùng để tải lịch sử. Tin nhắn được lưu và gửi lại khi họ online.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => {
                void logout().finally(onLoggedOut);
              }}
            >
              <LogOut className="h-4 w-4" />
              Đăng xuất
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 md:grid md:grid-cols-[300px_1fr]">
          <Card className={`${showUsersPanel ? "flex" : "hidden"} min-h-0 flex-1 flex-col md:flex`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Người dùng</CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col space-y-2 pt-0">
              <Separator />
              <ScrollArea className="min-h-0 flex-1 pr-2">
                <div className="grid gap-2">
                  {partnerResults.map((u) => {
                    const isSelected = selectedPartner?.id === u.id;
                    const online = onlineSet.has(u.id);
                    const latestPreview = partnerLastMessageById[u.id];
                    return (
                      <Button
                        key={u.id}
                        variant={isSelected ? "secondary" : "ghost"}
                        size="sm"
                        className="h-auto w-full justify-start overflow-hidden rounded-lg border px-3 py-3 text-left shadow-sm transition md:hover:shadow"
                        onClick={() => void onSelectPartner(u)}
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <Circle className={`mt-1 h-3.5 w-3.5 shrink-0 fill-current ${online ? "text-emerald-500" : "text-gray-400"}`} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-base font-semibold">{u.username}</span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {latestPreview?.text ?? "Chưa có tin nhắn"}
                            </span>
                          </span>
                          {latestPreview?.sentAt ? (
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {formatCompactDateTime(latestPreview.sentAt)}
                            </span>
                          ) : null}
                        </div>
                      </Button>
                    );
                  })}
                  {partnerResults.length === 0 && (
                    <p className="text-sm text-muted-foreground">Không tìm thấy người dùng.</p>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className={`${showUsersPanel ? "hidden md:flex" : "flex"} min-h-0 flex-1 flex-col overflow-hidden rounded-none border-x-0 md:rounded-xl md:border-x`}>
            <CardHeader className="sticky top-0 z-10 border-b bg-card/95 pb-3 backdrop-blur supports-[backdrop-filter]:bg-card/80">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  onClick={() => setShowUsersMobile(true)}
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="sr-only">Quay lại danh sách người dùng</span>
                </Button>
                {selectedPartner ? (
                  <>
                    <Circle
                      className={`h-3.5 w-3.5 fill-current ${selectedPartnerOnline ? "text-emerald-500" : "text-gray-400"}`}
                    />
                    <CardTitle className="text-base">{selectedPartner.username}</CardTitle>
                  </>
                ) : (
                  <CardTitle className="text-base">Chưa chọn người dùng</CardTitle>
                )}
              </div>
            </CardHeader>
            <CardContent className="relative flex min-h-0 flex-1 flex-col gap-0 p-0">
              <ScrollArea ref={messagesScrollRootRef} className="min-h-0 flex-1 bg-background/70 p-3">
                <div className="grid gap-3">
                  {sortedMessages.map((m) => (
                    <div key={m.id} className="rounded-md border bg-background/60 p-3 text-sm leading-relaxed">
                      <strong>{m.senderId === currentUser.id ? "Bạn" : selectedPartner?.username ?? "Đối phương"}:</strong>{" "}
                      {m.attachment ? (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <span>{m.attachment.originalName}</span>
                          <span className="text-xs text-muted-foreground">({formatFileSize(m.attachment.sizeBytes)})</span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 px-2.5 text-xs"
                            onClick={() => {
                              void downloadAttachment(m.attachment!).catch(() => {
                                // Errors are intentionally not surfaced in UI.
                              });
                            }}
                          >
                            <Download className="h-3.5 w-3.5" />
                            Tải xuống
                          </Button>
                        </span>
                      ) : (
                        <span className="whitespace-pre-wrap break-words">{m.body}</span>
                      )}
                      <span className="mt-1.5 block text-xs text-muted-foreground">
                        {formatMessageTimestamp(m.sentAt)} {m.persisted ? "" : "(đang đồng bộ...)"}
                      </span>
                    </div>
                  ))}
                  {sortedMessages.length === 0 && (
                    <p className="text-sm text-muted-foreground">Chưa có tin nhắn nào trong cuộc trò chuyện này.</p>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {hasUnreadBelow && (
                <div className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center">
                  <Button
                    size="sm"
                    className="pointer-events-auto shadow-md"
                    onClick={() => {
                      shouldAutoScrollRef.current = true;
                      setHasUnreadBelow(false);
                      scrollMessagesToBottom("smooth");
                    }}
                  >
                    Tin nhắn mới
                  </Button>
                </div>
              )}

              <div className="sticky bottom-0 z-10 border-t bg-card/95 p-3 pb-safe backdrop-blur supports-[backdrop-filter]:bg-card/80">
                <textarea
                  ref={messageBoxRef}
                  placeholder={canSend ? "Nhập tin nhắn..." : "Chọn người dùng để bắt đầu nhắn tin"}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    resizeDraftBox();
                  }}
                  onKeyDown={onComposerKeyDown}
                  disabled={!selectedPartner}
                  rows={1}
                  className="w-full min-h-[52px] resize-none rounded-md border border-input bg-background px-3 py-2.5 text-sm leading-relaxed ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    onClick={onUploadClicked}
                    disabled={!canSend || uploading}
                  >
                    <Paperclip className="h-4 w-4" />
                    {uploading ? "Đang tải..." : "Gửi tệp"}
                  </Button>
                  <Button onClick={() => void onSend()} disabled={!canSend}>
                    Gửi
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
};
