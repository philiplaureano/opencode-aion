import { Instance } from "../project/instance"
import { Bus } from "../bus"
import { BackgroundTask } from "./background"
import { SessionPrompt } from "../session/prompt"
import { Log } from "../util/log"
import { Shell } from "../shell/shell"

export namespace TaskRegistry {
  const log = Log.create({ service: "task.registry" })

  // Sanity bounds
  const MIN_CONCURRENT = 1
  const MAX_ALLOWED = 128 // Hard ceiling - vanity number, dial back if friction
  const DEFAULT_CONCURRENT = 32

  function getMaxConcurrent(): number {
    // Read env var at runtime to allow test overrides
    const maxConcurrent = parseInt(process.env.OPENCODE_MAX_BACKGROUND_TASKS || String(DEFAULT_CONCURRENT), 10)
    return Math.min(Math.max(maxConcurrent, MIN_CONCURRENT), MAX_ALLOWED)
  }

  interface State {
    tasks: Map<string, BackgroundTask.Info>
    running: Set<string>
    queue: string[] // Task IDs waiting for slot
  }

  // Per-instance state (follows SessionPrompt pattern from prompt.ts:55-77)
  const state = Instance.state<Record<string, State>>(
    () => ({}),
    async (current) => {
      // Cleanup: cancel all running tasks on dispose
      for (const [_sessionID, s] of Object.entries(current)) {
        for (const taskID of s.running) {
          const task = s.tasks.get(taskID)
          if (task) {
            if (task.type === "bash" && task.pid) {
              try { process.kill(task.pid) } catch {}
            } else if (task.childSessionID) {
              SessionPrompt.cancel(task.childSessionID)
            }
          }
        }
      }
    }
  )

  function getState(sessionID: string): State {
    const s = state()
    if (!s[sessionID]) {
      s[sessionID] = {
        tasks: new Map(),
        running: new Set(),
        queue: [],
      }
    }
    return s[sessionID]
  }

  export function register(task: BackgroundTask.Info): void {
    const s = getState(task.sessionID)
    s.tasks.set(task.id, task)

    log.info("registering background task", { taskId: task.id, sessionId: task.sessionID, type: task.type })

    if (s.running.size < getMaxConcurrent()) {
      s.running.add(task.id)
      task.status = "running"
      task.time.started = Date.now()
      Bus.publish(BackgroundTask.Event.Started, { task })
    } else {
      task.status = "queued"
      s.queue.push(task.id)
      log.info("task queued", { taskId: task.id, queueLength: s.queue.length })
    }

    Bus.publish(BackgroundTask.Event.Registered, { task })
  }

  export function get(sessionID: string, taskID: string): BackgroundTask.Info | undefined {
    return getState(sessionID).tasks.get(taskID)
  }

  export function list(sessionID: string): BackgroundTask.Info[] {
    return Array.from(getState(sessionID).tasks.values())
  }

  export function update(task: BackgroundTask.Info): void {
    const s = getState(task.sessionID)
    s.tasks.set(task.id, task)
  }

  export function complete(task: BackgroundTask.Info, result: string): void {
    const s = getState(task.sessionID)
    task.status = "completed"
    task.result = result
    task.time.completed = Date.now()
    s.running.delete(task.id)

    log.info("task completed", { taskId: task.id, type: task.type })

    processQueue(task.sessionID)
    Bus.publish(BackgroundTask.Event.Completed, { task })
  }

  export function fail(task: BackgroundTask.Info, error: string): void {
    const s = getState(task.sessionID)
    task.status = "error"
    task.error = error
    task.time.completed = Date.now()
    s.running.delete(task.id)

    log.error("task failed", { taskId: task.id, type: task.type, error })

    processQueue(task.sessionID)
    Bus.publish(BackgroundTask.Event.Failed, { task })
  }

  export function cancel(sessionID: string, taskID: string): boolean {
    const s = getState(sessionID)
    const task = s.tasks.get(taskID)
    if (!task) return false

    if (task.status === "queued") {
      s.queue = s.queue.filter(id => id !== taskID)
    } else if (task.status === "running") {
      // Handle based on task type
      if (task.type === "bash" && task.pid) {
        try { process.kill(task.pid) } catch {}
      } else if (task.childSessionID) {
        SessionPrompt.cancel(task.childSessionID)
      }
      s.running.delete(taskID)
    } else {
      return false // Already terminal
    }

    task.status = "cancelled"
    task.time.completed = Date.now()

    log.info("task cancelled", { taskId: taskID, type: task.type })

    processQueue(sessionID)
    Bus.publish(BackgroundTask.Event.Cancelled, { task })
    return true
  }

  function processQueue(sessionID: string): void {
    const s = getState(sessionID)
    while (s.running.size < getMaxConcurrent() && s.queue.length > 0) {
      const nextID = s.queue.shift()!
      const task = s.tasks.get(nextID)
      if (task && task.status === "queued") {
        s.running.add(nextID)
        task.status = "running"
        task.time.started = Date.now()
        Bus.publish(BackgroundTask.Event.Started, { task })
        // Note: Actual execution is triggered by the Task tool when it registers
        // This just manages state and queue - execution happens in the Task tool
      }
    }
  }

  /**
   * Start executing a background task.
   * This is called by the Task tool after registration.
   * The provided executor function runs the actual SessionPrompt.prompt call.
   */
  export async function executeBackground(
    task: BackgroundTask.Info,
    executor: () => Promise<string>
  ): Promise<void> {
    try {
      const result = await executor()
      complete(task, result)
    } catch (err) {
      fail(task, err instanceof Error ? err.message : String(err))
    }
  }
}
