/**
 * Worker Thread Pool
 *
 * Offloads CPU-heavy analytics, reports, and AI computations
 * from the Node.js main event loop.
 */
import { Worker } from 'worker_threads';
import path from 'path';

interface PendingTask {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timer?: ReturnType<typeof setTimeout>;
}

class WorkerPool {
    private workers: Worker[] = [];
    private queue: Array<{ id: string; type: string; payload: any }> = [];
    private pending = new Map<string, PendingTask>();
    private idle = new Set<number>(); // indices of idle workers
    private taskCounter = 0;
    private readonly scriptPath: string;
    private readonly maxWorkers: number;
    private readonly taskTimeoutMs: number;
    private destroyed = false;

    constructor(options?: {
        maxWorkers?: number;
        taskTimeoutMs?: number;
        scriptPath?: string;
    }) {
        this.maxWorkers = options?.maxWorkers || Math.min(4, require('os').cpus().length);
        this.taskTimeoutMs = options?.taskTimeoutMs || 30000;

        // Detect if running under ts-node/ts-node-dev and adjust worker path accordingly
        const isTsNode = !!(process as any)[Symbol.for('ts-node.register.instance')] || __filename.endsWith('.ts');
        if (options?.scriptPath) {
            this.scriptPath = options.scriptPath;
        } else if (isTsNode) {
            this.scriptPath = path.resolve(__dirname, '../workers/analyticsWorker.ts');
        } else {
            this.scriptPath = path.resolve(__dirname, '../workers/analyticsWorker.js');
        }
        this.init();
    }

    private init() {
        for (let i = 0; i < this.maxWorkers; i++) {
            this.spawnWorker(i);
        }
    }

    private spawnWorker(index: number) {
        try {
            const isTsNode = this.scriptPath.endsWith('.ts');
            const workerOptions = isTsNode ? { execArgv: ['-r', 'ts-node/register'] } : undefined;
            const worker = new Worker(this.scriptPath, workerOptions);
            worker.on('message', (msg: { id: string; result: any; error?: string }) => {
                this.idle.add(index);
                const task = this.pending.get(msg.id);
                if (task) {
                    if (task.timer) clearTimeout(task.timer);
                    this.pending.delete(msg.id);
                    if (msg.error) {
                        task.reject(new Error(msg.error));
                    } else {
                        task.resolve(msg.result);
                    }
                }
                this.processQueue();
            });

            worker.on('error', (err: Error) => {
                console.error(`[WorkerPool] Worker ${index} error:`, err.message);
                this.recycleWorker(index);
            });

            worker.on('exit', (code) => {
                if (code !== 0) {
                    console.warn(`[WorkerPool] Worker ${index} exited with code ${code}, respawning...`);
                    this.recycleWorker(index);
                }
            });

            this.workers[index] = worker;
            this.idle.add(index);
        } catch (err: any) {
            console.error(`[WorkerPool] Failed to spawn worker ${index}:`, err.message);
        }
    }

    private recycleWorker(index: number) {
        this.idle.delete(index);
        if (this.workers[index]) {
            try { this.workers[index].terminate(); } catch { /* ignore */ }
        }
        if (!this.destroyed) {
            this.spawnWorker(index);
        }
    }

    private processQueue() {
        while (this.queue.length > 0 && this.idle.size > 0) {
            const idleIter = this.idle.values().next();
            if (idleIter.done) break;
            const workerIndex = idleIter.value as number;
            this.idle.delete(workerIndex);

            const job = this.queue.shift()!;
            this.workers[workerIndex].postMessage(job);
        }
    }

    execute<T = any>(type: string, payload: any): Promise<T> {
        return new Promise((resolve, reject) => {
            if (this.destroyed) {
                return reject(new Error('Worker pool has been destroyed'));
            }
            this.taskCounter++;
            const id = `${Date.now()}-${this.taskCounter}`;

            const timer = setTimeout(() => {
                const task = this.pending.get(id);
                if (task) {
                    this.pending.delete(id);
                    reject(new Error(`Worker task ${type} timed out after ${this.taskTimeoutMs}ms`));
                }
            }, this.taskTimeoutMs);

            this.pending.set(id, { resolve, reject, timer });
            this.queue.push({ id, type, payload });
            this.processQueue();
        });
    }

    getStats() {
        return {
            workers: this.maxWorkers,
            idleWorkers: this.idle.size,
            pendingTasks: this.pending.size,
            queuedTasks: this.queue.length,
        };
    }

    destroy() {
        this.destroyed = true;
        for (const [id, task] of this.pending) {
            if (task.timer) clearTimeout(task.timer);
            task.reject(new Error('Worker pool destroyed'));
        }
        this.pending.clear();
        this.queue = [];
        for (const worker of this.workers) {
            try { worker.terminate(); } catch { /* ignore */ }
        }
        this.workers = [];
        this.idle.clear();
    }
}

let globalPool: WorkerPool | null = null;

export const getWorkerPool = (): WorkerPool => {
    if (!globalPool) {
        globalPool = new WorkerPool();
    }
    return globalPool;
};

export const destroyWorkerPool = () => {
    if (globalPool) {
        globalPool.destroy();
        globalPool = null;
    }
};
