/**
 * Connection manager with reconnection logic and health monitoring
 */

import { createHash } from 'crypto';

export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
  FAILED = 'FAILED',
}

export interface ConnectionConfig {
  /** Maximum reconnection attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Initial reconnection delay in ms (default: 1000) */
  initialReconnectDelayMs?: number;
  /** Maximum reconnection delay in ms (default: 30000) */
  maxReconnectDelayMs?: number;
  /** Health check interval in ms (default: 30000) */
  healthCheckIntervalMs?: number;
  /** Connection timeout in ms (default: 10000) */
  connectionTimeoutMs?: number;
  /** Name for logging */
  name?: string;
}

export interface ConnectionEvents {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onReconnecting?: (attempt: number, maxAttempts: number) => void;
  onReconnectFailed?: () => void;
  onHealthCheckFailed?: (error: Error) => void;
}

const DEFAULT_CONFIG: Required<ConnectionConfig> = {
  maxReconnectAttempts: 10,
  initialReconnectDelayMs: 1000,
  maxReconnectDelayMs: 30000,
  healthCheckIntervalMs: 30000,
  connectionTimeoutMs: 10000,
  name: 'database',
};

export class ConnectionManager {
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private reconnectAttempts = 0;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private config: Required<ConnectionConfig>;
  private events: ConnectionEvents;

  private connectFn: () => Promise<void>;
  private disconnectFn: () => Promise<void>;
  private healthCheckFn: () => Promise<boolean>;

  constructor(
    config: ConnectionConfig,
    events: ConnectionEvents,
    fns: {
      connect: () => Promise<void>;
      disconnect: () => Promise<void>;
      healthCheck: () => Promise<boolean>;
    }
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.events = events;
    this.connectFn = fns.connect;
    this.disconnectFn = fns.disconnect;
    this.healthCheckFn = fns.healthCheck;
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === ConnectionState.CONNECTED;
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    state: ConnectionState;
    reconnectAttempts: number;
    maxReconnectAttempts: number;
  } {
    return {
      state: this.state,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.config.maxReconnectAttempts,
    };
  }

  /**
   * Connect with automatic retry
   */
  async connect(): Promise<void> {
    if (this.state === ConnectionState.CONNECTED) {
      return;
    }

    if (this.state === ConnectionState.CONNECTING) {
      // Wait for existing connection attempt
      return this.waitForConnection();
    }

    this.state = ConnectionState.CONNECTING;

    try {
      await this.attemptConnection();
      this.state = ConnectionState.CONNECTED;
      this.reconnectAttempts = 0;
      this.startHealthCheck();
      this.events.onConnected?.();
    } catch (error) {
      this.state = ConnectionState.FAILED;
      throw error;
    }
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    this.stopHealthCheck();
    this.stopReconnectTimer();

    if (this.state === ConnectionState.DISCONNECTED) {
      return;
    }

    try {
      await this.disconnectFn();
    } finally {
      this.state = ConnectionState.DISCONNECTED;
      this.events.onDisconnected?.();
    }
  }

  /**
   * Trigger reconnection
   */
  async reconnect(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }

  private async attemptConnection(): Promise<void> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Connection to ${this.config.name} timed out after ${this.config.connectionTimeoutMs}ms`));
      }, this.config.connectionTimeoutMs);
    });

    await Promise.race([this.connectFn(), timeoutPromise]);
  }

  private async waitForConnection(): Promise<void> {
    const maxWait = this.config.connectionTimeoutMs + 1000;
    const startTime = Date.now();

    while (this.state === ConnectionState.CONNECTING) {
      if (Date.now() - startTime > maxWait) {
        throw new Error('Connection wait timeout');
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.state !== ConnectionState.CONNECTED) {
      throw new Error('Connection failed');
    }
  }

  private startHealthCheck(): void {
    this.stopHealthCheck();

    this.healthCheckTimer = setInterval(async () => {
      try {
        const healthy = await this.healthCheckFn();
        if (!healthy) {
          throw new Error('Health check returned false');
        }
      } catch (error) {
        console.error(`[${this.config.name}] Health check failed:`, error);
        this.events.onHealthCheckFailed?.(error instanceof Error ? error : new Error(String(error)));
        this.scheduleReconnect();
      }
    }, this.config.healthCheckIntervalMs);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  private stopReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.state === ConnectionState.RECONNECTING) {
      return;
    }

    this.state = ConnectionState.RECONNECTING;
    this.stopHealthCheck();

    this.attemptReconnect();
  }

  private async attemptReconnect(): Promise<void> {
    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.config.maxReconnectAttempts) {
      this.state = ConnectionState.FAILED;
      console.error(`[${this.config.name}] Max reconnection attempts reached`);
      this.events.onReconnectFailed?.();
      return;
    }

    const delay = this.calculateReconnectDelay();
    console.log(
      `[${this.config.name}] Reconnecting in ${delay}ms ` +
      `(attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`
    );

    this.events.onReconnecting?.(this.reconnectAttempts, this.config.maxReconnectAttempts);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.disconnectFn().catch(() => {});
        await this.attemptConnection();
        this.state = ConnectionState.CONNECTED;
        this.reconnectAttempts = 0;
        this.startHealthCheck();
        console.log(`[${this.config.name}] Reconnected successfully`);
        this.events.onConnected?.();
      } catch (error) {
        console.error(`[${this.config.name}] Reconnection attempt failed:`, error);
        if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
          this.attemptReconnect();
        } else {
          this.state = ConnectionState.FAILED;
          this.events.onReconnectFailed?.();
        }
      }
    }, delay);
  }

  private calculateReconnectDelay(): number {
    const exponentialDelay = this.config.initialReconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1);
    const clampedDelay = Math.min(exponentialDelay, this.config.maxReconnectDelayMs);

    // Add jitter (0.5 to 1.5x)
    const jitter = 0.5 + Math.random();
    return Math.floor(clampedDelay * jitter);
  }
}

/**
 * Connection pool for managing multiple connections
 */
export class ConnectionPool<T> {
  private connections: Map<string, { instance: T; manager: ConnectionManager }> = new Map();

  constructor(
    private createConnection: (id: string) => Promise<T>,
    private destroyConnection: (instance: T) => Promise<void>,
    private checkConnection: (instance: T) => Promise<boolean>,
    private config: ConnectionConfig = {}
  ) {}

  /**
   * Get or create a connection
   */
  async acquire(id: string): Promise<T> {
    const existing = this.connections.get(id);
    if (existing && existing.manager.isConnected()) {
      return existing.instance;
    }

    if (existing) {
      await existing.manager.reconnect();
      return existing.instance;
    }

    const instance = await this.createConnection(id);
    const manager = new ConnectionManager(
      { ...this.config, name: `${this.config.name ?? 'pool'}-${id}` },
      {},
      {
        connect: async () => { /* Already connected */ },
        disconnect: () => this.destroyConnection(instance),
        healthCheck: () => this.checkConnection(instance),
      }
    );

    this.connections.set(id, { instance, manager });
    return instance;
  }

  /**
   * Release a connection back to the pool
   */
  async release(id: string): Promise<void> {
    const existing = this.connections.get(id);
    if (existing) {
      await existing.manager.disconnect();
      this.connections.delete(id);
    }
  }

  /**
   * Close all connections
   */
  async closeAll(): Promise<void> {
    const closePromises = Array.from(this.connections.entries()).map(
      async ([id]) => this.release(id)
    );
    await Promise.all(closePromises);
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    totalConnections: number;
    activeConnections: number;
    connectionStates: Record<string, ConnectionState>;
  } {
    const states: Record<string, ConnectionState> = {};
    let activeCount = 0;

    for (const [id, { manager }] of this.connections) {
      const state = manager.getState();
      states[id] = state;
      if (state === ConnectionState.CONNECTED) {
        activeCount++;
      }
    }

    return {
      totalConnections: this.connections.size,
      activeConnections: activeCount,
      connectionStates: states,
    };
  }
}
