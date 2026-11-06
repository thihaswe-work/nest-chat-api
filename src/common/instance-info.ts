import { hostname } from 'node:os';

/**
 * Identity of the process that is serving a request.
 *
 * When several copies of the app run behind a load balancer, "which replica
 * handled this?" is the first question you ask while debugging. This module
 * gives every process a stable, human-readable id.
 *
 * In Docker Compose each container gets an explicit hostname (`app1`, `app2`),
 * so the id reads `app1:<pid>`. When you run two processes locally, the hostname
 * is the same and the pid keeps the ids distinct.
 */
export interface InstanceInfo {
  /** `hostname:pid`, e.g. `app2:1`. Used in headers and WebSocket acks. */
  id: string;
  hostname: string;
  pid: number;
  /** ISO timestamp of when this process loaded the module. */
  startedAt: string;
}

// Computed once at import time, so the value is stable for the process lifetime.
const startedAt = new Date().toISOString();

export function getInstanceInfo(): InstanceInfo {
  const host = hostname();

  return {
    id: `${host}:${process.pid}`,
    hostname: host,
    pid: process.pid,
    startedAt,
  };
}

export function getInstanceId(): string {
  return getInstanceInfo().id;
}
