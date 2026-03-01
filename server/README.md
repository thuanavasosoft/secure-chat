# Secure Chat Server

Node.js + TypeScript backend for 1:1 pair chat signaling, auth, and message persistence.

## Stack

- Express REST API
- WebSocket signaling (`ws`)
- SQLite (`better-sqlite3`)
- Session cookies in SQLite (no Redis)

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Server runs at `http://localhost:8080` by default.

## Environment

- `PORT` (default: `8080`)
- `CLIENT_ORIGIN` (default: `http://localhost:5173`)
- `DB_PATH` (default: `./data.sqlite`)
- `NODE_ENV=production` enables `Secure` session cookie flag
- `CHAT_USER1_USERNAME`, `CHAT_USER1_PASSWORD`
- `CHAT_USER2_USERNAME`, `CHAT_USER2_PASSWORD`
- Template: `.env.example`

## API Endpoints

- `POST /api/login` `{ username, password }` (sets `sid` cookie)
- `POST /api/logout`
- `GET /api/me`
- `GET /api/users?q=alice`
- `GET /api/history?partnerUserId=2`
- `POST /api/messages` `{ partnerUserId, body, sentAtClient? }`

## WebSocket Signaling

- Endpoint: `ws://localhost:8080/ws`
- Cookie-authenticated by `sid`
- Relays:
  - `call`: `{ type:"call", toUserId, fromUserId }`
  - `signal`: `{ type:"signal", toUserId, fromUserId, data:{ sdp?, ice? } }`
  - `hangup`: `{ type:"hangup", toUserId, fromUserId }`
- Errors:
  - `PEER_OFFLINE`
  - `PEER_BUSY`
  - `INVALID_PAYLOAD`
  - `UNAUTHORIZED`
  - `RATE_LIMITED`

## Security Notes

- Passwords hashed with bcrypt (cost 12)
- Session token is random 32-byte hex, stored in DB
- Cookie: `HttpOnly`, `SameSite=Lax`, `Secure` in production
- CORS restricted to configured client origin with credentials
- REST per-IP rate limit and WS per-connection token bucket
- Signaling logs do not include SDP contents (only metadata like SDP length)

## Production Notes

Use HTTPS/WSS behind a reverse proxy (e.g., nginx). In production:

- terminate TLS at proxy
- forward to this server over localhost
- preserve websocket upgrade headers
- set `NODE_ENV=production` for secure cookies
