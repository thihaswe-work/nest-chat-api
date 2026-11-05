# Scaling Messenger

A small NestJS backend that demonstrates the hard part of building a chat app:
**letting many WebSocket server instances work together as if they were one**.

Clients connect over Socket.IO, join a conversation "room", and exchange messages.
Message history is stored in MongoDB, users and conversations in PostgreSQL, and
Redis is used as the pub/sub bus that keeps all app instances in sync.

This README is written for someone new to the codebase. Read the
[guided code tour](#guided-code-tour) first, then use the
[file-by-file reference](#file-by-file-reference) while exploring.

---

## 1. What the app can do today

| Feature | Status | Where |
| --- | --- | --- |
| HTTP health check (`GET /`) | ✅ Working | `app.controller.ts` |
| Register a user (`POST /users`) | ✅ Working (no hashing/auth yet) | `users/*` |
| Join a chat room over WebSockets | ✅ Working | `chat/chat.gateway.ts` |
| Send a message and broadcast it to the room | ✅ Working | `chat/chat.gateway.ts` |
| Message persistence | ✅ Working (MongoDB) | `messages/schemas/message.schema.ts` |
| Multi-instance WebSocket scaling | ✅ Working when Redis is available | `chat/redis-io.adapter.ts` |
| Conversations REST CRUD | 🚧 Scaffold only (returns strings) | `conversations/*` |
| Messages REST CRUD | 🚧 Scaffold only (returns strings) | `messages/*` |
| Authentication / authorization | ❌ Not implemented | — |
| Input validation | ❌ Not implemented | — |

> The scaffolded routes return placeholder strings. The **real message write
> path is the WebSocket gateway**, not the REST controller.

---

## 2. Technology stack

| Technology | Role in this project | Why |
| --- | --- | --- |
| **NestJS** | Application framework | Modules, dependency injection, controllers, gateways |
| **TypeScript** | Language | Types + decorators for Nest/TypeORM/Mongoose |
| **PostgreSQL + TypeORM** | Relational data | Users and conversations, unique constraints |
| **MongoDB + Mongoose** | Message history | High-volume, flexible documents, no joins needed |
| **Redis + Socket.IO adapter** | Cross-instance pub/sub | Lets N servers broadcast to each other |
| **Vitest** | Tests (config exists, none written yet) | Fast unit/e2e runs |
| **Oxlint / Prettier** | Lint / formatting | Consistent code style |

---

## 3. Architecture at a glance

```
                    ┌──────────────────────┐
                    │   Browser / Client   │
                    │  HTTP + Socket.IO    │
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
   └──┬───┬───┬──┘      └──┬───┬───┬──┘      └──┬───┬───┬──┘
      │   │   │            │   │   │            │   │   │
      │   │   └────────────┴───┴───┴────────────┘   │   │
      │   │                  Redis pub/sub           │   │
      │   │                (Socket.IO adapter)       │   │
      │   │                                          │   │
      │   └──────────────► PostgreSQL ◄──────────────┘   │
      │                   (users, conversations)         │
      │                                                  │
      └──────────────────► MongoDB ◄─────────────────────┘
                         (messages)
```

The key property: **the Node processes hold no authoritative state**. A client can
reconnect to a different instance and still receive the conversation's messages,
because history lives in MongoDB and fan-out lives in Redis.

### Why two databases?

This is intentional, not an accident of the starter template:

- **PostgreSQL** stores data that benefits from relationships and constraints.
  Usernames must be unique; conversations may later need participants and joins.
- **MongoDB** stores messages. Messages are append-only, very high volume, and are
  always read as "all messages for one conversation". A document per message is a
  natural fit and scales horizontally with sharding.
- There is **no cross-database foreign key**. `Message.conversationId` references
  `ConversationEntity.id` by convention only, so the application must keep it
  consistent.

---

## 4. How the real-time scaling works

This is the most important idea in the repository.

### Without the Redis adapter

Socket.IO keeps a room's members in the memory of **one** Node process. If Alice
is connected to Node #1 and Bob to Node #2, and both join `room:42`, Node #1 has
no idea Bob exists. A broadcast from Node #1 never reaches Bob.

### With the Redis adapter

`RedisIoAdapter` (`src/chat/redis-io.adapter.ts`) plugs Redis into Socket.IO:

1. Every Node instance creates **two** Redis connections:
   - `pubClient` publishes packets.
   - `subClient` subscribes. (A Redis connection in subscriber mode cannot run
     normal commands, so a duplicate connection is required.)
2. Each instance subscribes to the same Redis channel namespace (`key: 'chatapp-socket'`).
3. When Node #1 emits to `room:42`, the packet is published to Redis. Redis
   delivers it to **every** subscribed Node, and each Node forwards it to the
   sockets **it** owns that are in `room:42`.

Result: Alice and Bob receive the same message even though they are on different
servers.

> If Redis is down, the adapter logs a warning and falls back to Socket.IO's
> in-memory adapter. The app still starts, but cross-instance broadcast stops
> working. That fallback is for local development, not production.

**Load-balancer requirement:** Socket.IO's HTTP polling transport needs sticky
sessions (route each client to the same instance). Once the connection upgrades
to WebSockets, any instance can serve it, but the initial handshake must be
consistent.

---

## 5. Project structure

```
src/
├── main.ts                          # Bootstraps Nest, attaches the Redis adapter, listens
├── app.module.ts                    # Composition root: config + DB connections + features
├── app.controller.ts                # GET / health route
├── app.service.ts                   # Health route logic
│
├── chat/                            # Real-time (WebSocket) feature
│   ├── chat.module.ts               # Registers ChatGateway + Mongo Message model
│   ├── chat.gateway.ts              # "conversation:join" and "message:send" handlers
│   ├── chat.service.ts              # Placeholder for future chat business logic
│   └── redis-io.adapter.ts          # Socket.IO <-> Redis pub/sub adapter
│
├── users/                           # HTTP user registration
│   ├── users.module.ts              # Registers UserEntity repository
│   ├── users.controller.ts          # POST /users
│   ├── users.service.ts             # createUser()
│   └── users.entity.ts              # PostgreSQL "users" table
│
├── conversations/                   # HTTP conversation CRUD (scaffold)
│   ├── conversations.module.ts
│   ├── conversations.controller.ts  # /conversations routes
│   ├── conversations.service.ts     # Stub methods
│   ├── conversation.entity.ts       # PostgreSQL "conversations" table
│   └── dto/                         # Request body shapes (empty for now)
│
├── messages/                        # Message data + REST scaffold
│   ├── messages.module.ts
│   ├── messages.controller.ts       # /messages routes (stubs)
│   ├── messages.service.ts          # Stub methods
│   ├── message.entity.ts            # Legacy placeholder (unused)
│   ├── schemas/message.schema.ts    # MongoDB "messages" schema (real)
│   └── dto/
│
└── database/                        # Empty placeholders; real config is in app.module.ts
    ├── mongo.module.ts
    └── postgres.module.ts
```

There is **no `test/` directory yet**, even though the npm scripts are configured.

---

## 6. Guided code tour

Read the files in this order. Each step builds on the previous one.

### Step 1 — Startup: `src/main.ts`

```ts
const app = await NestFactory.create(AppModule);   // build the DI container
const configService = app.get(ConfigService);      // read .env
const redisIoAdapter = new RedisIoAdapter(...);    // prepare Redis pub/sub
await redisIoAdapter.connectToRedis();
app.useWebSocketAdapter(redisIoAdapter);           // replace default WS adapter
await app.listen(port);                            // start HTTP + WebSocket
```

**What to notice:** the adapter is installed *before* `listen()`. Nest creates the
Socket.IO server during `listen()`, so the custom adapter must already be in place.

### Step 2 — Composition root: `src/app.module.ts`

`AppModule` imports four things:

1. `ConfigModule` — loads `.env` and makes `ConfigService` global.
2. `TypeOrmModule.forRootAsync()` — one shared PostgreSQL connection.
3. `MongooseModule.forRootAsync()` — one shared MongoDB connection.
4. Feature modules (`UsersModule`, `ConversationsModule`, `MessagesModule`, `ChatModule`).

**Nest concept to learn here:** `forRoot` configures a shared connection at the
root; `forFeature` registers module-scoped providers (repositories/models).
That is why the Mongoose `Message` schema is registered in `ChatModule`, the
module that actually injects it.

### Step 3 — A normal HTTP feature: `src/users/*`

```
POST /users
   │
   ▼
UsersController.register()        // reads the body
   │
   ▼
UsersService.createUser()         // repository.create() + repository.save()
   │
   ▼
PostgreSQL "users" table
```

The controller knows nothing about the database. The service knows nothing about
HTTP. That separation is the standard Nest layering pattern.

### Step 4 — A scaffolded HTTP feature: `src/conversations/*` and `src/messages/*`

The controller methods and routes are complete, but the service methods return
strings such as `"This action returns all conversations"`. They are placeholders
generated by the Nest CLI. The comments in those files explain exactly what to
replace to make them real.

### Step 5 — The real-time feature: `src/chat/chat.gateway.ts`

```
conversation:join  ──► client.join("room:<id>")
message:send       ──► messageModel.create(...)        // MongoDB
                   ──► server.to("room:<id>").emit(...) // Redis fans out
```

`ChatGateway` is the WebSocket equivalent of a controller. `@SubscribeMessage`
maps event names to methods; `@WebSocketServer()` exposes the Socket.IO server
used for broadcasting.

### Step 6 — The scaling glue: `src/chat/redis-io.adapter.ts`

This is the only infrastructure-specific piece. It subclasses Nest's `IoAdapter`,
connects two `ioredis` clients, and attaches the official Socket.IO Redis adapter
to the server Nest creates. Read the comments at the top of the file for the
multi-instance explanation.

---

## 7. File-by-file reference

| File | What it does | Key concept |
| --- | --- | --- |
| `src/main.ts` | Creates the app, installs Redis adapter, listens | Bootstrap, top-level await |
| `src/app.module.ts` | Wires config, PostgreSQL, MongoDB, features | Composition root, `forRoot` vs `forFeature` |
| `src/app.controller.ts` | `GET /` | Controller decorator |
| `src/app.service.ts` | Returns `"Hello World!"` | Injectable service |
| `src/chat/chat.module.ts` | Registers gateway + Mongo model | Module-scoped providers |
| `src/chat/chat.gateway.ts` | Join room, save + broadcast message | `@WebSocketGateway`, rooms |
| `src/chat/chat.service.ts` | Placeholder for future chat logic | Layering |
| `src/chat/redis-io.adapter.ts` | Redis pub/sub for Socket.IO | Horizontal scaling |
| `src/users/users.entity.ts` | `users` table definition | TypeORM entity |
| `src/users/users.service.ts` | Insert a user | `Repository.create/save` |
| `src/users/users.controller.ts` | `POST /users` | DTO-less body typing |
| `src/users/users.module.ts` | Registers repository | `TypeOrmModule.forFeature` |
| `src/conversations/conversation.entity.ts` | `conversations` table | TypeORM entity |
| `src/conversations/conversations.controller.ts` | Conversation CRUD routes | Route decorators, `+id` |
| `src/conversations/conversations.service.ts` | Stub CRUD | To be implemented |
| `src/conversations/conversations.module.ts` | Wires conversation feature | Feature module |
| `src/conversations/dto/*.ts` | Empty request shapes | DTO pattern |
| `src/messages/schemas/message.schema.ts` | Mongo message document | `@Schema`, `@Prop`, index |
| `src/messages/messages.controller.ts` | Message CRUD routes | REST scaffold |
| `src/messages/messages.service.ts` | Stub CRUD | To be implemented |
| `src/messages/messages.module.ts` | Wires message REST feature | Feature module |
| `src/messages/message.entity.ts` | Legacy placeholder, unused | Kept for compatibility |
| `src/messages/dto/*.ts` | Empty request shapes | DTO pattern |
| `src/database/*.ts` | Empty placeholders | Real config is in `AppModule` |

All source files contain inline comments explaining their responsibilities and
any non-obvious behavior.

---

## 8. Data models

### PostgreSQL: `users`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | serial | Primary key |
| `username` | varchar | Unique |
| `password` | varchar | **Stored as received; no hashing yet** |
| `createdAt` | timestamp | Auto-filled |

### PostgreSQL: `conversations`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | serial | Primary key; referenced by messages |
| `createdAt` | timestamp | Auto-filled |

### MongoDB: `messages`

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | ObjectId | Mongo primary key |
| `conversationId` | number | Indexed; references `conversations.id` |
| `senderId` | number | References `users.id` |
| `body` | string | Message text |
| `type` | string | Defaults to `"text"` |
| `createdAt` / `updatedAt` | date | Added by `timestamps: true` |

---

## 9. Runtime flows

### 9.1 HTTP request

```
Client ──HTTP──► Nest router ──► Controller ──► Service ──► TypeORM/Mongoose ──► DB
                                    │
                                    └── returns a value, serialized to JSON
```

### 9.2 Joining a conversation (WebSocket)

```
Client emits "conversation:join" { conversationId: 42 }
        │
        ▼
ChatGateway.handleJoinConversation()
        │
        ▼
client.join("room:42")          // membership stored on this socket
        │
        ▼
acknowledgement { conversationId: 42, joined: true }
```

### 9.3 Sending a message across instances

```
Client (Node #1) emits "message:send" { conversationId, senderId, body }
        │
        ▼
ChatGateway.handleMessageSend()
        │
        ├─► Mongo: insert document
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

## 10. Configuration

Configuration is read from `.env` by `ConfigModule`. Lookup order is
`.env` in the project root first, then `src/.env` (see `envFilePath` in
`app.module.ts`).

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

Create a `.env` in the project root (it is git-ignored):

```dotenv
PORT=3000
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=secret
POSTGRES_DB=chatapp
MONGO_URI=mongodb://localhost:27017/chatapp
REDIS_URL=redis://localhost:6379
```

---

## 11. Running the project

### Prerequisites

- Node.js 20+ (the project uses ES modules and top-level `await`)
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
npm install
npm run start:dev        # watch mode
```

Expected startup logs:

```
[Nest] ... AppModule dependencies initialized
[Nest] ... RedisIoAdapter  Socket.IO connected to Redis adapter.
Server running on http://localhost:3000
```

If Redis is not running you will see the warning about the in-memory fallback
instead. That is expected.

### Verify the HTTP side

```bash
curl http://localhost:3000/
# Hello World!

curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","passwordHash":"secret"}'
```

### Verify the WebSocket side

Use a Node script with `socket.io-client` (install it as a dev dependency first),
or a tool such as Postman/Socket.IO Inspector:

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');

socket.on('connect', () => {
  socket.emit('conversation:join', { conversationId: 42 });
  socket.emit('message:send', {
    conversationId: 42,
    senderId: 1,
    body: 'hello room',
  });
});

socket.on('message:new', (message) => {
  console.log('received:', message);
});
```

To prove Redis scaling, run two instances on different ports, connect one client
to each, join the same conversation, and send a message. Both clients should
receive it.

---

## 12. Design decisions and trade-offs

| Decision | Benefit | Trade-off |
| --- | --- | --- |
| Separate Postgres and Mongo | Each store does what it is best at | Two databases to operate; no cross-DB transactions |
| Redis adapter | Stateless app instances scale horizontally | Extra infrastructure; needs sticky sessions at the LB |
| Rooms named `room:<id>` | Simple, deterministic routing | No authorization check before joining |
| Mongoose indexes on `conversationId` | Fast per-conversation reads | Index write cost and memory |
| `synchronize: true` | Zero-setup local schema | Can drop/alter data; never use in production |
| Server-side broadcast | Sender and other clients see the same event | Sender does not get an optimistic UI |

---

## 13. Known gaps / production checklist

These are deliberately left for future work. Each is a good "first issue" for a
new contributor.

**Security**

- [ ] Hash passwords (argon2/bcrypt); never store plaintext.
- [ ] Add authentication (JWT or sessions) and derive `senderId` from the token.
- [ ] Authorize `conversation:join` and `message:send` (users must be members).
- [ ] Restrict WebSocket CORS (`origin: '*'` today).
- [ ] Add request validation with `class-validator` + `ValidationPipe`.
- [ ] Add rate limiting for HTTP and WebSocket events.

**Correctness / features**

- [ ] Implement `ConversationsService` and `MessagesService` (currently stubs).
- [ ] Add conversation participants and membership checks.
- [ ] Paginate message history; add a `messages:history` event or REST endpoint.
- [ ] Return 404/409 instead of generic 500s (not found, duplicate username).
- [ ] Validate numeric `:id` params with `ParseIntPipe`.
- [ ] Delete `src/messages/message.entity.ts` and the empty `src/database/*` files,
      or turn them into real modules.

**Operations**

- [ ] Replace `synchronize: true` with TypeORM migrations.
- [ ] Add health/readiness endpoints that check Postgres, Mongo, and Redis.
- [ ] Add structured logging, metrics, and tracing.
- [ ] Add unit tests and e2e tests (Vitest is configured but no tests exist).
- [ ] Add graceful shutdown for Redis/DB connections.
- [ ] Run multiple instances behind a load balancer with sticky sessions.

---

## 14. Glossary

| Term | Meaning |
| --- | --- |
| **Module** | A Nest class that groups related providers/controllers. |
| **Provider** | A class Nest can inject (service, repository, gateway, factory). |
| **Controller** | Handles incoming HTTP requests and returns responses. |
| **Gateway** | Handles incoming WebSocket events; the WebSocket analogue of a controller. |
| **DTO** | Data Transfer Object: the shape of a request body. |
| **Entity** | A TypeORM class mapped to a relational table. |
| **Schema** | A Mongoose class that defines a MongoDB document shape. |
| **Repository** | TypeORM object with query helpers for one entity. |
| **Model** | Mongoose object with query helpers for one schema. |
| **Room** | A Socket.IO group of sockets; used here per conversation. |
| **Pub/sub** | Publish/subscribe messaging; Redis forwards events between servers. |
| **Sticky session** | Load-balancer rule that sends a client to the same instance. |

---

## 15. Scripts

```bash
npm run start        # start once
npm run start:dev    # start with file watching
npm run start:prod   # run the compiled build from dist/
npm run build        # compile TypeScript
npm run lint         # oxlint
npm run format       # prettier
npm test             # vitest unit tests (none yet)
npm run test:e2e     # vitest e2e tests (none yet)
npm run test:cov     # coverage
```
