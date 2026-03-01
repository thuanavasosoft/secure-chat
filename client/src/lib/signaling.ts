export type SignalData = {
  sdp?: RTCSessionDescriptionInit;
  ice?: RTCIceCandidateInit;
};

export type WsOutgoingMessage =
  | { type: "call"; toUserId: number; fromUserId: number }
  | { type: "signal"; toUserId: number; fromUserId: number; data: SignalData }
  | { type: "hangup"; toUserId: number; fromUserId: number };

export type WsIncomingMessage =
  | { type: "call"; toUserId: number; fromUserId: number }
  | { type: "signal"; toUserId: number; fromUserId: number; data: SignalData }
  | { type: "hangup"; toUserId: number; fromUserId: number }
  | { type: "error"; code: string; message: string }
  | { type: "presence_snapshot"; onlineUserIds: number[] }
  | { type: "presence_update"; userId: number; online: boolean };

type Handler = (message: WsIncomingMessage) => void;
type StatusHandler = (status: "connecting" | "open" | "closed" | "error") => void;

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080/ws";

export class SignalingClient {
  private ws: WebSocket | null = null;
  private messageHandlers = new Set<Handler>();
  private statusHandlers = new Set<StatusHandler>();

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.ws = new WebSocket(WS_URL);
    this.emitStatus("connecting");
    this.ws.onopen = () => this.emitStatus("open");
    this.ws.onclose = () => this.emitStatus("closed");
    this.ws.onerror = () => this.emitStatus("error");
    this.ws.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data as string) as WsIncomingMessage;
        this.messageHandlers.forEach((handler) => handler(parsed));
      } catch {
        this.emitStatus("error");
      }
    };
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(message: WsOutgoingMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Kết nối tín hiệu chưa mở.");
    }
    this.ws.send(JSON.stringify(message));
  }

  onMessage(handler: Handler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  private emitStatus(status: "connecting" | "open" | "closed" | "error"): void {
    this.statusHandlers.forEach((handler) => handler(status));
  }
}
