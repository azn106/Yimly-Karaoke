import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { db } from '../db/index.js';
import { libraries, songs, lyrics } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import {
  SUPPORTED_AUDIO_EXTS,
  importSingleAudioFile,
  importSingleLrcFile,
  removeSingleFile,
} from './scanner.js';

export interface WatcherEvent {
  libraryId: number;
  filePath: string;
  action: 'upsert' | 'delete';
  isLrc?: boolean;
  isAudio?: boolean;
}

export interface FileSnapshot {
  size: number;
  mtimeMs: number;
  isLrc: boolean;
  isAudio: boolean;
}

interface WatchedLibraryState {
  libraryId: number;
  path: string;
  watcher: fsSync.FSWatcher | null;
  pollTimer: NodeJS.Timeout | null;
  fileIndex: Map<string, FileSnapshot>;
  isPolling: boolean;
  isInitialized: boolean;
}

class LibraryWatcherManager {
  private libraries = new Map<number, WatchedLibraryState>();
  private pendingDebounce = new Map<string, NodeJS.Timeout>();
  private queue: WatcherEvent[] = [];
  private activeProcessing = new Set<string>();
  private concurrency = 2;
  private runningWorkers = 0;
  private isStarted = false;
  private pollIntervalMs: number;

  constructor() {
    const envInterval = process.env.WATCH_POLL_INTERVAL_MS || process.env.LIBRARY_WATCH_POLL_INTERVAL_MS;
    const parsed = envInterval ? parseInt(envInterval, 10) : NaN;
    this.pollIntervalMs = !isNaN(parsed) && parsed >= 500 ? parsed : 3000;
  }

  /**
   * Override or configure the polling interval at runtime.
   */
  public setPollInterval(intervalMs: number): void {
    if (intervalMs >= 100) {
      this.pollIntervalMs = intervalMs;
      // Restart timers for existing libraries
      for (const state of this.libraries.values()) {
        if (state.pollTimer) {
          clearInterval(state.pollTimer);
          state.pollTimer = setInterval(() => {
            this.pollLibrary(state.libraryId).catch((err) => {
              console.error(`[LibraryWatcher] Polling error on library ${state.libraryId}:`, err);
            });
          }, this.pollIntervalMs);
        }
      }
    }
  }

  public getPollInterval(): number {
    return this.pollIntervalMs;
  }

  /**
   * Initializes and starts watchers for all libraries configured in the database.
   */
  public async start(): Promise<void> {
    if (this.isStarted) return;
    this.isStarted = true;

    try {
      const allLibs = await db.select().from(libraries);
      for (const lib of allLibs) {
        await this.watchLibrary(lib.id, lib.path);
      }
      console.log(`[LibraryWatcher] Initialized watchers for ${allLibs.length} media libraries.`);
    } catch (err) {
      console.error('[LibraryWatcher] Failed to start library watchers on DB load:', err);
    }
  }

  /**
   * Attaches or updates a filesystem watcher and polling reconciler for a specific library directory.
   */
  public async watchLibrary(libraryId: number, libPath: string): Promise<void> {
    this.unwatchLibrary(libraryId);

    if (!libPath || typeof libPath !== 'string') return;
    const resolvedPath = path.resolve(libPath);

    const state: WatchedLibraryState = {
      libraryId,
      path: resolvedPath,
      watcher: null,
      pollTimer: null,
      fileIndex: new Map<string, FileSnapshot>(),
      isPolling: false,
      isInitialized: false,
    };

    this.libraries.set(libraryId, state);

    if (!fsSync.existsSync(resolvedPath)) {
      console.warn(`[LibraryWatcher] Directory does not exist, scheduling poll retry: ${resolvedPath}`);
      this.startPollTimer(state);
      return;
    }

    console.log(`[LibraryWatcher] Watching library ${libraryId}: ${resolvedPath}`);

    // 1. Establish initial filesystem baseline
    try {
      await this.establishBaseline(state);
    } catch (baseErr) {
      console.error(`[LibraryWatcher] Error establishing baseline for library ${libraryId}:`, baseErr);
    }

    // 2. Start native fs.watch for immediate notifications when supported (e.g. direct Linux or container writes)
    try {
      const watcher = fsSync.watch(resolvedPath, { recursive: true }, (eventType, relativeFilename) => {
        this.handleFsEvent(libraryId, resolvedPath, relativeFilename);
      });

      watcher.on('error', (err) => {
        console.error(`[LibraryWatcher] Native watcher error on library ${libraryId} (${resolvedPath}):`, err);
      });

      state.watcher = watcher;
    } catch (err) {
      console.warn(`[LibraryWatcher] Native fs.watch not supported or failed for library ${libraryId} (${resolvedPath}), relying on polling:`, err);
    }

    // 3. Start periodic polling reconciliation for Docker bind mounts / Windows host filesystems
    this.startPollTimer(state);
    console.log(`[LibraryWatcher] Polling fallback enabled for library ${libraryId} (interval: ${this.pollIntervalMs}ms)`);
  }

  private startPollTimer(state: WatchedLibraryState): void {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
    }
    state.pollTimer = setInterval(() => {
      this.pollLibrary(state.libraryId).catch((err) => {
        console.error(`[LibraryWatcher] Polling error on library ${state.libraryId}:`, err);
      });
    }, this.pollIntervalMs);
  }

  /**
   * Stops and cleans up the watcher and polling loop for a specific library.
   */
  public unwatchLibrary(libraryId: number): void {
    const state = this.libraries.get(libraryId);
    if (state) {
      if (state.watcher) {
        try {
          state.watcher.close();
        } catch (err) {
          console.warn(`[LibraryWatcher] Error closing watcher for library ${libraryId}:`, err);
        }
      }
      if (state.pollTimer) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
      }
      this.libraries.delete(libraryId);
      console.log(`[LibraryWatcher] Stopped monitoring library ${libraryId}`);
    }
  }

  /**
   * Gracefully shuts down all active watchers and clears pending timers.
   */
  public stopAll(): void {
    for (const [libId, state] of this.libraries.entries()) {
      if (state.watcher) {
        try {
          state.watcher.close();
        } catch {}
      }
      if (state.pollTimer) {
        clearInterval(state.pollTimer);
      }
    }
    this.libraries.clear();

    for (const timer of this.pendingDebounce.values()) {
      clearTimeout(timer);
    }
    this.pendingDebounce.clear();
    this.queue = [];
    this.activeProcessing.clear();
    this.isStarted = false;
    console.log('[LibraryWatcher] All library watchers stopped.');
  }

  /**
   * Initial baseline scan on startup/watch:
   * Indexes existing files on disk so we don't spam notifications on startup,
   * while checking if any files in database are already missing or new files exist offline.
   */
  private async establishBaseline(state: WatchedLibraryState): Promise<void> {
    if (!fsSync.existsSync(state.path)) return;

    const currentFiles = await this.scanDirectoryFiles(state.path);
    for (const [filePath, snap] of currentFiles.entries()) {
      state.fileIndex.set(filePath, snap);
    }

    // Check for songs in the database that no longer exist on disk
    try {
      const dbSongs = await db.select().from(songs).where(eq(songs.libraryId, state.libraryId));
      for (const s of dbSongs) {
        const mainPath = s.mainAudioPath;
        const instPath = s.instrumentalAudioPath;
        const mainExists = mainPath ? fsSync.existsSync(mainPath) : false;
        const instExists = instPath ? fsSync.existsSync(instPath) : false;

        if (!mainExists && !instExists) {
          const pathToDelete = mainPath || instPath;
          if (pathToDelete) {
            console.log(`[LibraryWatcher] Detected deletion (startup reconciliation): ${pathToDelete}`);
            this.enqueue({ libraryId: state.libraryId, filePath: pathToDelete, action: 'delete' });
          }
        } else if (mainPath && !mainExists) {
          console.log(`[LibraryWatcher] Detected main audio deletion (startup reconciliation): ${mainPath}`);
          this.enqueue({ libraryId: state.libraryId, filePath: mainPath, action: 'delete' });
        } else if (instPath && !instExists) {
          console.log(`[LibraryWatcher] Detected instrumental audio deletion (startup reconciliation): ${instPath}`);
          this.enqueue({ libraryId: state.libraryId, filePath: instPath, action: 'delete' });
        }
      }

      // Check lyrics in DB whose files no longer exist on disk
      const dbLyrics = await db.select().from(lyrics);
      for (const lyr of dbLyrics) {
        if (lyr.lrcPath && lyr.lrcPath.trim().length > 0 && !fsSync.existsSync(lyr.lrcPath)) {
          console.log(`[LibraryWatcher] Detected lyrics deletion (startup reconciliation): ${lyr.lrcPath}`);
          this.enqueue({ libraryId: state.libraryId, filePath: lyr.lrcPath, action: 'delete', isLrc: true });
        }
        if (lyr.elrcPath && lyr.elrcPath.trim().length > 0 && !fsSync.existsSync(lyr.elrcPath)) {
          console.log(`[LibraryWatcher] Detected ELRC lyrics deletion (startup reconciliation): ${lyr.elrcPath}`);
          this.enqueue({ libraryId: state.libraryId, filePath: lyr.elrcPath, action: 'delete', isLrc: true });
        }
      }
    } catch (err) {
      console.warn(`[LibraryWatcher] Database check during baseline scan failed:`, err);
    }

    state.isInitialized = true;
  }

  /**
   * Lightweight directory traversal that only collects file paths, sizes, and mtimes.
   * Does NOT invoke expensive metadata extractors or database calls.
   */
  private async scanDirectoryFiles(dirPath: string): Promise<Map<string, FileSnapshot>> {
    const result = new Map<string, FileSnapshot>();

    const walk = async (currentDir: string) => {
      let entries: fsSync.Dirent[];
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          const lower = entry.name.toLowerCase();
          const ext = path.extname(entry.name).toLowerCase();
          const isAudio = SUPPORTED_AUDIO_EXTS.has(ext);
          const isLrc = lower.endsWith('.elrc.lrc') || ext === '.lrc';

          if (isAudio || isLrc) {
            try {
              const stats = await fs.stat(fullPath);
              result.set(fullPath, {
                size: stats.size,
                mtimeMs: stats.mtimeMs,
                isLrc,
                isAudio,
              });
            } catch {}
          }
        }
      }
    };

    await walk(dirPath);
    return result;
  }

  /**
   * Periodic polling pass that compares current filesystem state with the cached snapshot.
   * Discovers additions, modifications, and deletions even when Docker/Windows does not send inotify events.
   */
  public async pollLibrary(libraryId: number): Promise<void> {
    const state = this.libraries.get(libraryId);
    if (!state || state.isPolling) return;

    state.isPolling = true;

    try {
      if (!fsSync.existsSync(state.path)) {
        // Directory missing/unmounted
        if (state.fileIndex.size > 0) {
          for (const filePath of state.fileIndex.keys()) {
            console.log(`[LibraryWatcher] Detected deletion: ${filePath}`);
            this.enqueue({ libraryId, filePath, action: 'delete' });
          }
          state.fileIndex.clear();
        }
        return;
      }

      const currentFiles = await this.scanDirectoryFiles(state.path);

      // 1. Check for new and modified files
      for (const [filePath, currentSnap] of currentFiles.entries()) {
        const cachedSnap = state.fileIndex.get(filePath);

        if (!cachedSnap) {
          // NEW FILE DETECTED
          state.fileIndex.set(filePath, currentSnap);
          if (currentSnap.isLrc) {
            console.log(`[LibraryWatcher] Detected lyrics change: ${filePath}`);
          } else {
            console.log(`[LibraryWatcher] Detected new file: ${filePath}`);
          }
          this.enqueue({
            libraryId,
            filePath,
            action: 'upsert',
            isLrc: currentSnap.isLrc,
            isAudio: currentSnap.isAudio,
          });
        } else {
          // Check if size or mtime changed
          const sizeChanged = cachedSnap.size !== currentSnap.size;
          const mtimeChanged = Math.abs(cachedSnap.mtimeMs - currentSnap.mtimeMs) > 10;

          if (sizeChanged || mtimeChanged) {
            // MODIFIED FILE DETECTED
            state.fileIndex.set(filePath, currentSnap);
            if (currentSnap.isLrc) {
              console.log(`[LibraryWatcher] Detected lyrics change: ${filePath}`);
            } else {
              console.log(`[LibraryWatcher] Detected modified file: ${filePath}`);
            }
            this.enqueue({
              libraryId,
              filePath,
              action: 'upsert',
              isLrc: currentSnap.isLrc,
              isAudio: currentSnap.isAudio,
            });
          }
        }
      }

      // 2. Check for deleted files
      for (const [filePath, cachedSnap] of state.fileIndex.entries()) {
        if (!currentFiles.has(filePath)) {
          // FILE DELETED
          state.fileIndex.delete(filePath);
          console.log(`[LibraryWatcher] Detected deletion: ${filePath}`);
          this.enqueue({
            libraryId,
            filePath,
            action: 'delete',
            isLrc: cachedSnap.isLrc,
            isAudio: cachedSnap.isAudio,
          });
        }
      }
    } catch (err) {
      console.warn(`[LibraryWatcher] Error during polling pass for library ${libraryId}:`, err);
    } finally {
      state.isPolling = false;
    }
  }

  /**
   * Internal handler for raw native filesystem events (e.g. from inotify when supported).
   */
  private handleFsEvent(libraryId: number, rootDir: string, relativeFilename: string | null | undefined): void {
    let fullPath: string;
    if (relativeFilename) {
      fullPath = path.resolve(rootDir, relativeFilename);
    } else {
      fullPath = rootDir;
    }

    const key = `${libraryId}:${fullPath}`;

    // Clear existing debounce timer for this specific path
    const existingTimer = this.pendingDebounce.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Debounce by 400ms to coalesce bursts of native events
    const timer = setTimeout(() => {
      this.pendingDebounce.delete(key);
      this.dispatchNativeEvent(libraryId, fullPath).catch((err) => {
        console.error(`[LibraryWatcher] Error processing native event for ${fullPath}:`, err);
      });
    }, 400);

    this.pendingDebounce.set(key, timer);
  }

  /**
   * Evaluates path from a native event, updates the index, and enqueues worker jobs.
   */
  private async dispatchNativeEvent(libraryId: number, targetPath: string): Promise<void> {
    const state = this.libraries.get(libraryId);
    if (!state) return;

    try {
      const exists = fsSync.existsSync(targetPath);

      if (!exists) {
        // File or directory deleted
        if (state.fileIndex.has(targetPath)) {
          const cached = state.fileIndex.get(targetPath)!;
          state.fileIndex.delete(targetPath);
          console.log(`[LibraryWatcher] Detected deletion: ${targetPath}`);
          this.enqueue({ libraryId, filePath: targetPath, action: 'delete', isLrc: cached.isLrc, isAudio: cached.isAudio });
        } else {
          // Check if any indexed files were inside this deleted directory
          for (const [indexedPath, cached] of state.fileIndex.entries()) {
            if (indexedPath.startsWith(targetPath + path.sep)) {
              state.fileIndex.delete(indexedPath);
              console.log(`[LibraryWatcher] Detected deletion: ${indexedPath}`);
              this.enqueue({ libraryId, filePath: indexedPath, action: 'delete', isLrc: cached.isLrc, isAudio: cached.isAudio });
            }
          }
        }
        return;
      }

      const stats = await fs.stat(targetPath);
      if (stats.isDirectory()) {
        // Newly added directory: scan and enqueue supported files within it
        const currentFiles = await this.scanDirectoryFiles(targetPath);
        for (const [filePath, snap] of currentFiles.entries()) {
          const cached = state.fileIndex.get(filePath);
          if (!cached || cached.size !== snap.size || Math.abs(cached.mtimeMs - snap.mtimeMs) > 10) {
            state.fileIndex.set(filePath, snap);
            console.log(snap.isLrc ? `[LibraryWatcher] Detected lyrics change: ${filePath}` : `[LibraryWatcher] Detected new file: ${filePath}`);
            this.enqueue({ libraryId, filePath, action: 'upsert', isLrc: snap.isLrc, isAudio: snap.isAudio });
          }
        }
        return;
      }

      // Check if it's a supported file
      const lower = path.basename(targetPath).toLowerCase();
      const ext = path.extname(targetPath).toLowerCase();
      const isAudio = SUPPORTED_AUDIO_EXTS.has(ext);
      const isLrc = lower.endsWith('.elrc.lrc') || ext === '.lrc';

      if (isAudio || isLrc) {
        const snap: FileSnapshot = {
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          isLrc,
          isAudio,
        };

        const cached = state.fileIndex.get(targetPath);
        if (!cached) {
          state.fileIndex.set(targetPath, snap);
          console.log(isLrc ? `[LibraryWatcher] Detected lyrics change: ${targetPath}` : `[LibraryWatcher] Detected new file: ${targetPath}`);
          this.enqueue({ libraryId, filePath: targetPath, action: 'upsert', isLrc, isAudio });
        } else if (cached.size !== snap.size || Math.abs(cached.mtimeMs - snap.mtimeMs) > 10) {
          state.fileIndex.set(targetPath, snap);
          console.log(isLrc ? `[LibraryWatcher] Detected lyrics change: ${targetPath}` : `[LibraryWatcher] Detected modified file: ${targetPath}`);
          this.enqueue({ libraryId, filePath: targetPath, action: 'upsert', isLrc, isAudio });
        }
      }
    } catch (err) {
      console.warn(`[LibraryWatcher] Error evaluating path ${targetPath}:`, err);
    }
  }

  /**
   * Adds an event to the processing queue with deduplication and triggers background workers.
   */
  private enqueue(event: WatcherEvent): void {
    const dedupKey = `${event.libraryId}:${event.action}:${event.filePath}`;
    const alreadyQueued = this.queue.some(
      (item) => `${item.libraryId}:${item.action}:${item.filePath}` === dedupKey
    );

    if (!alreadyQueued && !this.activeProcessing.has(dedupKey)) {
      this.queue.push(event);
      this.triggerWorkers();
    }
  }

  private triggerWorkers(): void {
    while (this.runningWorkers < this.concurrency && this.queue.length > 0) {
      const nextJob = this.queue.shift();
      if (nextJob) {
        this.runningWorkers++;
        this.processJob(nextJob)
          .catch((err) => console.error(`[LibraryWatcher] Worker job failed:`, err))
          .finally(() => {
            this.runningWorkers--;
            this.triggerWorkers();
          });
      }
    }
  }

  /**
   * Verifies file stability and executes scanner / cleanup pipelines.
   */
  private async processJob(job: WatcherEvent): Promise<void> {
    const dedupKey = `${job.libraryId}:${job.action}:${job.filePath}`;
    this.activeProcessing.add(dedupKey);

    try {
      if (job.action === 'delete') {
        await removeSingleFile(job.libraryId, job.filePath);
        return;
      }

      // If action is upsert, ensure the file is stable before importing
      if (fsSync.existsSync(job.filePath)) {
        console.log(`[LibraryWatcher] Waiting for file stability: ${job.filePath}`);
        const isStable = await this.waitForFileStability(job.filePath);
        if (!isStable) {
          console.warn(`[LibraryWatcher] File did not stabilize or was removed during copy: ${job.filePath}`);
          return;
        }

        console.log(`[LibraryWatcher] File stable: ${job.filePath}`);
        console.log(`[LibraryWatcher] Enqueueing scan: ${job.filePath}`);

        const ext = path.extname(job.filePath).toLowerCase();
        const lower = job.filePath.toLowerCase();

        if (job.isLrc || lower.endsWith('.elrc.lrc') || ext === '.lrc') {
          await importSingleLrcFile(job.libraryId, job.filePath);
        } else if (job.isAudio || SUPPORTED_AUDIO_EXTS.has(ext)) {
          await importSingleAudioFile(job.libraryId, job.filePath);
        }
      }
    } catch (err) {
      console.error(`[LibraryWatcher] Error processing ${job.filePath}:`, err);
    } finally {
      this.activeProcessing.delete(dedupKey);
    }
  }

  /**
   * Checks whether a file has finished copying by verifying size & mtime over consecutive samples.
   * Handles large files being copied for several minutes without blocking the worker queue indefinitely.
   */
  public async waitForFileStability(
    filePath: string,
    maxWaitMs: number = 30000,
    pollIntervalMs: number = 400
  ): Promise<boolean> {
    const startTime = Date.now();
    let lastSize = -1;
    let lastMtime = -1;

    while (Date.now() - startTime < maxWaitMs) {
      try {
        if (!fsSync.existsSync(filePath)) {
          return false;
        }

        const stats = await fs.stat(filePath);
        const currentSize = stats.size;
        const currentMtime = stats.mtimeMs;

        // If file size is greater than 0 and size & mtime haven't changed since last sample, it's stable
        if (lastSize !== -1 && currentSize === lastSize && currentMtime === lastMtime && currentSize > 0) {
          return true;
        }

        lastSize = currentSize;
        lastMtime = currentMtime;
      } catch {
        return false;
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    // If maxWaitMs reached, check if file exists and has size > 0
    try {
      if (fsSync.existsSync(filePath)) {
        const stats = await fs.stat(filePath);
        return stats.size > 0;
      }
    } catch {}

    return false;
  }

  /**
   * Diagnostic method to inspect watcher status.
   */
  public getStatus() {
    const monitored: Array<{ libraryId: number; path: string; active: boolean; indexedFiles: number }> = [];
    for (const [libId, state] of this.libraries.entries()) {
      monitored.push({
        libraryId: libId,
        path: state.path,
        active: state.watcher !== null || state.pollTimer !== null,
        indexedFiles: state.fileIndex.size,
      });
    }
    return {
      isStarted: this.isStarted,
      pollIntervalMs: this.pollIntervalMs,
      monitoredCount: monitored.length,
      queueLength: this.queue.length,
      activeProcessing: Array.from(this.activeProcessing),
      libraries: monitored,
    };
  }
}

export const libraryWatcher = new LibraryWatcherManager();
