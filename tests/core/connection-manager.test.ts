/**
 * ConnectionManager Unit Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectionManager, ConnectionState } from '@memory-stack/core';

describe('ConnectionManager', () => {
  let manager: ConnectionManager;
  let connectFn: ReturnType<typeof vi.fn>;
  let disconnectFn: ReturnType<typeof vi.fn>;
  let healthCheckFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    connectFn = vi.fn().mockResolvedValue(undefined);
    disconnectFn = vi.fn().mockResolvedValue(undefined);
    healthCheckFn = vi.fn().mockResolvedValue(true);

    manager = new ConnectionManager(
      { name: 'test-db', maxReconnectAttempts: 3, connectionTimeoutMs: 5000 },
      {},
      { connect: connectFn, disconnect: disconnectFn, healthCheck: healthCheckFn }
    );
  });

  it('starts in DISCONNECTED state', () => {
    expect(manager.getState()).toBe(ConnectionState.DISCONNECTED);
    expect(manager.isConnected()).toBe(false);
  });

  it('connects successfully', async () => {
    await manager.connect();
    expect(manager.getState()).toBe(ConnectionState.CONNECTED);
    expect(manager.isConnected()).toBe(true);
    expect(connectFn).toHaveBeenCalledTimes(1);
    await manager.disconnect();
  });

  it('does not reconnect if already connected', async () => {
    await manager.connect();
    await manager.connect();
    expect(connectFn).toHaveBeenCalledTimes(1);
    await manager.disconnect();
  });

  it('disconnects successfully', async () => {
    await manager.connect();
    await manager.disconnect();
    expect(manager.getState()).toBe(ConnectionState.DISCONNECTED);
    expect(disconnectFn).toHaveBeenCalledTimes(1);
  });

  it('handles connection failure', async () => {
    connectFn.mockRejectedValueOnce(new Error('Connection refused'));
    await expect(manager.connect()).rejects.toThrow();
    expect(manager.getState()).toBe(ConnectionState.FAILED);
  });

  it('returns correct stats', async () => {
    const stats = manager.getStats();
    expect(stats.state).toBe(ConnectionState.DISCONNECTED);
    expect(stats.reconnectAttempts).toBe(0);
    expect(stats.maxReconnectAttempts).toBe(3);
  });

  it('reconnects via disconnect + connect', async () => {
    await manager.connect();
    await manager.reconnect();
    expect(disconnectFn).toHaveBeenCalled();
    expect(connectFn).toHaveBeenCalledTimes(2);
    await manager.disconnect();
  });
});
