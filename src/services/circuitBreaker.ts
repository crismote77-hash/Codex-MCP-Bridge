/**
 * Circuit breaker for preventing repeated failures.
 * Tracks failure patterns and can "open" the circuit to prevent further attempts.
 */

export type CircuitState = "closed" | "open" | "half-open";

export type CircuitConfig = {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Time in ms to wait before trying again (half-open state) */
  resetTimeoutMs: number;
  /** Time in ms after which failure counts expire */
  failureWindowMs: number;
};

type CircuitEntry = {
  state: CircuitState;
  failures: number;
  lastFailureTime?: number;
  openedAt?: number;
  lastError?: string;
};

const DEFAULT_CONFIG: CircuitConfig = {
  failureThreshold: 3,
  resetTimeoutMs: 60000, // 1 minute
  failureWindowMs: 300000, // 5 minutes
};

/**
 * CircuitBreaker tracks failures by key (e.g., tool + cwd combination)
 * and prevents repeated attempts when a pattern of failures is detected.
 */
export class CircuitBreaker {
  private circuits = new Map<string, CircuitEntry>();
  private config: CircuitConfig;

  constructor(config: Partial<CircuitConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate a circuit key from tool name and relevant parameters.
   */
  static makeKey(toolName: string, params: Record<string, unknown>): string {
    // Use relevant params to create a unique key
    const relevantParams = ["cwd", "path", "directory"].filter(
      (p) => params[p] !== undefined,
    );
    const paramStr = relevantParams
      .map((p) => `${p}=${String(params[p])}`)
      .sort()
      .join(";");
    return paramStr ? `${toolName}:${paramStr}` : toolName;
  }

  /**
   * Check if the circuit allows the request.
   * Returns { allowed: true } or { allowed: false, reason: string, retryAfterMs: number }
   */
  canExecute(key: string): {
    allowed: boolean;
    reason?: string;
    retryAfterMs?: number;
  } {
    const circuit = this.circuits.get(key);
    if (!circuit) {
      return { allowed: true };
    }

    const now = Date.now();

    // Check if failures have expired
    if (
      circuit.lastFailureTime &&
      now - circuit.lastFailureTime > this.config.failureWindowMs
    ) {
      // Reset the circuit
      this.circuits.delete(key);
      return { allowed: true };
    }

    switch (circuit.state) {
      case "closed":
        return { allowed: true };

      case "open": {
        // Check if we should move to half-open
        if (
          circuit.openedAt &&
          now - circuit.openedAt > this.config.resetTimeoutMs
        ) {
          circuit.state = "half-open";
          return { allowed: true };
        }
        const retryAfterMs = circuit.openedAt
          ? this.config.resetTimeoutMs - (now - circuit.openedAt)
          : this.config.resetTimeoutMs;
        return {
          allowed: false,
          reason: `Circuit open after ${circuit.failures} failures. Last error: ${circuit.lastError || "unknown"}`,
          retryAfterMs: Math.max(0, retryAfterMs),
        };
      }

      case "half-open":
        // Allow one request through to test
        return { allowed: true };
    }
  }

  /**
   * Record a successful execution.
   */
  recordSuccess(key: string): void {
    const circuit = this.circuits.get(key);
    if (!circuit) return;

    if (circuit.state === "half-open") {
      // Success in half-open state closes the circuit
      this.circuits.delete(key);
    } else if (circuit.state === "closed") {
      // Reduce failure count on success
      circuit.failures = Math.max(0, circuit.failures - 1);
      if (circuit.failures === 0) {
        this.circuits.delete(key);
      }
    }
  }

  /**
   * Record a failed execution.
   */
  recordFailure(key: string, error?: string): void {
    const now = Date.now();
    let circuit = this.circuits.get(key);

    if (!circuit) {
      circuit = {
        state: "closed",
        failures: 0,
      };
      this.circuits.set(key, circuit);
    }

    circuit.failures++;
    circuit.lastFailureTime = now;
    circuit.lastError = error;

    if (circuit.state === "half-open") {
      // Failure in half-open state reopens the circuit
      circuit.state = "open";
      circuit.openedAt = now;
    } else if (
      circuit.state === "closed" &&
      circuit.failures >= this.config.failureThreshold
    ) {
      // Too many failures, open the circuit
      circuit.state = "open";
      circuit.openedAt = now;
    }
  }

  /**
   * Get the current state of a circuit.
   */
  getState(key: string): CircuitEntry | null {
    return this.circuits.get(key) ?? null;
  }

  /**
   * Reset a specific circuit.
   */
  reset(key: string): void {
    this.circuits.delete(key);
  }

  /**
   * Reset all circuits.
   */
  resetAll(): void {
    this.circuits.clear();
  }

  /**
   * Get statistics about all circuits.
   */
  getStats(): {
    total: number;
    open: number;
    halfOpen: number;
    closed: number;
    circuits: Array<{ key: string; state: CircuitState; failures: number }>;
  } {
    const stats = {
      total: this.circuits.size,
      open: 0,
      halfOpen: 0,
      closed: 0,
      circuits: [] as Array<{
        key: string;
        state: CircuitState;
        failures: number;
      }>,
    };

    for (const [key, circuit] of this.circuits.entries()) {
      switch (circuit.state) {
        case "open":
          stats.open++;
          break;
        case "half-open":
          stats.halfOpen++;
          break;
        case "closed":
          stats.closed++;
          break;
      }
      stats.circuits.push({
        key,
        state: circuit.state,
        failures: circuit.failures,
      });
    }

    return stats;
  }
}

// Singleton instance
export const circuitBreaker = new CircuitBreaker();
