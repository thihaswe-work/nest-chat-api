# Scaling Messenger

A NestJS backend for a chat application that demonstrates two things together:

1. **Authentication and authorization** — JWT sessions, hashed passwords, and
   conversation-membership rules on both HTTP and WebSockets.
2. **Horizontal WebSocket scaling** — many server instances stay in sync through
   a Redis pub/sub adapter.

Clients connect over Socket.IO, join a conversation "room", and exchange messages.
Message history is stored in MongoDB, users/conversations in PostgreSQL, and Redis
is used as the pub/sub bus between app instances.

This README is written for someone new to the codebase. Read the
[guided code tour](#7-guided-code-tour) first, then use the
[file-by-file reference](#8-file-by-file-reference) while exploring.

---

## 1. What the app can do today

| Feature | Status | Where |
| --- | --- | --- |
| Public health check (`GET /`) | ✅ Working | `app.controller.ts` |
| Register (`POST /auth/register`) | ✅ Working (scrypt hashing + JWT) | `auth/*`, `users/*` |
| Login (`POST /auth/login`) | ✅ Working (JWT) | `auth/*` |
| Current profile (`GET /users/me`) | ✅ Working (protected) | `users/users.controller.ts` |
| JWT protection for HTTP + WebSockets | ✅ Working (global guard) | `auth/guards/jwt-auth.guard.ts` |
| Conversation CRUD with membership rules | ✅ Working | `conversations/*` |
| Message CRUD with membership/ownership rules | ✅ Working | `messages/*` |
| Join a chat room over WebSockets | ✅ Working (members only) | `chat/chat.gateway.ts` |
| Send + broadcast a message | ✅ Working (author from token) | `chat/chat.gateway.ts` |
| Multi-instance WebSocket scaling | ✅ Working when Redis is available | `chat/redis-io.adapter.ts` |
| Input validation | ✅ Working (`class-validator` + global pipe) | `main.ts`, `**/dto/*` |
| Refresh tokens / logout revocation / roles | ❌ Not implemented | — |

> **Breaking change from the original scaffold:** registration moved from
> `POST /users` to `POST /auth/register`, and the body field is now `password`
> (hashed server-side), not `passwordHash`.

---

## 2. Technology stack

| Technology | Role in this project | Why |
| --- | --- | --- |
| **NestJS** | Application framework | Modules, DI, controllers, guards, gateways |
| **TypeScript** | Language | Types + decorators for Nest/TypeORM/Mongoose |
| **PostgreSQL + TypeORM** | Relational data | Users, conversations, participant join table |
| **MongoDB + Mongoose** | Message history | High-volume, flexible documents |
| **Redis + Socket.IO adapter** | Cross-instance pub/sub | Lets N servers broadcast to each other |
| **JWT (`@nestjs/jwt`)** | Session tokens | Stateless auth that works across instances |
| **Node `scrypt`** | Password hashing | Memory-hard, no native dependency |
| **class-validator / class-transformer** | Input validation | Reject malformed HTTP payloads |
| **Vitest** | Tests | Unit tests for password hashing |
| **Oxlint / Prettier** | Lint / formatting | Consistent code style |

**Why JWTs?** The app is designed to run as several stateless instances. A signed
token lets any instance authenticate a request without a shared session store.

---

## 3. Architecture at a glance

```
                    ┌──────────────────────┐
                    │   Browser / Client   │
                    │  HTTP + Socket.IO    │
                    │  Bearer <JWT>        │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  Load balancer /     │
                    │  reverse proxy       │
                    │  (sticky sessions)   │
                    └──────────┬───────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
   ┌──────▼──────┐      ┌──────▼──────┐      ┌──────▼──────┐
   │  Node #1    │      │  Node #2    │      │  Node #3    │
   │  NestJS     │      │  NestJS     │      │  NestJS     │
   │  HTTP + WS  │      │  HTTP + WS  │      │  HTTP + WS  │
   │  JWT guard  │      │  JWT guard  │      │  JWT guard  │
   └──┬───┬───┬──┘      └──┬───┬───┬──┘      └──┬───┬───┬──┘
      │   │   │            │   │   │            │   │   │
      │   │   └────────────┴───┴───┴────────────┘   │   │
      │   │                  Redis pub/sub           │   │
      │   │                (Socket.IO adapter)       │   │
      │   │                                          │   │
      │   └──────────────► PostgreSQL ◄──────────────┘   │
      │                 (users, conversations,           │
      │                  conversation_participants)      │
      │                                                  │
      └──────────────────► MongoDB ◄─────────────────────┘
                         (messages)
```

The key property: **the Node processes hold no authoritative state**. A client can
reconnect to a different instance and still be authenticated (the JWT verifies
locally) and still receive history (MongoDB).

### Why two databases?

- **PostgreSQL** stores data that benefits from relationships and constraints:
  unique usernames, conversation ownership, and a participant join table.
- **MongoDB** stores messages. Messages are append-only, high volume, and always
  read as "messages for one conversation". A document per message fits well.
- There is **no cross-database foreign key**. `Message.conversationId` references
  `ConversationEntity.id` by convention, so services must check membership before
  touching messages.

---

## 4. Authentication and authorization

### 4.1 Authentication vs authorization

- **Authentication** = *who are you?* → verifying credentials and a JWT.
- **Authorization** = *what may you do?* → checking conversation membership and
  message ownership.

The code keeps them separate: `AuthService`/`JwtAuthGuard` handle identity;
`ConversationsService`/`MessagesService` handle permissions.

### 4.2 Registration and login

```
POST /auth/register { username, password }
        │
        ▼
ValidationPipe (class-validator)        // username/password format
        │
        ▼
UsersService.createUser()
        │
        ├─ PasswordService.hash(password)      // scrypt + random salt
        └─ INSERT INTO users (password = hash)
        │
        ▼
AuthService.createSession()
        │
        └─ JwtService.signAsync({ sub: user.id, username })
        │
        ▼
{ accessToken, tokenType: "Bearer", user: { id, username, createdAt } }
```

Login follows the same shape:

1. `UsersService.validateCredentials()` loads the user **with** the password hash
   (`addSelect`, because the column is `select: false`).
2. `PasswordService.verify()` compares with `timingSafeEqual`.
3. Unknown user and wrong password both return the same
   `401 Invalid username or password`.

Passwords are stored as `scrypt$<salt-hex>$<hash-hex>`. Plaintext is never stored,
logged, or returned. The JWT contains only `sub` (user id), `username`, `iat`, and
`exp` — never the password.

### 4.3 How a request is authenticated

`JwtAuthGuard` is registered **globally** in `AppModule`:

```ts
{ provide: APP_GUARD, useClass: JwtAuthGuard }
```

That means every controller route and every `@SubscribeMessage` handler is
protected by default. The guard runs this sequence:

```
guarded request/event
        │
        ├─ @Public()? ── yes ──► allow
        │
        ├─ find token
        │    HTTP : Authorization: Bearer <token>
        │    WS   : handshake.auth.token or handshake Authorization header
        │
        ├─ JwtService.verifyAsync(token)
        │    signature + expiry checked
        │
        ├─ attach identity
        │    HTTP : request.user = { id, username }
        │    WS   : socket.data.user = { id, username }
        │
        └─ continue, or 401 / WsException("Unauthorized")
```

`@Public()` is used only by `GET /` and the two `/auth/*` routes. A new controller
is therefore secure even if the developer forgets to add a guard.

Controllers read the identity with `@CurrentUser()`:

```ts
@Get('me')
me(@CurrentUser() user: AuthUser) { ... }

@Get(':id')
findOne(@CurrentUser('id') userId: number) { ... }
```

### 4.4 Authorization rules

| Action | Rule | Enforced in |
| --- | --- | --- |
| `GET /users/me` | Any authenticated user | `JwtAuthGuard` |
| `POST /conversations` | Authenticated; all participant ids must exist | `ConversationsService.create` |
| `GET /conversations` | Only conversations you participate in | `findAllForUser` |
| `GET /conversations/:id` | Participant only | `findOneForUser` |
| `PATCH /conversations/:id` | Owner only | `assertOwner` |
| `DELETE /conversations/:id` | Owner only | `assertOwner` |
| `conversation:join` (WS) | Participant only | `assertMember` |
| `POST /messages` | Participant of the target conversation | `assertMember` |
| `GET /messages?conversationId=` | Participant only | `assertMember` |
| `GET /messages/:id` | Participant of the message's conversation | `assertMember` |
| `PATCH /messages/:id` | Sender only (and a participant) | `senderId === userId` |
| `DELETE /messages/:id` | Sender only (and a participant) | `senderId === userId` |
| `message:send` (WS) | Participant; `senderId` always comes from the JWT | `assertMember` + guard |

Error semantics:

- `401 Unauthorized` — missing, malformed, expired, or forged token.
- `403 Forbidden` — valid user, but not a member/owner/sender.
- `404 Not Found` — user, conversation, or message does not exist.

Because the sender id comes from the verified token, a client **cannot** post or
edit messages as another user by sending a `senderId` in the payload. The
WebSocket payload no longer accepts `senderId` at all.

### 4.5 Authenticating a WebSocket client

The HTTP handshake performs authentication; the token is sent in the Socket.IO
`auth` object:

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: { token: accessToken },
});
```

The global guard verifies the token for **each** event and stores the user on
`socket.data.user`. Unauthenticated clients may open a transport connection, but
every join/send event will be rejected until a valid token is supplied.

---

## 5. How the real-time scaling works

### Without the Redis adapter

Socket.IO keeps a room's members in the memory of **one** Node process. If Alice
is on Node #1 and Bob on Node #2, and both join `room:42`, Node #1 has no idea Bob
exists. A broadcast from Node #1 never reaches Bob.

### With the Redis adapter

`RedisIoAdapter` (`src/chat/redis-io.adapter.ts`) plugs Redis into Socket.IO:

1. Every Node instance creates **two** Redis connections:
   - `pubClient` publishes packets.
   - `subClient` subscribes. (A Redis connection in subscriber mode cannot run
     normal commands, so a duplicate connection is required.)
2. All instances subscribe to the same channel namespace (`key: 'chatapp-socket'`).
3. When Node #1 emits to `room:42`, Redis delivers the packet to **every**
   subscribed Node, and each Node forwards it to the sockets **it** owns in that
   room.

Authentication and authorization happen **before** the broadcast. Redis only
fans out events that a handler already authorized.

> If Redis is down, the adapter logs a warning and falls back to the in-memory
> adapter. The app still starts, but cross-instance broadcast stops working. That
> fallback is for local development, not production.

**Load-balancer requirement:** Socket.IO's HTTP polling transport needs sticky
sessions. Once upgraded to WebSockets, any instance can serve the connection, but
the initial handshake must be consistent.

---

## 6. Project structure

```
src/
├── main.ts                          # Bootstraps Nest, ValidationPipe, Redis adapter, listen
├── app.module.ts                    # Composition root: config, DBs, auth, global guard
├── app.controller.ts                # Public GET / health route
├── app.service.ts                   # Health route logic
│
├── auth/                            # Authentication (identity)
│   ├── auth.module.ts               # @Global: JwtModule + AuthService
│   ├── auth.controller.ts           # Public POST /auth/register, /auth/login
│   ├── auth.service.ts              # Register/login + JWT issuing
│   ├── dto/                         # RegisterDto, LoginDto
│   ├── decorators/                  # @Public(), @CurrentUser()
│   ├── guards/jwt-auth.guard.ts     # Global HTTP + WS JWT guard
│   └── types/auth-user.ts           # AuthUser + JwtPayload
│
├── chat/                            # Real-time (WebSocket) feature
│   ├── chat.module.ts               # Gateway + Mongo model + ConversationsModule
│   ├── chat.gateway.ts              # Authenticated join/send handlers
│   ├── chat.service.ts              # Placeholder for future chat logic
│   └── redis-io.adapter.ts          # Socket.IO <-> Redis pub/sub adapter
│
├── users/                           # Users + credentials
│   ├── users.module.ts              # UserEntity repo + PasswordService
│   ├── users.controller.ts          # GET /users/me
│   ├── users.service.ts             # Create/validate users, public serialization
│   ├── users.entity.ts              # PostgreSQL "users" table (password select:false)
│   └── password.service.ts          # scrypt hashing + timing-safe verify
│
├── conversations/                   # Conversation CRUD + authorization
│   ├── conversations.module.ts
│   ├── conversations.controller.ts  # Protected /conversations routes
│   ├── conversations.service.ts     # Membership + owner checks
│   ├── conversation.entity.ts       # ownerId + participants join table
│   └── dto/                         # Create/Update DTOs
│
├── messages/                        # Message data + REST API
│   ├── messages.module.ts
│   ├── messages.controller.ts       # Protected /messages routes
│   ├── messages.service.ts          # Membership + sender ownership checks
│   ├── message.entity.ts            # Legacy placeholder (unused)
│   ├── schemas/message.schema.ts    # MongoDB "messages" schema
│   └── dto/                         # Create/Update DTOs
│
└── database/                        # Empty placeholders; real config is in app.module.ts
    ├── mongo.module.ts
    └── postgres.module.ts
```

Tests live next to their source (e.g. `src/users/password.service.spec.ts`).

---

## 7. Guided code tour

Read the files in this order. Each step builds on the previous one.

### Step 1 — Startup: `src/main.ts`

```ts
const app = await NestFactory.create(AppModule);   // build the DI container
app.useGlobalPipes(new ValidationPipe({ ... }));   // validate DTOs
const redisIoAdapter = new RedisIoAdapter(...);    // prepare Redis pub/sub
await redisIoAdapter.connectToRedis();
app.useWebSocketAdapter(redisIoAdapter);           // replace default WS adapter
await app.listen(port);                            // start HTTP + WebSocket
```

**What to notice:** validation and the WS adapter are installed *before*
`listen()`. Nest creates the Socket.IO server during `listen()`, so the custom
adapter must already be in place.

### Step 2 — Composition root: `src/app.module.ts`

`AppModule` imports:

1. `ConfigModule` — loads `.env` and makes `ConfigService` global.
2. `AuthModule` — global JWT configuration (`JwtModule`).
3. `TypeOrmModule.forRootAsync()` — one shared PostgreSQL connection.
4. `MongooseModule.forRootAsync()` — one shared MongoDB connection.
5. Feature modules (`UsersModule`, `ConversationsModule`, `MessagesModule`,
   `ChatModule`).

It also registers `APP_GUARD → JwtAuthGuard`, which is what makes authentication
the default for the whole app.

**Nest concept to learn here:** `forRoot` configures a shared connection at the
root; `forFeature` registers module-scoped providers (repositories/models). That
is why the Mongoose `Message` schema is registered in both `ChatModule` and
`MessagesModule` — the two modules that inject it.

### Step 3 — Authentication: `src/auth/*` and `src/users/password.service.ts`

```
POST /auth/register
        │
        ▼
AuthController → AuthService → UsersService → PasswordService
                                      │
                                      └─ scrypt hash → PostgreSQL
        │
        ▼
JwtService.signAsync({ sub, username }) → accessToken
```

Protected requests then pass through `JwtAuthGuard`, which verifies the token and
attaches `{ id, username }` to the request/socket. Read `jwt-auth.guard.ts` first:
it is the bridge between HTTP, WebSockets, and the rest of the app.

### Step 4 — A protected HTTP feature: `src/conversations/*`

```
POST /conversations
        │
        ▼
JwtAuthGuard                  // 401 if no valid token
        │
        ▼
ConversationsController       // userId comes from @CurrentUser('id')
        │
        ▼
ConversationsService.create() // validate participants, save owner + members
        │
        ▼
PostgreSQL conversations + conversation_participants
```

`findOneForUser`, `update`, and `remove` show the authorization pattern:
load the resource, verify membership/ownership, then act. `assertMember()` is
exported through the service so other modules can reuse it.

### Step 5 — The real-time feature: `src/chat/chat.gateway.ts`

```
conversation:join  ──► guard → assertMember → client.join("room:<id>")
message:send       ──► guard → assertMember → Mongo insert
                   ──► server.to("room:<id>").emit(...) // Redis fans out
```

`ChatGateway` is the WebSocket equivalent of a controller. It never trusts a
`senderId` from the client: the author is `socket.data.user.id` from the JWT.

### Step 6 — The scaling glue: `src/chat/redis-io.adapter.ts`

Subclasses Nest's `IoAdapter`, connects two `ioredis` clients, and attaches the
official Socket.IO Redis adapter to the server Nest creates. Read the comments at
the top of the file for the multi-instance explanation.

---

## 8. File-by-file reference

| File | What it does | Key concept |
| --- | --- | --- |
| `src/main.ts` | Validation pipe, Redis adapter, listen | Bootstrap, top-level await |
| `src/app.module.ts` | Wires config, DBs, features, global guard | Composition root, `APP_GUARD` |
| `src/app.controller.ts` | Public `GET /` | `@Public()` |
| `src/app.service.ts` | Returns `"Hello World!"` | Injectable service |
| `src/auth/auth.module.ts` | Global JWT module + auth controller | `@Global`, `JwtModule.registerAsync` |
| `src/auth/auth.controller.ts` | `POST /auth/register`, `POST /auth/login` | Public endpoints |
| `src/auth/auth.service.ts` | Register/login + sign JWT | JWT payload `{ sub, username }` |
| `src/auth/guards/jwt-auth.guard.ts` | Verifies token for HTTP + WS | `CanActivate`, `WsException` |
| `src/auth/decorators/public.decorator.ts` | Opt out of auth | `SetMetadata`, `Reflector` |
| `src/auth/decorators/current-user.decorator.ts` | Injects `request.user` | `createParamDecorator` |
| `src/auth/types/auth-user.ts` | `AuthUser`, `JwtPayload` | Never put secrets in a token |
| `src/auth/dto/register.dto.ts` | Username/password validation | `class-validator` |
| `src/auth/dto/login.dto.ts` | Login body | Generic 401 on failure |
| `src/users/password.service.ts` | scrypt hash + timing-safe verify | Salt, key derivation |
| `src/users/users.entity.ts` | `users` table | `select: false` on password |
| `src/users/users.service.ts` | Create/validate/serialize users | PasswordHash, unique constraint |
| `src/users/users.controller.ts` | `GET /users/me` | `@CurrentUser()` |
| `src/users/users.module.ts` | Repo + password provider | `TypeOrmModule.forFeature` |
| `src/conversations/conversation.entity.ts` | Owner + participants relation | `@ManyToMany`, `@JoinTable` |
| `src/conversations/conversations.service.ts` | CRUD + membership/owner checks | Authorization in the service |
| `src/conversations/conversations.controller.ts` | Protected conversation routes | `ParseIntPipe`, `@CurrentUser` |
| `src/conversations/dto/*.ts` | Participant validation | `@IsInt({ each: true })` |
| `src/conversations/conversations.module.ts` | Conversation feature | Imports `UsersModule` |
| `src/messages/schemas/message.schema.ts` | Mongo message document | `@Schema`, `@Prop`, index |
| `src/messages/messages.service.ts` | Message CRUD + authorization | Membership + sender ownership |
| `src/messages/messages.controller.ts` | Protected message routes | Query params, pagination |
| `src/messages/messages.module.ts` | Message REST feature | Imports `ConversationsModule` |
| `src/messages/message.entity.ts` | Legacy placeholder, unused | Kept for compatibility |
| `src/messages/dto/*.ts` | Message body validation | `senderId` deliberately absent |
| `src/chat/chat.gateway.ts` | Authenticated join/send | `socket.data.user`, `assertMember` |
| `src/chat/chat.module.ts` | Gateway + model + conversations | Module-scoped providers |
| `src/chat/redis-io.adapter.ts` | Redis pub/sub for Socket.IO | Horizontal scaling |
| `src/database/*.ts` | Empty placeholders | Real config is in `AppModule` |

Every source file contains inline comments explaining its responsibilities,
security decisions, and non-obvious behavior.

---

## 9. Data models

### PostgreSQL: `users`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | serial | Primary key |
| `username` | varchar | Unique; 3–32 chars, `[a-zA-Z0-9_]` |
| `password` | varchar | **scrypt hash** (`scrypt$salt$hash`), `select: false` |
| `createdAt` | timestamp | Auto-filled |

### PostgreSQL: `conversations`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | serial | Primary key; referenced by messages |
| `ownerId` | integer | User who may update/delete |
| `createdAt` | timestamp | Auto-filled |

### PostgreSQL: `conversation_participants`

Join table created by TypeORM's `@JoinTable`.

| Column | Notes |
| --- | --- |
| `conversationId` | FK → `conversations.id` |
| `userId` | FK → `users.id` |

A user may read/post in a conversation iff they appear here (the owner is also
inserted as a participant on creation).

### MongoDB: `messages`

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | ObjectId | Mongo primary key |
| `conversationId` | number | Indexed; references `conversations.id` |
| `senderId` | number | References `users.id`, taken from the JWT |
| `body` | string | 1–4000 chars |
| `type` | string | Defaults to `"text"` |
| `createdAt` / `updatedAt` | date | Added by `timestamps: true` |

---

## 10. Runtime flows

### 10.1 HTTP request

```
Client ──Bearer JWT──► JwtAuthGuard ──► Controller ──► Service ──► DB
                            │
                            ├─ invalid/missing token → 401
                            │
                            └─ request.user = { id, username }
                                     │
                                     └─ @CurrentUser() supplies the user id
```

### 10.2 Registration

```
POST /auth/register { username, password }
        │
        ▼
ValidationPipe → AuthController → AuthService
        │
        ▼
UsersService.createUser()
        ├─ PasswordService.hash()          // scrypt + salt
        └─ save user (hash only)
        │
        ▼
JwtService.signAsync({ sub, username })
        │
        ▼
201 { accessToken, tokenType: "Bearer", user }
```

### 10.3 Joining a conversation (WebSocket)

```
Client emits "conversation:join" { conversationId: 42 }
  (handshake auth: { token })
        │
        ▼
JwtAuthGuard.verifyAsync(token) → socket.data.user
        │
        ▼
ChatGateway.handleJoinConversation()
        │
        ▼
ConversationsService.assertMember(42, user.id)
        │
        ├─ not a member → WsException("Forbidden")
        │
        ▼
client.join("room:42")
        │
        ▼
acknowledgement { conversationId: 42, joined: true }
```

### 10.4 Sending a message across instances

```
Client (Node #1) emits "message:send" { conversationId: 42, body }
        │
        ▼
JwtAuthGuard → socket.data.user
        │
        ▼
authorize: assertMember(42, user.id)
        │
        ▼
ChatGateway.handleMessageSend()
        │
        ├─► Mongo: insert { senderId: user.id, body, ... }
        │
        └─► server.to("room:42").emit("message:new", savedMessage)
                    │
                    ▼
              Redis pub/sub
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
   Node #1                  Node #2
   local members           local members
   receive "message:new"   receive "message:new"
```

---

## 11. API reference

All routes except `GET /`, `POST /auth/register`, and `POST /auth/login` require:

```
Authorization: Bearer <accessToken>
```

### Auth

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | `{ "username": "alice", "password": "secret123" }` | `201` + token |
| `POST` | `/auth/login` | `{ "username": "alice", "password": "secret123" }` | `200` + token |

Both return:

```json
{
  "accessToken": "<jwt>",
  "tokenType": "Bearer",
  "user": { "id": 1, "username": "alice", "createdAt": "..." }
}
```

### Users

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/users/me` | Current authenticated user |

### Conversations

| Method | Path | Body / query | Rule |
| --- | --- | --- | --- |
| `POST` | `/conversations` | `{ "participantIds": [2, 3] }` | any authenticated user |
| `GET` | `/conversations` | — | returns only your conversations |
| `GET` | `/conversations/:id` | — | participant |
| `PATCH` | `/conversations/:id` | `{ "participantIds": [2, 4] }` | owner |
| `DELETE` | `/conversations/:id` | — | owner |

The creator is added as owner and participant automatically. The owner remains a
participant when `participantIds` is replaced; message documents are not deleted
when a conversation is removed.

### Messages (REST)

| Method | Path | Body / query | Rule |
| --- | --- | --- | --- |
| `POST` | `/messages` | `{ "conversationId": 1, "body": "hi" }` | participant |
| `GET` | `/messages?conversationId=1&limit=50` | — | participant |
| `GET` | `/messages/:id` | — | participant |
| `PATCH` | `/messages/:id` | `{ "body": "edited" }` | sender |
| `DELETE` | `/messages/:id` | — | sender |

`limit` defaults to 50 and is clamped to 1–100. Results are newest first.

### WebSocket events

| Direction | Event | Payload |
| --- | --- | --- |
| client → server | `conversation:join` | `{ conversationId }` |
| client → server | `message:send` | `{ conversationId, body }` |
| server → client | `message:new` | saved message document |

`senderId` is **not** accepted from clients; it always comes from the JWT.

---

## 12. Configuration

Configuration is read from `.env` by `ConfigModule`. Lookup order is `.env` in the
project root first, then `src/.env` (see `envFilePath` in `app.module.ts`).
A tracked template lives in `.env.example`.

| Variable | Default in code | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/WebSocket port |
| `POSTGRES_HOST` | `localhost` | PostgreSQL host |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_USER` | `postgres` | PostgreSQL user |
| `POSTGRES_PASSWORD` | `secret` | PostgreSQL password (use a real one) |
| `POSTGRES_DB` | `chatapp` | PostgreSQL database |
| `MONGO_URI` | `mongodb://localhost:27017/chatapp` | MongoDB connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `JWT_SECRET` | dev-only fallback | HMAC key for signing tokens |
| `JWT_EXPIRES_IN` | `1d` | Token lifetime (e.g. `15m`, `7d`) |

> ⚠️ The development fallback for `JWT_SECRET` is a well-known string. Anyone who
> knows it can forge tokens. Set a long random value in every real environment
> (`openssl rand -hex 32`). The app refuses to start without it when
> `NODE_ENV=production`.

---

## 13. Running the project

### Prerequisites

- Node.js 20+ (ES modules and top-level `await`)
- PostgreSQL
- MongoDB
- Redis (optional: without it the app starts in single-instance mode)

### Quick-start the dependencies with Docker

```bash
docker run -d --name chat-postgres -p 5432:5432 \
  -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=chatapp postgres:16

docker run -d --name chat-mongo -p 27017:27017 mongo:7

docker run -d --name chat-redis -p 6379:6379 redis:7
```

### Start the app

```bash
cp .env.example .env      # then edit JWT_SECRET
npm install
npm run start:dev         # watch mode
```

Expected startup logs:

```
[Nest] ... AppModule dependencies initialized
[Nest] ... RedisIoAdapter  Socket.IO connected to Redis adapter.
Server running on http://localhost:3000
```

If Redis is not running you will see the warning about the in-memory fallback
instead. That is expected.

> Because `synchronize: true` is enabled, the first start creates the `users`,
> `conversations`, and `conversation_participants` tables. If you previously ran
> the pre-auth version, drop the old tables (or the database) once so the new
> `ownerId`/join-table schema can be created cleanly.

### Try the HTTP API

```bash
# 1. Register (returns a token)
curl -s -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"secret123"}'

# 2. Log in
curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"secret123"}'

# 3. Use the token
TOKEN="<accessToken from the response>"

curl http://localhost:3000/users/me \
  -H "Authorization: Bearer $TOKEN"

# 4. Create a conversation (participant 2 must exist)
curl -X POST http://localhost:3000/conversations \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"participantIds":[2]}'

# 5. Send/read messages over REST
curl -X POST http://localhost:3000/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"conversationId":1,"body":"hello"}'

curl "http://localhost:3000/messages?conversationId=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

Expected authorization failures:

```bash
# No token → 401
curl http://localhost:3000/users/me

# Valid token, not a participant → 403
curl http://localhost:3000/conversations/999 \
  -H "Authorization: Bearer $TOKEN"
```

### Try the WebSocket API

`socket.io-client` is installed as a dev dependency. Save this as a script and
run it with `node`:

```js
import { io } from 'socket.io-client';

const accessToken = '<accessToken from /auth/login>';

const socket = io('http://localhost:3000', {
  auth: { token: accessToken },
});

socket.on('connect', () => {
  socket.emit('conversation:join', { conversationId: 1 });
  socket.emit('message:send', {
    conversationId: 1,
    body: 'hello room',
  });
});

socket.on('message:new', (message) => {
  console.log('received:', message);
});

socket.on('exception', (error) => {
  console.error('socket error:', error); // e.g. not a member
});
```

To prove Redis scaling, run two instances on different ports, connect one client
to each with valid tokens, join the same conversation, and send a message. Both
clients should receive it.

---

## 14. Design decisions and trade-offs

| Decision | Benefit | Trade-off |
| --- | --- | --- |
| JWT instead of server sessions | Works across stateless instances; no shared session store | Revocation needs extra work (short expiry, denylist, or refresh tokens) |
| Global guard + `@Public()` | Secure by default; new routes cannot be forgotten | Auth routes must explicitly opt out |
| scrypt from Node core | Memory-hard hashing with no native dependency | Tuning params is manual; no automatic rehash on login |
| Password column `select: false` | Accidental queries cannot leak hashes | Login must explicitly `addSelect` |
| Membership stored in a join table | Relational integrity, easy "my conversations" query | Extra join per authorization check |
| Owner + participant roles | Simple, understandable permission model | No moderator/admin roles yet |
| Separate Postgres and Mongo | Each store does what it is best at | No cross-DB transactions |
| Redis adapter | Stateless instances scale horizontally | Extra infrastructure; sticky sessions at the LB |
| `synchronize: true` | Zero-setup local schema | Can alter/drop data; never use in production |
| Server-side broadcast | Sender and others see the same canonical document | Sender gets no optimistic UI |

---

## 15. Known gaps / production checklist

**Authentication / security**

- [ ] Add refresh tokens and a logout/revocation strategy (JWTs cannot be revoked
      before they expire by default).
- [ ] Add roles/permissions if moderation or admin features are needed.
- [ ] Add rate limiting (login brute force, message spam, WS events).
- [ ] Restrict WebSocket CORS (`origin: '*'` today).
- [ ] Add email verification and password reset.
- [ ] Rotate `JWT_SECRET` and support key ids (`kid`) for zero-downtime rotation.
- [ ] Consider rehashing passwords on login when scrypt parameters change.

**Correctness / features**

- [ ] Add cursor-based message pagination (`before`/`after`) instead of limit-only.
- [ ] Delete or archive Mongo messages when a conversation is deleted.
- [ ] Return richer conversation data (title, last message, unread count).
- [ ] Add a `messages:history` WebSocket event for clients that never use REST.
- [ ] Delete `src/messages/message.entity.ts` and the empty `src/database/*` files,
      or turn them into real modules.

**Operations**

- [ ] Replace `synchronize: true` with TypeORM migrations.
- [ ] Add health/readiness endpoints that check Postgres, Mongo, and Redis.
- [ ] Add structured logging, metrics, and tracing (never log tokens/passwords).
- [ ] Add e2e tests for auth, authorization, and WebSocket events.
- [ ] Add graceful shutdown for Redis/DB connections.
- [ ] Run multiple instances behind a load balancer with sticky sessions.

---

## 16. Glossary

| Term | Meaning |
| --- | --- |
| **Authentication** | Proving identity ("who are you?"). |
| **Authorization** | Checking permissions ("may you do this?"). |
| **JWT** | Signed token containing claims; verified without a DB lookup. |
| **Claim** | A field inside a JWT, e.g. `sub`, `iat`, `exp`. |
| **Guard** | Nest class that decides whether a request/event may proceed. |
| **`@Public()`** | Metadata that makes a route skip the global auth guard. |
| **Hash / salt** | One-way password transformation with a random per-password value. |
| **scrypt** | Memory-hard key derivation function used for passwords. |
| **Module** | A Nest class that groups related providers/controllers. |
| **Provider** | A class Nest can inject (service, repository, gateway, factory). |
| **Controller** | Handles incoming HTTP requests and returns responses. |
| **Gateway** | Handles WebSocket events; the WebSocket analogue of a controller. |
| **DTO** | Data Transfer Object: the validated shape of a request body. |
| **Entity** | A TypeORM class mapped to a relational table. |
| **Schema** | A Mongoose class that defines a MongoDB document shape. |
| **Repository** | TypeORM object with query helpers for one entity. |
| **Model** | Mongoose object with query helpers for one schema. |
| **Room** | A Socket.IO group of sockets; used here per conversation. |
| **Pub/sub** | Publish/subscribe messaging; Redis forwards events between servers. |
| **Sticky session** | Load-balancer rule that sends a client to the same instance. |

---

## 17. Scripts

```bash
npm run start        # start once
npm run start:dev    # start with file watching
npm run start:prod   # run the compiled build from dist/
npm run build        # compile TypeScript
npm run lint         # oxlint
npm run format       # prettier
npm test             # vitest unit tests (password hashing)
npm run test:e2e     # vitest e2e tests (none yet)
npm run test:cov     # coverage
```
