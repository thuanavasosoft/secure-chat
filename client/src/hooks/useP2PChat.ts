import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AttachmentMeta, ChatMessage, User } from "../lib/api";
import {
  getHistory,
  getUsers,
  persistOutgoingMessage,
  translateErrorMessageVi,
  uploadAttachment
} from "../lib/api";
import { SignalingClient, type WsIncomingMessage } from "../lib/signaling";
import { WebRtcDataPeer } from "../lib/webrtc";

type UiMessage = {
  id: string;
  senderId: number;
  body: string;
  sentAt: string;
  persisted: boolean;
  attachment: AttachmentMeta | null;
};

type PartnerLastMessage = {
  text: string;
  sentAt: string;
};

type ConnectionStatus = "idle" | "signaling" | "connecting" | "open" | "closed" | "error";

export const useP2PChat = (currentUser: User) => {
  const signalingRef = useRef<SignalingClient | null>(null);
  const peerRef = useRef<WebRtcDataPeer | null>(null);
  const selectedPartnerRef = useRef<User | null>(null);
  const [partnerQuery, setPartnerQuery] = useState("");
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<number[]>([]);
  const [selectedPartner, setSelectedPartner] = useState<User | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [signalStatus, setSignalStatus] = useState<"connecting" | "open" | "closed" | "error">("closed");
  const [iceState, setIceState] = useState<RTCPeerConnectionState>("new");
  const [error, setError] = useState<string | null>(null);
  const [partnerLastMessageById, setPartnerLastMessageById] = useState<Record<number, PartnerLastMessage>>({});

  const makePreviewText = useCallback((message: { body: string; attachment: AttachmentMeta | null }): string => {
    if (message.attachment) {
      return `Tệp đính kèm: ${message.attachment.originalName}`;
    }
    const normalized = message.body.replace(/\s+/g, " ").trim();
    return normalized.length > 0 ? normalized : "Tin nhắn trống";
  }, []);

  const setupPeer = useCallback(
    (partner: User) => {
      peerRef.current?.close();
      const peer = new WebRtcDataPeer({
        onIceCandidate: (candidate) => {
          const signaling = signalingRef.current;
          if (!signaling) {
            return;
          }
          try {
            signaling.send({
              type: "signal",
              fromUserId: currentUser.id,
              toUserId: partner.id,
              data: { ice: candidate }
            });
          } catch (err) {
            setError(err instanceof Error ? translateErrorMessageVi(err.message) : "Không thể gửi ICE.");
          }
        },
        onMessage: (text) => {
          const sentAt = new Date().toISOString();
          setMessages((prev) => [
            ...prev,
            {
              id: `in-${Date.now()}-${Math.random()}`,
              senderId: partner.id,
              body: text,
              sentAt,
              persisted: true,
              attachment: null
            }
          ]);
          setPartnerLastMessageById((prev) => ({
            ...prev,
            [partner.id]: {
              text: makePreviewText({ body: text, attachment: null }),
              sentAt
            }
          }));
        },
        onChannelState: (dcState) => {
          if (dcState === "open") {
            setStatus("open");
          } else if (dcState === "closing" || dcState === "closed") {
            setStatus("closed");
          } else {
            setStatus("connecting");
          }
        },
        onConnectionState: (state) => {
          setIceState(state);
        }
      });
      peerRef.current = peer;
      return peer;
    },
    [currentUser.id, makePreviewText]
  );

  useEffect(() => {
    selectedPartnerRef.current = selectedPartner;
  }, [selectedPartner]);

  const handleSignalMessage = useCallback(
    async (msg: WsIncomingMessage) => {
      if (msg.type === "presence_snapshot") {
        setOnlineUserIds(msg.onlineUserIds);
        return;
      }
      if (msg.type === "presence_update") {
        setOnlineUserIds((prev) => {
          if (msg.online && !prev.includes(msg.userId)) {
            return [...prev, msg.userId];
          }
          if (!msg.online && prev.includes(msg.userId)) {
            return prev.filter((id) => id !== msg.userId);
          }
          return prev;
        });
        return;
      }
      if (msg.type === "error") {
        setError(`${msg.code}: ${translateErrorMessageVi(msg.message)}`);
        setStatus("error");
        return;
      }
      const selectedPartner = selectedPartnerRef.current;
      if (!selectedPartner) {
        return;
      }
      if (msg.fromUserId !== selectedPartner.id) {
        return;
      }
      if (msg.type === "hangup") {
        peerRef.current?.close();
        setStatus("closed");
        return;
      }
      if (msg.type === "call") {
        setStatus("signaling");
        return;
      }
      if (msg.type === "signal") {
        if (msg.data.sdp?.type === "offer") {
          setStatus("connecting");
          const peer = setupPeer(selectedPartner);
          const answer = await peer.acceptOfferAndCreateAnswer(msg.data.sdp);
          signalingRef.current?.send({
            type: "signal",
            fromUserId: currentUser.id,
            toUserId: selectedPartner.id,
            data: { sdp: answer }
          });
          return;
        }

        if (msg.data.sdp?.type === "answer" && peerRef.current) {
          await peerRef.current.acceptAnswer(msg.data.sdp);
          return;
        }

        if (msg.data.ice && peerRef.current) {
          await peerRef.current.addRemoteIce(msg.data.ice);
        }
      }
    },
    [currentUser.id, setupPeer]
  );

  useEffect(() => {
    const signaling = new SignalingClient();
    signalingRef.current = signaling;
    signaling.connect();

    const offStatus = signaling.onStatus((newStatus) => {
      setSignalStatus(newStatus);
      if (newStatus === "error") {
        setStatus("error");
      }
    });

    const offMessage = signaling.onMessage((msg) => {
      handleSignalMessage(msg).catch((err: unknown) => {
        setStatus("error");
        setError(err instanceof Error ? translateErrorMessageVi(err.message) : "Xử lý tín hiệu thất bại.");
      });
    });

    return () => {
      offStatus();
      offMessage();
      signaling.disconnect();
      peerRef.current?.close();
      peerRef.current = null;
    };
  }, [handleSignalMessage]);

  useEffect(() => {
    getUsers()
      .then(setAllUsers)
      .catch((err: unknown) =>
        setError(err instanceof Error ? translateErrorMessageVi(err.message) : "Không thể tải danh sách người dùng.")
      );
  }, []);

  const loadHistory = useCallback(async (partner: User) => {
    const data = await getHistory(partner.id);
    const mappedMessages = data.messages.map((m: ChatMessage) => ({
        id: `db-${m.id}`,
        senderId: m.senderId,
        body: m.body,
        sentAt: m.sentAt,
        persisted: true,
        attachment: m.attachment ?? null
      }));
    setMessages(mappedMessages);

    const latestMessage = mappedMessages[mappedMessages.length - 1];
    setPartnerLastMessageById((prev) => {
      if (!latestMessage) {
        return prev;
      }
      return {
        ...prev,
        [partner.id]: {
          text: makePreviewText({ body: latestMessage.body, attachment: latestMessage.attachment }),
          sentAt: latestMessage.sentAt
        }
      };
    });
  }, [makePreviewText]);

  const selectPartner = useCallback(
    async (partner: User) => {
      setSelectedPartner(partner);
      setStatus("idle");
      setError(null);
      peerRef.current?.close();
      peerRef.current = null;
      await loadHistory(partner);
    },
    [loadHistory]
  );

  useEffect(() => {
    if (selectedPartner || allUsers.length === 0) {
      return;
    }
    void selectPartner(allUsers[0]);
  }, [allUsers, selectPartner, selectedPartner]);

  const connectToPartner = useCallback(
    async (partner: User) => {
      if (!signalingRef.current) {
        return;
      }
      setStatus("signaling");
      const peer = setupPeer(partner);
      signalingRef.current.send({
        type: "call",
        fromUserId: currentUser.id,
        toUserId: partner.id
      });
      const offer = await peer.createOffer();
      signalingRef.current.send({
        type: "signal",
        fromUserId: currentUser.id,
        toUserId: partner.id,
        data: { sdp: offer }
      });
    },
    [currentUser.id, setupPeer]
  );

  const connect = useCallback(async () => {
    if (!selectedPartner) {
      return;
    }
    await connectToPartner(selectedPartner);
  }, [connectToPartner, selectedPartner]);

  const selectPartnerAndConnect = useCallback(
    async (partner: User) => {
      await selectPartner(partner);
      await connectToPartner(partner);
    },
    [connectToPartner, selectPartner]
  );

  const hangup = useCallback(() => {
    if (!selectedPartner) {
      return;
    }
    try {
      signalingRef.current?.send({
        type: "hangup",
        fromUserId: currentUser.id,
        toUserId: selectedPartner.id
      });
    } catch {
      // Ignore signaling send failures during local cleanup.
    }
    peerRef.current?.close();
    peerRef.current = null;
    setStatus("closed");
  }, [currentUser.id, selectedPartner]);

  const sendMessage = useCallback(
    async (body: string) => {
      if (!selectedPartner) {
        throw new Error("Chưa chọn người dùng.");
      }
      const sentAt = new Date().toISOString();
      const optimisticId = `out-${Date.now()}-${Math.random()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: optimisticId,
          senderId: currentUser.id,
          body,
          sentAt,
          persisted: false,
          attachment: null
        }
      ]);
      setPartnerLastMessageById((prev) => ({
        ...prev,
        [selectedPartner.id]: {
          text: makePreviewText({ body, attachment: null }),
          sentAt
        }
      }));

      const persisted = await persistOutgoingMessage(selectedPartner.id, body, sentAt);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimisticId
            ? {
                ...m,
                id: `db-${persisted.id}`,
                sentAt: persisted.sentAt,
                persisted: true,
                attachment: persisted.attachment ?? null
              }
            : m
        )
      );

      // Realtime P2P delivery is best-effort; DB persistence is the source of truth for offline delivery.
      if (status === "open" && peerRef.current) {
        try {
          peerRef.current.send(body);
        } catch {
          // Ignore data channel send failures for store-and-forward behavior.
        }
      }
    },
    [currentUser.id, makePreviewText, selectedPartner, status]
  );

  const sendAttachment = useCallback(
    async (file: File) => {
      if (!selectedPartner) {
        throw new Error("Chưa chọn người dùng.");
      }
      const persisted = await uploadAttachment(selectedPartner.id, file);
      setMessages((prev) => [
        ...prev,
        {
          id: `db-${persisted.id}`,
          senderId: persisted.senderId,
          body: persisted.body,
          sentAt: persisted.sentAt,
          persisted: true,
          attachment: persisted.attachment ?? null
        }
      ]);
      setPartnerLastMessageById((prev) => ({
        ...prev,
        [selectedPartner.id]: {
          text: makePreviewText({ body: persisted.body, attachment: persisted.attachment ?? null }),
          sentAt: persisted.sentAt
        }
      }));
    },
    [makePreviewText, selectedPartner]
  );

  const canSend = useMemo(() => selectedPartner !== null, [selectedPartner]);
  const partnerResults = useMemo(() => {
    const q = partnerQuery.trim().toLowerCase();
    if (!q) {
      return allUsers;
    }
    return allUsers.filter((user) => user.username.toLowerCase().includes(q));
  }, [allUsers, partnerQuery]);

  return {
    partnerQuery,
    setPartnerQuery,
    partnerResults,
    onlineUserIds,
    selectedPartner,
    selectPartner,
    selectPartnerAndConnect,
    connect,
    hangup,
    sendMessage,
    sendAttachment,
    messages,
    partnerLastMessageById,
    canSend,
    status,
    signalStatus,
    iceState,
    error
  };
};
