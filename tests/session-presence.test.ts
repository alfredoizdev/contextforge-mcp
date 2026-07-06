import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionPresence, HEARTBEAT_INTERVAL_MS } from '../src/session-presence.js';

const SESSION = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  project_id: null,
  label: null,
  focus: null,
  status: 'active' as const,
  started_at: '2026-07-06T10:00:00Z',
  last_heartbeat_at: '2026-07-06T10:00:00Z',
  metadata: {},
};

function makeClient() {
  return {
    registerSession: vi.fn().mockResolvedValue(SESSION),
    updateSession: vi.fn().mockResolvedValue(SESSION),
    endSession: vi.fn().mockResolvedValue({ success: true }),
  };
}

describe('SessionPresence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('registers once even when called concurrently', async () => {
    const client = makeClient();
    const presence = new SessionPresence(client as never, { label: 'repo' });
    await Promise.all([presence.ensureRegistered(), presence.ensureRegistered()]);
    await presence.ensureRegistered();
    expect(client.registerSession).toHaveBeenCalledTimes(1);
    expect(presence.getSessionId()).toBe(SESSION.id);
  });

  it('swallows registration failure and retries on the next call', async () => {
    const client = makeClient();
    client.registerSession
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(SESSION);
    const presence = new SessionPresence(client as never);
    await presence.ensureRegistered(); // fails silently
    expect(presence.getSessionId()).toBeNull();
    await presence.ensureRegistered(); // retries
    expect(presence.getSessionId()).toBe(SESSION.id);
    expect(client.registerSession).toHaveBeenCalledTimes(2);
  });

  it('heartbeats via updateSession every interval after registering', async () => {
    const client = makeClient();
    const presence = new SessionPresence(client as never);
    await presence.ensureRegistered();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(client.updateSession).toHaveBeenCalledWith(SESSION.id);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(client.updateSession).toHaveBeenCalledTimes(2);
  });

  it('heartbeat failures are swallowed', async () => {
    const client = makeClient();
    client.updateSession.mockRejectedValue(new Error('boom'));
    const presence = new SessionPresence(client as never);
    await presence.ensureRegistered();
    await expect(
      vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS),
    ).resolves.not.toThrow();
  });

  it('updateFocus auto-registers then patches focus', async () => {
    const client = makeClient();
    const presence = new SessionPresence(client as never);
    const session = await presence.updateFocus('working on auth');
    expect(client.registerSession).toHaveBeenCalledTimes(1);
    expect(client.updateSession).toHaveBeenCalledWith(SESSION.id, {
      focus: 'working on auth',
    });
    expect(session).not.toBeNull();
  });

  it('updateFocus returns null when registration is impossible', async () => {
    const client = makeClient();
    client.registerSession.mockRejectedValue(new Error('down'));
    const presence = new SessionPresence(client as never);
    const session = await presence.updateFocus('anything');
    expect(session).toBeNull();
    expect(client.updateSession).not.toHaveBeenCalled();
  });

  it('end() stops the heartbeat and calls endSession once', async () => {
    const client = makeClient();
    const presence = new SessionPresence(client as never);
    await presence.ensureRegistered();
    await presence.end();
    expect(client.endSession).toHaveBeenCalledWith(SESSION.id);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 3);
    expect(client.updateSession).not.toHaveBeenCalled();
    // ended presence never re-registers
    await presence.ensureRegistered();
    expect(client.registerSession).toHaveBeenCalledTimes(1);
  });

  it('end() before registration is a silent no-op', async () => {
    const client = makeClient();
    const presence = new SessionPresence(client as never);
    await presence.end();
    expect(client.endSession).not.toHaveBeenCalled();
  });

  it('end() during in-flight registration cleans up the orphaned session', async () => {
    const client = makeClient();
    let resolveRegister!: (s: typeof SESSION) => void;
    client.registerSession.mockImplementation(
      () => new Promise((res) => { resolveRegister = res; }),
    );
    const presence = new SessionPresence(client as never);
    const inFlight = presence.ensureRegistered();
    await presence.end();
    resolveRegister(SESSION);
    await inFlight;
    expect(presence.getSessionId()).toBeNull();
    expect(client.endSession).toHaveBeenCalledWith(SESSION.id);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 2);
    expect(client.updateSession).not.toHaveBeenCalled();
  });

  it('installExitHooks: SIGTERM triggers end() then process.exit(0)', async () => {
    const client = makeClient();
    const presence = new SessionPresence(client as never);
    await presence.ensureRegistered();

    // Capture signal handlers registered via process.once (the fixed API)
    const capturedHandlers: Partial<Record<string, () => void>> = {};
    vi.spyOn(process, 'once').mockImplementation(((
      event: string,
      handler: () => void,
    ) => {
      capturedHandlers[event] = handler;
      return process;
    }) as never);
    vi.spyOn(process.stdin, 'on').mockImplementation((() => process.stdin) as never);
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    presence.installExitHooks();

    // After the fix, process.once('SIGTERM', …) must have been called
    expect(capturedHandlers['SIGTERM']).toBeDefined();

    // Invoke the captured SIGTERM handler
    capturedHandlers['SIGTERM']!();

    // Drain the microtask queue so the async promise chain settles
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(client.endSession).toHaveBeenCalledWith(SESSION.id);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
