import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
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
const MESSAGE_GROUP_WINDOW_MS = 3 * 60 * 1000;

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
    loadOlderMessages,
    hasMoreOlder,
    loadingOlder,
    loadingHistory,
    canSend
  } = useP2PChat(currentUser);
  const [draft, setDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showUsersMobile, setShowUsersMobile] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageBoxRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesScrollRootRef = useRef<HTMLDivElement | null>(null);
  const messagesTopRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const pendingPrependScrollRef = useRef<{ firstMessageId?: string; scrollHeight: number; scrollTop: number } | null>(null);
  const pendingInitialAnchorPartnerIdRef = useRef<number | null>(null);
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false);
  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt)),
    [messages]
  );
  const groupedMessages = useMemo(() => {
    const groups: Array<{
      key: string;
      senderId: number;
      startedAt: string;
      items: typeof sortedMessages;
    }> = [];

    for (const message of sortedMessages) {
      const previousGroup = groups[groups.length - 1];
      const previousMessage = previousGroup?.items[previousGroup.items.length - 1];
      const canAppend =
        previousGroup &&
        previousMessage &&
        previousGroup.senderId === message.senderId &&
        new Date(message.sentAt).getTime() - new Date(previousMessage.sentAt).getTime() <= MESSAGE_GROUP_WINDOW_MS;

      if (canAppend) {
        previousGroup.items.push(message);
        continue;
      }

      groups.push({
        key: message.id,
        senderId: message.senderId,
        startedAt: message.sentAt,
        items: [message]
      });
    }

    return groups;
  }, [sortedMessages]);
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
    loadingOlderRef.current = loadingOlder;
  }, [loadingOlder]);

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
    pendingPrependScrollRef.current = null;
    pendingInitialAnchorPartnerIdRef.current = selectedPartner?.id ?? null;
  }, [selectedPartner?.id]);

  useEffect(() => {
    const viewport = getMessagesViewport();
    const topMarker = messagesTopRef.current;
    if (!viewport || !topMarker || !selectedPartner) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (
          !entry?.isIntersecting ||
          loadingOlderRef.current ||
          loadingHistory ||
          !hasMoreOlder ||
          !sortedMessages[0]?.id.startsWith("db-")
        ) {
          return;
        }

        pendingPrependScrollRef.current = {
          firstMessageId: sortedMessages[0]?.id,
          scrollHeight: viewport.scrollHeight,
          scrollTop: viewport.scrollTop
        };
        void loadOlderMessages();
      },
      {
        root: viewport,
        rootMargin: "120px 0px 0px 0px",
        threshold: 0
      }
    );

    observer.observe(topMarker);
    return () => {
      observer.disconnect();
    };
  }, [getMessagesViewport, hasMoreOlder, loadOlderMessages, loadingHistory, selectedPartner, sortedMessages]);

  useLayoutEffect(() => {
    const viewport = getMessagesViewport();
    if (!viewport) {
      return;
    }

    if (pendingPrependScrollRef.current) {
      const snapshot = pendingPrependScrollRef.current;
      if (snapshot.firstMessageId && sortedMessages[0]?.id !== snapshot.firstMessageId) {
        viewport.scrollTop = viewport.scrollHeight - snapshot.scrollHeight + snapshot.scrollTop;
        pendingPrependScrollRef.current = null;
        return;
      }
      if (!loadingOlder) {
        pendingPrependScrollRef.current = null;
      }
      return;
    }

    if (
      selectedPartner &&
      pendingInitialAnchorPartnerIdRef.current === selectedPartner.id &&
      !loadingHistory
    ) {
      viewport.scrollTop = viewport.scrollHeight;
      pendingInitialAnchorPartnerIdRef.current = null;
    }
  }, [getMessagesViewport, loadingHistory, loadingOlder, selectedPartner, sortedMessages]);

  useEffect(() => {
    if (!selectedPartner || loadingHistory || loadingOlder || pendingPrependScrollRef.current) {
      return;
    }
    const lastMessage = sortedMessages[sortedMessages.length - 1];
    if (!lastMessage) {
      return;
    }
    if (pendingInitialAnchorPartnerIdRef.current === selectedPartner.id) {
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
  }, [currentUser.id, loadingHistory, loadingOlder, selectedPartner, sortedMessages, scrollMessagesToBottom]);

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
    ? "mx-auto flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col overflow-hidden border-0 bg-card/50 p-0 shadow-none md:max-w-6xl md:px-3 md:py-3"
    : "mx-auto flex h-[100dvh] max-h-[100dvh] w-full max-w-6xl flex-col overflow-hidden bg-card/50 px-2 py-2 md:px-3 md:py-3";

  return (
    <main className="w-full py-0 md:h-[100dvh]">
      <div className={shellClassName}>
        <div
          className={`${isMobileChatView ? "hidden md:flex" : "flex"} mb-2 items-center justify-end gap-3 rounded-xl bg-gradient-to-r from-primary/10 to-accent/10 p-2.5 sm:justify-between`}
        >
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

        <div className="flex min-h-0 flex-1 flex-col gap-2 md:grid md:grid-cols-[300px_1fr]">
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
            <CardHeader className="sticky top-0 z-10 border-b bg-card/95 pb-2.5 pt-4 backdrop-blur supports-[backdrop-filter]:bg-card/80">
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
              <ScrollArea ref={messagesScrollRootRef} className="min-h-0 flex-1 bg-background/70 p-2.5">
                <div className="flex flex-col">
                  <div ref={messagesTopRef} className="h-px" />
                  {loadingOlder && (
                    <div className="pb-2 text-center text-xs text-muted-foreground">Đang tải tin nhắn cũ hơn...</div>
                  )}
                  {groupedMessages.map((group) => {
                    const senderLabel = group.senderId === currentUser.id ? "Bạn" : selectedPartner?.username ?? "Đối phương";
                    return (
                      <div key={group.key} className="mt-2 first:mt-0">
                        <div className="mb-0.5 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                          <span>{senderLabel}</span>
                          <span>{formatCompactDateTime(group.startedAt)}</span>
                          <span className="h-px min-w-6 flex-1 bg-border/80" />
                        </div>
                        <div className="flex flex-col">
                          {group.items.map((message, index) => (
                            <div
                              key={message.id}
                              className={`px-1 py-0.5 text-sm leading-snug ${index === 0 ? "" : "pl-4"}`}
                            >
                              {message.attachment ? (
                                <span className="inline-flex flex-wrap items-center gap-1.5">
                                  <span className="break-all">{message.attachment.originalName}</span>
                                  <span className="text-[11px] text-muted-foreground">
                                    ({formatFileSize(message.attachment.sizeBytes)})
                                  </span>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => {
                                      void downloadAttachment(message.attachment!).catch(() => {
                                        // Errors are intentionally not surfaced in UI.
                                      });
                                    }}
                                  >
                                    <Download className="h-3.5 w-3.5" />
                                    Tải xuống
                                  </Button>
                                </span>
                              ) : (
                                <span className="whitespace-pre-wrap break-words">{message.body}</span>
                              )}
                              {!message.persisted && (
                                <span className="ml-2 text-[11px] text-muted-foreground">(đang đồng bộ...)</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {!loadingHistory && sortedMessages.length === 0 && (
                    <p className="py-2 text-sm text-muted-foreground">Chưa có tin nhắn nào trong cuộc trò chuyện này.</p>
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
