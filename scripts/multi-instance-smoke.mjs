#!/usr/bin/env node
/**
 * Multi-instance smoke test.
 *
 * It starts two copies of the built app on different ports, connects one
 * Socket.IO client to each, and verifies that a message sent through instance A
 * is delivered to a client connected only to instance B. That only works when
 * both instances share the Redis adapter, so a pass proves:
 *
 *   - both instances are using the same PostgreSQL/MongoDB/Redis
 *   - JWTs issued by instance A are accepted by instance B
 *   - Socket.IO rooms are shared across instances through Redis pub/sub
 *   - the server ignores a spoofed `senderId` and uses the JWT identity
 *   - a non-member is rejected when trying to join a conversation
 *
 * Prerequisites (all reachable from this machine):
 *   - PostgreSQL, MongoDB, and Redis running
 *   - the database/schema already initialised (run the app once if needed)
 *
 * Usage:
 *   npm run test:multi-instance
 *
 * Optional overrides:
 *   INSTANCE_A_PORT=4100 INSTANCE_B_PORT=4200 npm run test:multi-instance
 *
 * The script builds nothing itself; the npm script runs `npm run build` first.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { io } from 'socket.io-client';

const HOST = process.env.HOST ?? 'localhost';
const PORT_A = Number(process.env.INSTANCE_A_PORT ?? 3100);
const PORT_B = Number(process.env.INSTANCE_B_PORT ?? 3200);
const BASE_A = `http://${HOST}:${PORT_A}`;
const BASE_B = `http://${HOST}:${PORT_B}`;
const STARTUP_TIMEOUT_MS = 30_000;
const EVENT_TIMEOUT_MS = 6_000;

const instances = [];
const sockets = [];
let failures = 0;
let passed = 0;

function check(name, condition, details = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}${details ? ` (${details})` : ''}`);
  }
}

/** Start one app process and capture its logs for diagnostics. */
function startInstance(port) {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      // Force a known secret so both instances definitely sign/verify alike.
      JWT_SECRET: process.env.JWT_SECRET ?? 'multi-instance-smoke-test-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logs = '';
  child.stdout.on('data', (chunk) => (logs += chunk.toString()));
  child.stderr.on('data', (chunk) => (logs += chunk.toString()));

  const instance = { port, child, getLogs: () => logs };
  instances.push(instance);
  return instance;
}

/** Wait until GET / responds with this app's health payload. */
async function waitForHealth(instance) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (
      instance.child.exitCode !== null ||
      instance.child.signalCode !== null
    ) {
      throw new Error(
        `Instance on port ${instance.port} exited early:\n${instance.getLogs()}`,
      );
    }

    try {
      const response = await fetch(`http://${HOST}:${instance.port}/`);
      const body = response.ok ? await response.text() : '';
      const started = instance
        .getLogs()
        .includes(`Server running on http://localhost:${instance.port}`);

      // The log check ensures we are talking to *our* child, not a leftover
      // process that happens to occupy the port.
      if (body.includes('Hello World!') && started) {
        return;
      }
    } catch {
      // Not listening yet; retry.
    }

    await delay(250);
  }

  throw new Error(
    `Instance on port ${instance.port} did not become healthy:\n${instance.getLogs()}`,
  );
}

/** Stop a child process, escalating to SIGKILL if it ignores SIGTERM. */
async function stopInstance(instance) {
  if (instance.child.exitCode !== null || instance.child.signalCode !== null) {
    return;
  }

  instance.child.kill('SIGTERM');

  await Promise.race([
    once(instance.child, 'exit'),
    delay(5_000).then(() => {
      if (
        instance.child.exitCode === null &&
        instance.child.signalCode === null
      ) {
        instance.child.kill('SIGKILL');
      }
    }),
  ]);
}

async function request(base, method, path, { token, body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Some error responses have no JSON body.
  }

  return { status: response.status, data };
}

function connect(base, token) {
  return new Promise((resolve, reject) => {
    const socket = io(base, {
      auth: token ? { token } : {},
      // WebSocket avoids the HTTP long-polling handshake, so this test does not
      // need sticky sessions. Real deployments using polling still do.
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

function waitForException(socket, timeoutMs = EVENT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for "exception"')),
      timeoutMs,
    );
    socket.once('exception', (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function main() {
  const stamp = Date.now().toString().slice(-6);

  // Start A first so schema synchronisation never races on a fresh database.
  console.log(`Starting instance A on ${BASE_A} ...`);
  const instanceA = startInstance(PORT_A);
  await waitForHealth(instanceA);

  console.log(`Starting instance B on ${BASE_B} ...`);
  const instanceB = startInstance(PORT_B);
  await waitForHealth(instanceB);

  // If Redis is down, every instance silently falls back to its own in-memory
  // adapter and the cross-instance assertions below cannot pass. Fail early with
  // an actionable message instead.
  for (const instance of [instanceA, instanceB]) {
    await delay(100);
    const logs = instance.getLogs();
    if (logs.includes('falling back to in-memory')) {
      throw new Error(
        `Instance on port ${instance.port} could not reach Redis. ` +
          'Start Redis and rerun the test.\n' +
          logs,
      );
    }
    check(
      `instance ${instance.port} is using the Redis adapter`,
      logs.includes('Socket.IO connected to Redis adapter'),
    );
  }

  // --- users, token portability, conversation setup ---
  const alice = await request(BASE_A, 'POST', '/auth/register', {
    body: { username: `multi_alice_${stamp}`, password: 'secret123' },
  });
  const bob = await request(BASE_A, 'POST', '/auth/register', {
    body: { username: `multi_bob_${stamp}`, password: 'secret123' },
  });
  const charlie = await request(BASE_A, 'POST', '/auth/register', {
    body: { username: `multi_charlie_${stamp}`, password: 'secret123' },
  });

  check('registration works on instance A', alice.status === 201);
  check('registration works for the second user', bob.status === 201);
  check('registration works for the third user', charlie.status === 201);

  // A token signed by A must verify on B (same JWT_SECRET, stateless auth).
  const profileOnB = await request(BASE_B, 'GET', '/users/me', {
    token: alice.data.accessToken,
  });
  check(
    'token issued by instance A is accepted by instance B',
    profileOnB.status === 200 && profileOnB.data?.id === alice.data.user.id,
  );

  const conversation = await request(BASE_A, 'POST', '/conversations', {
    token: alice.data.accessToken,
    body: { participantIds: [bob.data.user.id] },
  });
  check('conversation created on instance A', conversation.status === 201);

  const conversationId = conversation.data?.id;

  // --- one client per instance ---
  const aliceSocket = await connect(BASE_A, alice.data.accessToken);
  const bobSocket = await connect(BASE_B, bob.data.accessToken);

  check('client A connected to instance A', aliceSocket.connected);
  check('client B connected to instance B', bobSocket.connected);

  const aliceJoin = await emitAck(aliceSocket, 'conversation:join', {
    conversationId,
  });
  const bobJoin = await emitAck(bobSocket, 'conversation:join', {
    conversationId,
  });

  check('alice joined the room on instance A', aliceJoin.response?.joined);
  check('bob joined the room on instance B', bobJoin.response?.joined);

  // --- the actual cross-instance assertion ---
  const bobReceives = waitForEvent(bobSocket, 'message:new');

  const sendResult = await emitAck(aliceSocket, 'message:send', {
    conversationId,
    body: 'hello across instances',
    // Deliberately wrong: the server must ignore this and use the JWT identity.
    senderId: 999_999,
  });

  check(
    'message sent through instance A is acknowledged',
    sendResult.response?.status === 'sent',
  );
  check(
    'server ignores a spoofed senderId',
    sendResult.response?.message?.senderId === alice.data.user.id,
    `got ${sendResult.response?.message?.senderId}`,
  );

  let received = null;
  try {
    received = await bobReceives;
    check(
      'client on instance B receives the message through Redis',
      received?._id === sendResult.response?.message?._id,
      `sent ${sendResult.response?.message?._id}, received ${received?._id}`,
    );
    check('received body matches', received?.body === 'hello across instances');
  } catch (error) {
    check('client on instance B receives the message through Redis', false);
    console.log(`      ${error.message}`);
  }

  // --- authorization still applies on the remote instance ---
  const charlieSocket = await connect(BASE_B, charlie.data.accessToken);
  const charlieException = waitForException(charlieSocket);
  charlieSocket.emit('conversation:join', { conversationId });

  try {
    const exception = await charlieException;
    check(
      'non-member is rejected on instance B',
      exception?.status === 'error' &&
        /not a participant/i.test(exception.message),
      JSON.stringify(exception),
    );
  } catch (error) {
    check('non-member is rejected on instance B', false, error.message);
  }

  console.log(
    `\n${passed} passed, ${failures} failed` +
      (failures
        ? '\nMULTI-INSTANCE TEST FAILED'
        : '\nMULTI-INSTANCE TEST PASSED'),
  );
}

try {
  await main();
} catch (error) {
  failures += 1;
  console.error(`\nERROR: ${error.message}`);
  console.log('MULTI-INSTANCE TEST FAILED');
} finally {
  for (const socket of sockets) {
    socket.close();
  }
  for (const instance of instances) {
    await stopInstance(instance);
  }
  // Let Node flush the final output before exiting.
  await delay(100);
  process.exitCode = failures > 0 ? 1 : 0;
}
