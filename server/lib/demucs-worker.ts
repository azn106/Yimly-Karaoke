import { spawn, ChildProcess } from 'child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'path';

export interface DemucsWorkerMetrics {
  workerSpawnCount: number;
  modelInitCount: number;
  jobsHandledCount: number;
  isRunning: boolean;
}

export interface DemucsRunOptions {
  signal?: AbortSignal;
  isCancelled?: () => boolean;
}

interface LockWaiter {
  resolve: () => void;
  reject: (err: Error) => void;
  cleanup?: () => void;
}

export class DemucsWorkerManager {
  private child: ChildProcess | null = null;
  private startingPromise: Promise<void> | null = null;
  public scriptPath: string | null = null;
  private workerSpawnCount = 0;
  private modelInitCount = 0;
  private jobsHandledCount = 0;
  private jobTimeoutMs = 600000; // 10 minutes default timeout per stem separation job
  private lockHeld = false;
  private lockWaiters: LockWaiter[] = [];
  private readonly lockContext = new AsyncLocalStorage<symbol>();
  private readonly lockToken = Symbol('demucs-execution-lock');
  private currentJob: {
    resolve: () => void;
    reject: (err: Error) => void;
    onProgress: (pct: number, msg: string) => void;
    onLog: (level: 'INFO' | 'WARN' | 'ERR', msg: string) => void;
    watchdogTimer?: NodeJS.Timeout;
    abortCleanup?: () => void;
  } | null = null;

  public getMetrics(): DemucsWorkerMetrics {
    return {
      workerSpawnCount: this.workerSpawnCount,
      modelInitCount: this.modelInitCount,
      jobsHandledCount: this.jobsHandledCount,
      isRunning: this.child !== null && !this.child.killed,
    };
  }

  public getLockStatus(): { locked: boolean; queuedCount: number } {
    return {
      locked: this.lockHeld,
      queuedCount: this.lockWaiters.length,
    };
  }

  public isLockHeldByCurrentContext(): boolean {
    return this.lockContext.getStore() === this.lockToken;
  }

  private acquireLock(options?: DemucsRunOptions): Promise<void> {
    if (options?.signal?.aborted || options?.isCancelled?.()) {
      return Promise.reject(new Error('Demucs job cancelled before acquiring lock'));
    }

    if (!this.lockHeld) {
      this.lockHeld = true;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: LockWaiter = { resolve, reject };

      if (options?.signal) {
        const onAbort = () => {
          const idx = this.lockWaiters.indexOf(waiter);
          if (idx !== -1) {
            this.lockWaiters.splice(idx, 1);
            waiter.cleanup?.();
            reject(new Error('Demucs job cancelled while waiting in queue'));
          }
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
        waiter.cleanup = () => {
          options.signal?.removeEventListener('abort', onAbort);
        };
      }

      this.lockWaiters.push(waiter);
    });
  }

  private releaseLock(): void {
    while (this.lockWaiters.length > 0) {
      const next = this.lockWaiters.shift()!;
      next.cleanup?.();
      next.resolve();
      return;
    }
    this.lockHeld = false;
  }

  /**
   * Executes a Demucs separation step under one shared FIFO lock across all queues
   * and direct callers. Re-entrant inside the same async job scope so wrapper callers
   * (e.g. separateAndCreateInstrumental) and runJob() do not deadlock.
   */
  public async runWithLock<T>(
    task: () => Promise<T>,
    options?: DemucsRunOptions
  ): Promise<T> {
    if (options?.signal?.aborted || options?.isCancelled?.()) {
      throw new Error('Demucs job cancelled before acquiring lock');
    }

    if (this.isLockHeldByCurrentContext()) {
      return await task();
    }

    await this.acquireLock(options);
    try {
      if (options?.signal?.aborted || options?.isCancelled?.()) {
        throw new Error('Demucs job cancelled before execution');
      }
      return await this.lockContext.run(this.lockToken, task);
    } finally {
      this.releaseLock();
    }
  }

  public resetMetrics() {
    this.workerSpawnCount = 0;
    this.modelInitCount = 0;
    this.jobsHandledCount = 0;
  }

  public stopWorker() {
    this.startingPromise = null;
    if (this.currentJob?.watchdogTimer) {
      clearTimeout(this.currentJob.watchdogTimer);
    }
    this.currentJob?.abortCleanup?.();
    if (this.child) {
      const proc = this.child;
      this.child = null;
      proc.removeAllListeners();
      try {
        proc.kill('SIGTERM');
        setTimeout(() => {
          try {
            if (!proc.killed) proc.kill('SIGKILL');
          } catch {}
        }, 1000);
      } catch {}
    }
    if (this.currentJob) {
      const jobRef = this.currentJob;
      this.currentJob = null;
      jobRef.reject(new Error('Demucs worker stopped'));
    }
  }

  public ensureWorker(pythonBin: string, modelsDir: string): Promise<void> {
    if (this.child && !this.child.killed) {
      return Promise.resolve();
    }
    if (this.startingPromise) {
      return this.startingPromise;
    }

    this.startingPromise = new Promise<void>((resolve, reject) => {
      const splitScriptPath = this.scriptPath || path.join(process.cwd(), 'server', 'lib', 'split.py');
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        OMP_NUM_THREADS: '2',
        MKL_NUM_THREADS: '2',
        OPENBLAS_NUM_THREADS: '2',
      };
      if (modelsDir) {
        env.TORCH_HOME = modelsDir;
        env.HF_HOME = modelsDir;
        env.XDG_CACHE_HOME = modelsDir;
      }

      const args = [splitScriptPath, '--worker'];
      const child = spawn(pythonBin, args, { cwd: process.cwd(), env });
      this.child = child;
      this.workerSpawnCount++;
      this.modelInitCount++;

      let isReady = false;

      const handleStdout = (chunk: Buffer) => {
        const str = chunk.toString();
        const lines = str.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed === '[WORKER_READY]') {
            if (!isReady) {
              isReady = true;
              this.startingPromise = null;
              resolve();
            }
          } else if (trimmed.startsWith('[WORKER_RESULT]')) {
            const jsonStr = trimmed.substring('[WORKER_RESULT]'.length).trim();
            if (this.currentJob) {
              const jobRef = this.currentJob;
              this.currentJob = null;
              if (jobRef.watchdogTimer) clearTimeout(jobRef.watchdogTimer);
              jobRef.abortCleanup?.();
              this.jobsHandledCount++;
              try {
                const res = JSON.parse(jsonStr);
                if (res.ok) {
                  jobRef.resolve();
                } else {
                  jobRef.reject(new Error(res.error || 'Demucs worker separation failed'));
                }
              } catch (e: any) {
                jobRef.reject(new Error(`Failed to parse worker result: ${e.message}`));
              }
            }
          } else {
            if (this.currentJob) {
              this.currentJob.onLog('INFO', trimmed);
            }
          }
        }
      };

      const handleStderr = (chunk: Buffer) => {
        const str = chunk.toString();
        const lines = str.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith('[PROG]')) {
            const match = trimmed.match(/^\[PROG\]\s+(\d+)\s*(.*)$/);
            if (match && this.currentJob) {
              this.currentJob.onProgress(parseInt(match[1], 10), match[2]);
            }
          } else if (trimmed.startsWith('[INFO]')) {
            if (this.currentJob) this.currentJob.onLog('INFO', trimmed.substring(6).trim());
          } else if (trimmed.startsWith('[WARN]')) {
            if (this.currentJob) this.currentJob.onLog('WARN', trimmed.substring(6).trim());
          } else if (trimmed.startsWith('[ERR ]') || trimmed.startsWith('[ERR]')) {
            if (this.currentJob) this.currentJob.onLog('ERR', trimmed.replace(/^\[ERR\s*\]/, '').trim());
          } else {
            if (this.currentJob) this.currentJob.onLog('INFO', trimmed);
          }
        }
      };

      child.stdout.on('data', handleStdout);
      child.stderr.on('data', handleStderr);

      child.on('error', (err) => {
        this.child = null;
        this.startingPromise = null;
        if (!isReady) {
          reject(new Error(`Failed to start Demucs persistent worker: ${err.message}`));
        } else if (this.currentJob) {
          const jobRef = this.currentJob;
          this.currentJob = null;
          if (jobRef.watchdogTimer) clearTimeout(jobRef.watchdogTimer);
          jobRef.abortCleanup?.();
          jobRef.reject(new Error(`Demucs worker error: ${err.message}`));
        }
      });

      child.on('exit', (code, signal) => {
        this.child = null;
        this.startingPromise = null;
        if (!isReady) {
          reject(new Error(`Demucs persistent worker exited during startup with code ${code} / signal ${signal}`));
        } else if (this.currentJob) {
          const jobRef = this.currentJob;
          this.currentJob = null;
          if (jobRef.watchdogTimer) clearTimeout(jobRef.watchdogTimer);
          jobRef.abortCleanup?.();
          jobRef.reject(new Error(`Demucs persistent worker terminated unexpectedly (code ${code}, signal ${signal})`));
        }
      });
    });

    return this.startingPromise;
  }

  public async runJob(
    pythonBin: string,
    splitReqPath: string,
    splitStatusPath: string,
    modelsDir: string,
    onProgress: (pct: number, msg: string) => void,
    onLog: (level: 'INFO' | 'WARN' | 'ERR', msg: string) => void,
    options?: DemucsRunOptions
  ): Promise<void> {
    return this.runWithLock(async () => {
      if (this.currentJob) {
        throw new Error('Demucs worker already has an active job in progress');
      }

      await this.ensureWorker(pythonBin, modelsDir);
      if (!this.child || !this.child.stdin || this.child.killed) {
        throw new Error('Demucs worker process is not active');
      }
      if (options?.signal?.aborted || options?.isCancelled?.()) {
        throw new Error('Demucs job cancelled');
      }

      return new Promise<void>((resolve, reject) => {
        const watchdogTimer = setTimeout(() => {
          if (this.currentJob) {
            onLog('ERR', `Demucs worker job timed out after ${this.jobTimeoutMs / 1000}s. Terminating hung worker...`);
            const jobRef = this.currentJob;
            this.currentJob = null;
            jobRef.abortCleanup?.();
            this.stopWorker();
            jobRef.reject(new Error(`Demucs worker separation timed out after ${this.jobTimeoutMs / 1000}s`));
          }
        }, this.jobTimeoutMs);

        let abortCleanup: (() => void) | undefined;
        if (options?.signal) {
          const onAbort = () => {
            if (this.currentJob) {
              clearTimeout(watchdogTimer);
              const jobRef = this.currentJob;
              this.currentJob = null;
              this.stopWorker();
              jobRef.reject(new Error('Demucs job cancelled'));
            }
          };
          options.signal.addEventListener('abort', onAbort, { once: true });
          abortCleanup = () => {
            options.signal?.removeEventListener('abort', onAbort);
          };
        }

        this.currentJob = { resolve, reject, onProgress, onLog, watchdogTimer, abortCleanup };

        const cmdLine = JSON.stringify({ request_file: splitReqPath, status_file: splitStatusPath }) + '\n';
        this.child!.stdin!.write(cmdLine, 'utf-8', (err) => {
          if (err && this.currentJob) {
            clearTimeout(watchdogTimer);
            abortCleanup?.();
            const jobRef = this.currentJob;
            this.currentJob = null;
            this.stopWorker();
            jobRef.reject(new Error(`Failed to send request to Demucs worker: ${err.message}`));
          }
        });
      });
    }, options);
  }
}

export const demucsWorkerManager = new DemucsWorkerManager();

