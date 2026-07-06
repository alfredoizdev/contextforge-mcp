import type { ApiClient } from "./api-client.js";
import type { AgentSession } from "./types.js";

export const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;
export const EXIT_FLUSH_TIMEOUT_MS = 2000;

/**
 * Best-effort live-presence lifecycle for this MCP process. One process ==
 * one Claude Code session, so the process owns the session identity:
 * lazy-register on the first tool call, heartbeat on a timer while alive,
 * best-effort end on exit. The server-side 10-minute TTL is the safety net
 * when the process dies without cleanup.
 *
 * Nothing here may ever throw into a tool call: presence is advisory and
 * must never break memory tools.
 */
export class SessionPresence {
  private sessionId: string | null = null;
  private registering: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ended = false;

  constructor(
    private readonly client: ApiClient,
    private readonly defaults: { projectId?: string; label?: string } = {},
  ) {}

  getSessionId(): string | null {
    return this.sessionId;
  }

  /** Lazy registration; fire-and-forget from the tool-call path. */
  ensureRegistered(): Promise<void> {
    if (this.sessionId || this.ended) return Promise.resolve();
    if (!this.registering) {
      this.registering = this.client
        .registerSession({
          project_id: this.defaults.projectId,
          label: this.defaults.label,
        })
        .then((session) => {
          if (this.ended) {
            // end() raced ahead of an in-flight registration: clean up the
            // just-created session instead of adopting it.
            void this.client.endSession(session.id).catch(() => {});
            return;
          }
          this.sessionId = session.id;
          this.startHeartbeat();
        })
        .catch(() => {
          // Swallow: presence must never break tools. Clearing the in-flight
          // marker lets a later tool call retry.
          this.registering = null;
        });
    }
    return this.registering;
  }

  private startHeartbeat(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (!this.sessionId) return;
      this.client.updateSession(this.sessionId).catch(() => {
        // Swallow: the next beat (or the server TTL) handles it.
      });
    }, HEARTBEAT_INTERVAL_MS);
    // Never keep the process alive just for presence.
    this.timer.unref?.();
  }

  /** The agent's explicit touchpoint (session_update tool). */
  async updateFocus(focus: string, label?: string): Promise<AgentSession | null> {
    await this.ensureRegistered();
    if (!this.sessionId) return null;
    return this.client.updateSession(this.sessionId, {
      focus,
      ...(label ? { label } : {}),
    });
  }

  async end(): Promise<void> {
    this.ended = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const id = this.sessionId;
    this.sessionId = null;
    if (id) {
      await this.client.endSession(id).catch(() => {
        // Swallow: the server TTL expires us anyway.
      });
    }
  }

  /** Best-effort end when the Claude Code session goes away. */
  installExitHooks(): void {
    const onSignal = () => {
      // Registering a signal handler suppresses Node's default terminate
      // action, so after the best-effort end we must exit ourselves —
      // bounded by a short timeout so a hung DELETE can't block shutdown.
      const timeout = new Promise<void>((resolve) => {
        const t = setTimeout(resolve, EXIT_FLUSH_TIMEOUT_MS);
        t.unref?.();
      });
      void Promise.race([this.end(), timeout]).finally(() => process.exit(0));
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    process.stdin.on("close", () => {
      void this.end();
    });
  }
}
