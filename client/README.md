# Secure Chat Client

React + TypeScript + Vite frontend for 1:1 WebRTC DataChannel chat.

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Client runs at `http://localhost:5173`.

## Behavior

- Login/register with backend session cookie auth
- Search and select exactly one partner
- Connect over WebRTC DataChannel using WS signaling
- Send chat payloads only on DataChannel
- Mirror **outgoing** messages to backend via `POST /api/messages`
- Do not mirror incoming messages (sender is source of truth for persistence)
- Load history from `GET /api/history?partnerUserId=...`

## Backend Expectations

- REST base: `http://localhost:8080`
- WS endpoint: `ws://localhost:8080/ws`
- Cookies must be sent (`credentials: include`)
- Config template: `.env.example` (`VITE_API_BASE`, `VITE_WS_URL`)

## UI

- Auth screen: login/register
- Chat screen:
  - partner picker
  - connect/hangup
  - signaling + ICE + channel status
  - message list + input + send button (enabled only when DataChannel is open)
