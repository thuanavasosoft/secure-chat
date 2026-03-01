type PeerRole = "caller" | "callee";

type PeerEvents = {
  onIceCandidate: (candidate: RTCIceCandidateInit) => void;
  onMessage: (text: string) => void;
  onChannelState: (state: RTCDataChannelState) => void;
  onConnectionState: (state: RTCPeerConnectionState) => void;
};

export class WebRtcDataPeer {
  private readonly pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private role: PeerRole | null = null;
  private pendingRemoteIce: RTCIceCandidateInit[] = [];

  constructor(private readonly events: PeerEvents) {
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.events.onIceCandidate(ev.candidate.toJSON());
      }
    };
    this.pc.onconnectionstatechange = () => {
      this.events.onConnectionState(this.pc.connectionState);
    };
    this.pc.ondatachannel = (ev) => {
      this.attachDataChannel(ev.channel);
    };
  }

  get connectionState(): RTCPeerConnectionState {
    return this.pc.connectionState;
  }

  get channelState(): RTCDataChannelState | "none" {
    return this.dc?.readyState ?? "none";
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.role = "caller";
    const channel = this.pc.createDataChannel("chat");
    this.attachDataChannel(channel);
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  async acceptOfferAndCreateAnswer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    this.role = "callee";
    await this.pc.setRemoteDescription(offer);
    await this.flushPendingIce();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  async acceptAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(answer);
    await this.flushPendingIce();
  }

  async addRemoteIce(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc.remoteDescription) {
      this.pendingRemoteIce.push(candidate);
      return;
    }
    await this.pc.addIceCandidate(candidate);
  }

  send(text: string): void {
    if (!this.dc || this.dc.readyState !== "open") {
      throw new Error("Kênh dữ liệu chưa sẵn sàng.");
    }
    this.dc.send(text);
  }

  close(): void {
    this.dc?.close();
    this.pc.close();
  }

  private attachDataChannel(channel: RTCDataChannel): void {
    this.dc = channel;
    this.events.onChannelState(channel.readyState);
    channel.onopen = () => this.events.onChannelState(channel.readyState);
    channel.onclose = () => this.events.onChannelState(channel.readyState);
    channel.onerror = () => this.events.onChannelState(channel.readyState);
    channel.onmessage = (ev) => {
      this.events.onMessage(String(ev.data));
    };
  }

  private async flushPendingIce(): Promise<void> {
    if (!this.pc.remoteDescription) {
      return;
    }
    for (const candidate of this.pendingRemoteIce) {
      await this.pc.addIceCandidate(candidate);
    }
    this.pendingRemoteIce = [];
  }
}
