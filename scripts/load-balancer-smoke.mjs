#!/usr/bin/env node
/**
 * End-to-end load-balancer smoke test.
 *
 * It talks ONLY to the load balancer (default http://localhost:8080), never to
 * the app replicas directly. A pass therefore proves that HAProxy is:
 *
 *   1. spreading requests across both replicas (round robin)
 *   2. keeping a client on one replica when it sends the SERVERID cookie
 *   3. forwarding authenticated HTTP requests (JWT is accepted on any replica)
 *   4. tunneling WebSocket upgrades to different replicas
 *   5. letting a message sent through one replica reach a client connected to
 *      the other replica via the Redis adapter
 *
 * Prerequisites:
 *   docker compose up --build -d --wait
 *
 * Usage:
 *   npm run test:load-balancer
 *
 * Optional overrides:
 *   LB_URL=http://localhost:8080 LB_STATS_URL=http://localhost:8404 \
 *     npm run test:load-balancer
 *
 * This script creates temporary users/conversations in the compose database.
 */
import http from 'node:http';
import { io } from 'socket.io-client';

const LB_URL = (process.env.LB_URL ?? 'http://localhost:8080').replace(
  /\/$/,
  '',
);
const STATS_URL = (process.env.LB_STATS_URL ?? 'http://localhost:8404').replace(
  /\/$/,
  '',
);
const STARTUP_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const EVENT_TIMEOUT_MS = 6_000;

const lb = new URL(LB_URL);
const stats = new URL(STATS_URL);
const sockets = [];
let passed = 0;
let failures = 0;

function check(name, condition, details = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}${details ? ` (${details})` : ''}`);
  }
}

/**
 * Tiny HTTP client using `agent: false`.
 *
 * Disabling the agent forces a fresh TCP connection per request. That is what
 * makes the round-robin test meaningful: with keep-alive, every request could
 * reuse one connection and therefore one backend.
 */
function request(url, path, { method = 'GET', body, token, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path,
        method,
        agent: false,
        headers: {
          ...(payload ? { 'content-type': 'application/json' } : {}),
          ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(cookie ? { cookie } : {}),
          connection: 'close',
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let data = null;
          try {
            data = raw ? JSON.parse(raw) : null;
          } catch {
            // Non-JSON response (for example the HAProxy stats page).
          }

          resolve({
            status: res.statusCode ?? 0,
            data,
            text: raw,
            headers: res.headers,
            setCookies: res.headers['set-cookie'] ?? [],
          });
        });
      },
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Request timed out: ${method} ${path}`));
    });
    req.on('error', reject);

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

const callLb = (path, options) => request(lb, path, options);
const callStats = (path) => request(stats, path);

async function waitForLoadBalancer() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await callLb('/instance');
      if (response.status === 200 && typeof response.data?.id === 'string') {
        return;
      }
    } catch {
      // Not listening yet; retry.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `Load balancer did not answer at ${LB_URL}/instance.\n` +
      'Start the stack first:\n' +
      '  docker compose up --build -d --wait',
  );
}

function cookieFrom(response) {
  const cookie = response.setCookies
    .map((value) => value.split(';')[0])
    .find((value) => value.startsWith('SERVERID='));

  return cookie;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(LB_URL, {
      auth: { token },
      // A WebSocket connection needs no sticky cookie. For HTTP polling the
      // browser would send the SERVERID cookie automatically.
      transports: ['websocket'],
      reconnection: false,
      timeout: 5_000,
    });

    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function emitAck(socket, event, payload, timeoutMs = EVENT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }
    };
    const timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs);

    socket.emit(event, payload, (response) =>
      finish({ kind: 'ack', response }),
    );
  });
}

function waitForEvent(socket, event, timeoutMs = EVENT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}"`)),
      timeoutMs,
    );
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function main() {
  const stamp = Date.now().toString().slice(-6);

  console.log(`Load balancer: ${LB_URL}`);
  console.log(`HAProxy stats: ${STATS_URL}\n`);

  await waitForLoadBalancer();

  // --- 1. Instance identity + round robin -----------------------------------
  const first = await callLb('/instance');
  check('/instance is public and reachable', first.status === 200);
  check(
    'GET /instance reports the replica id',
    typeof first.data?.id === 'string' && first.data.id.length > 0,
    JSON.stringify(first.data),
  );
  check(
    'X-Instance-Id header matches the JSON body',
    first.headers['x-instance-id'] === first.data?.id,
    `header=${first.headers['x-instance-id']} body=${first.data?.id}`,
  );

  const seen = [];
  for (let i = 0; i < 6; i += 1) {
    const response = await callLb('/instance');
    seen.push(response.data?.id);
  }
  const unique = [...new Set(seen)];

  console.log(`      round-robin ids: ${seen.join(', ')}`);
  check(
    'requests are spread across both replicas',
    unique.length >= 2,
    `saw only ${unique.join(', ')}`,
  );

  // --- 2. Cookie stickiness -------------------------------------------------
  const cookie = cookieFrom(first);
  check('HAProxy sets a SERVERID cookie', Boolean(cookie), cookie ?? 'none');

  const stickySeen = [];
  for (let i = 0; i < 5; i += 1) {
    const response = await callLb('/instance', { cookie });
    stickySeen.push(response.data?.id);
  }

  console.log(`      sticky ids:       ${stickySeen.join(', ')}`);
  check(
    'SERVERID cookie keeps a client on one replica',
    new Set(stickySeen).size === 1 && stickySeen[0] === first.data?.id,
    `first=${first.data?.id} sticky=${[...new Set(stickySeen)].join(', ')}`,
  );

  // --- 3. Authenticated HTTP through the load balancer ----------------------
  const alice = await callLb('/auth/register', {
    method: 'POST',
    body: { username: `lb_alice_${stamp}`, password: 'secret123' },
  });
  const bob = await callLb('/auth/register', {
    method: 'POST',
    body: { username: `lb_bob_${stamp}`, password: 'secret123' },
  });
  const charlie = await callLb('/auth/register', {
    method: 'POST',
    body: { username: `lb_charlie_${stamp}`, password: 'secret123' },
  });

  check('register through the load balancer', alice.status === 201);
  check('register a second user', bob.status === 201);
  check('register a third user', charlie.status === 201);

  const login = await callLb('/auth/login', {
    method: 'POST',
    body: { username: `lb_alice_${stamp}`, password: 'secret123' },
  });
  check('login through the load balancer', login.status === 200);

  const me = await callLb('/users/me', { token: alice.data?.accessToken });
  check(
    'JWT issued by one replica is accepted by the load balancer',
    me.status === 200 && me.data?.id === alice.data?.user?.id,
  );

  const conversation = await callLb('/conversations', {
    method: 'POST',
    token: alice.data?.accessToken,
    body: { participantIds: [bob.data?.user?.id] },
  });
  check(
    'create a conversation through the load balancer',
    conversation.status === 201,
  );

  const conversationId = conversation.data?.id;

  // --- 4. WebSockets through the load balancer ------------------------------
  const aliceSocket = await connect(alice.data?.accessToken);
  const aliceJoin = await emitAck(aliceSocket, 'conversation:join', {
    conversationId,
  });
  check(
    'alice joins over WebSocket through the load balancer',
    aliceJoin.response?.joined === true,
  );

  // Open enough sockets to land on both replicas. HAProxy round robins new
  // connections, so the second or third attempt should hit the other process.
  // Keep every candidate open (they are closed in the finally block) so a
  // fallback is still usable if distribution cannot be observed.
  let bobSocket = null;
  let bobJoin = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = await connect(bob.data?.accessToken);
    const joined = await emitAck(candidate, 'conversation:join', {
      conversationId,
    });

    if (!bobSocket) {
      bobSocket = candidate;
      bobJoin = joined;
    }

    if (joined.response?.instance !== aliceJoin.response?.instance) {
      bobSocket = candidate;
      bobJoin = joined;
      break;
    }
  }

  if (!bobSocket) {
    throw new Error('Could not open a WebSocket through the load balancer');
  }

  console.log(
    `      alice on ${aliceJoin.response?.instance}, bob on ${bobJoin.response?.instance}`,
  );
  check(
    'the two WebSocket clients landed on different replicas',
    aliceJoin.response?.instance !== bobJoin.response?.instance,
  );

  // --- 5. Cross-replica broadcast through Redis -----------------------------
  const bobReceives = waitForEvent(bobSocket, 'message:new');
  const sendResult = await emitAck(aliceSocket, 'message:send', {
    conversationId,
    body: 'hello through the load balancer',
    // Deliberately wrong: the server must take the author from the JWT.
    senderId: 999_999,
  });

  check(
    'message sent through the load balancer is acknowledged',
    sendResult.response?.status === 'sent',
  );
  check(
    'server ignores a spoofed senderId',
    sendResult.response?.message?.senderId === alice.data?.user?.id,
    `got ${sendResult.response?.message?.senderId}`,
  );
  check(
    'sender ack reports the replica that handled it',
    sendResult.response?.instance === aliceJoin.response?.instance,
    `${sendResult.response?.instance} vs ${aliceJoin.response?.instance}`,
  );

  try {
    const received = await bobReceives;
    check(
      'client on the other replica receives the message through Redis',
      received?._id === sendResult.response?.message?._id,
      `sent ${sendResult.response?.message?._id}, received ${received?._id}`,
    );
    check(
      'received body matches',
      received?.body === 'hello through the load balancer',
    );
  } catch (error) {
    check(
      'client on the other replica receives the message through Redis',
      false,
    );
    console.log(`      ${error.message}`);
  }

  // --- 6. Authorization still applies --------------------------------------
  const charlieSocket = await connect(charlie.data?.accessToken);
  const exception = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), EVENT_TIMEOUT_MS);
    charlieSocket.once('exception', (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

  charlieSocket.emit('conversation:join', { conversationId });
  const error = await exception;
  check(
    'non-member is rejected behind the load balancer',
    error?.status === 'error' && /not a participant/i.test(error.message),
    JSON.stringify(error),
  );

  // --- 7. HAProxy stats page ----------------------------------------------
  try {
    const statsResponse = await callStats('/');
    check(
      'HAProxy stats page is reachable',
      statsResponse.status === 200 &&
        /statistics report/i.test(statsResponse.text),
    );
  } catch (error) {
    check('HAProxy stats page is reachable', false, error.message);
  }

  console.log(
    `\n${passed} passed, ${failures} failed` +
      (failures
        ? '\nLOAD-BALANCER TEST FAILED'
        : '\nLOAD-BALANCER TEST PASSED'),
  );
}

try {
  await main();
} catch (error) {
  failures += 1;
  console.error(`\nERROR: ${error.message}`);
  console.log('LOAD-BALANCER TEST FAILED');
} finally {
  for (const socket of sockets) {
    socket.close();
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  process.exitCode = failures > 0 ? 1 : 0;
}
