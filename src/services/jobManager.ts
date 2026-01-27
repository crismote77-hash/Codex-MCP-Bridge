import { randomUUID } from "node:crypto";

export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type Job<T = unknown> = {
  id: string;
  status: JobStatus;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: T;
  error?: string;
  progress?: number;
  metadata?: Record<string, unknown>;
};

type RunningJob<T = unknown> = Job<T> & {
  cancel: () => void;
  promise: Promise<T>;
};

/**
 * JobManager handles async operations that may take a long time.
 * Allows clients to poll for results instead of waiting for long-running tool calls.
 */
export class JobManager {
  private jobs = new Map<string, RunningJob>();
  private maxJobs = 100;
  private maxAge = 3600000; // 1 hour

  /**
   * Create a new async job.
   * Returns the job ID immediately; the task runs in the background.
   */
  createJob<T>(
    task: (
      job: Job<T>,
      updateProgress: (progress: number) => void,
    ) => Promise<T>,
    metadata?: Record<string, unknown>,
  ): string {
    this.cleanup();

    const id = randomUUID();
    const job: Job<T> = {
      id,
      status: "pending",
      createdAt: new Date(),
      metadata,
    };

    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      job.status = "cancelled";
      job.completedAt = new Date();
    };

    const updateProgress = (progress: number) => {
      if (!cancelled && job.status === "running") {
        job.progress = Math.min(100, Math.max(0, progress));
      }
    };

    const promise = (async () => {
      job.status = "running";
      job.startedAt = new Date();

      try {
        if (cancelled) {
          throw new Error("Job cancelled before start");
        }

        const result = await task(job, updateProgress);

        if (cancelled) {
          throw new Error("Job cancelled during execution");
        }

        job.status = "completed";
        job.completedAt = new Date();
        job.result = result;
        job.progress = 100;
        return result;
      } catch (error) {
        if (!cancelled) {
          job.status = "failed";
          job.completedAt = new Date();
          job.error = error instanceof Error ? error.message : String(error);
        }
        throw error;
      }
    })();

    const runningJob: RunningJob<T> = {
      ...job,
      cancel,
      promise,
    };

    this.jobs.set(id, runningJob as RunningJob);
    return id;
  }

  /**
   * Get the current status of a job.
   */
  getJob(id: string): Job | null {
    const job = this.jobs.get(id);
    if (!job) return null;

    return {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      result: job.result,
      error: job.error,
      progress: job.progress,
      metadata: job.metadata,
    };
  }

  /**
   * Wait for a job to complete (with timeout).
   */
  async waitForJob<T>(id: string, timeoutMs = 30000): Promise<Job<T> | null> {
    const job = this.jobs.get(id) as RunningJob<T> | undefined;
    if (!job) return null;

    if (
      job.status === "completed" ||
      job.status === "failed" ||
      job.status === "cancelled"
    ) {
      return this.getJob(id) as Job<T>;
    }

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout waiting for job")), timeoutMs),
    );

    try {
      await Promise.race([job.promise, timeout]);
    } catch {
      // Job failed or timed out
    }

    return this.getJob(id) as Job<T>;
  }

  /**
   * Cancel a running job.
   */
  cancelJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status !== "pending" && job.status !== "running") return false;

    job.cancel();
    return true;
  }

  /**
   * List all jobs (optionally filtered by status).
   */
  listJobs(status?: JobStatus): Job[] {
    this.cleanup();
    const jobs: Job[] = [];
    for (const job of this.jobs.values()) {
      if (!status || job.status === status) {
        jobs.push({
          id: job.id,
          status: job.status,
          createdAt: job.createdAt,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          error: job.error,
          progress: job.progress,
          metadata: job.metadata,
          // Don't include full result in list
        });
      }
    }
    return jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Delete a completed/failed/cancelled job.
   */
  deleteJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status === "pending" || job.status === "running") return false;
    this.jobs.delete(id);
    return true;
  }

  /**
   * Clean up old completed jobs.
   */
  private cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [id, job] of this.jobs.entries()) {
      const age = now - job.createdAt.getTime();
      if (
        age > this.maxAge &&
        (job.status === "completed" ||
          job.status === "failed" ||
          job.status === "cancelled")
      ) {
        toDelete.push(id);
      }
    }

    // Also delete oldest jobs if we're over the limit
    if (this.jobs.size > this.maxJobs) {
      const sorted = [...this.jobs.entries()]
        .filter(
          ([, j]) =>
            j.status === "completed" ||
            j.status === "failed" ||
            j.status === "cancelled",
        )
        .sort(([, a], [, b]) => a.createdAt.getTime() - b.createdAt.getTime());

      const excess = this.jobs.size - this.maxJobs;
      for (let i = 0; i < excess && i < sorted.length; i++) {
        toDelete.push(sorted[i][0]);
      }
    }

    for (const id of toDelete) {
      this.jobs.delete(id);
    }
  }
}

// Singleton instance
export const jobManager = new JobManager();
