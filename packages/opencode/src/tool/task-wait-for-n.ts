import { Tool } from "./tool"
import DESCRIPTION from "./task-wait-for-n.txt"
import z from "zod"
import { TaskRegistry } from "../task/registry"
import { BackgroundTask } from "../task/background"
import { Bus } from "../bus"
import { Truncate } from "./truncation"
import type { Agent } from "../agent/agent"

/** Result for a single completed task */
interface TaskResult {
  task_id: string
  status: "completed" | "failed" | "cancelled" | "not_found"
  output: string
  duration?: number
  outputPath?: string
}

/** Metadata returned by the tool */
interface TaskWaitForNMetadata {
  completedCount: number
  minItemsRequested: number
  timedOut: boolean
  totalRequested: number
}

const DEFAULT_TIMEOUT = 300000 // 5 minutes

export const TaskWaitForNTool = Tool.define("taskwaitforn", async () => {
  return {
    description: DESCRIPTION,

    parameters: z.object({
      task_ids: z.array(z.string()).min(1).describe("Array of task IDs to wait on"),
      min_items: z.number().min(1).describe("Minimum number of tasks to wait for"),
      timeout: z.number().max(600000).min(0).default(DEFAULT_TIMEOUT).describe("Max wait time in ms"),
    }),

    async execute(args, ctx) {
      const { task_ids, min_items, timeout } = args
      const sessionID = ctx.sessionID
      const agent = (ctx as any).agent as Agent.Info | undefined

      // Validate min_items doesn't exceed task count
      const effectiveMinItems = Math.min(min_items, task_ids.length)

      // Track results
      const completed: TaskResult[] = []
      const pending = new Set(task_ids)

      // First pass: check for ghost IDs and already-terminal tasks
      for (const taskId of task_ids) {
        const task = TaskRegistry.get(sessionID, taskId)
        if (!task) {
          // Ghost ID - mark as not_found
          completed.push({
            task_id: taskId,
            status: "not_found",
            output: `Task ${taskId} not found in registry`,
          })
          pending.delete(taskId)
        } else if (isTerminal(task.status)) {
          // Already completed
          const result = await formatTaskResult(task, agent)
          completed.push(result)
          pending.delete(taskId)
        }
      }

      // Check if we already have enough
      if (completed.length >= effectiveMinItems) {
        return formatOutput(completed, Array.from(pending), [], effectiveMinItems)
      }

      // If nothing left to wait for, return what we have
      if (pending.size === 0) {
        return formatOutput(completed, [], [], effectiveMinItems)
      }

      // Set up event-based waiting
      const startTime = Date.now()

      return new Promise<ReturnType<typeof formatOutput>>((resolve) => {
        let resolved = false
        const unsubscribers: (() => void)[] = []

        const checkDone = () => {
          if (resolved) return

          // Check if we have enough completions
          if (completed.length >= effectiveMinItems) {
            cleanup()
            resolve(formatOutput(completed, Array.from(pending), [], effectiveMinItems))
            return
          }

          // Check timeout
          if (Date.now() - startTime >= timeout) {
            cleanup()
            const timedOut = Array.from(pending)
            resolve(formatOutput(completed, [], timedOut, effectiveMinItems))
            return
          }

          // Check abort
          if (ctx.abort.aborted) {
            cleanup()
            resolve(formatOutput(completed, Array.from(pending), [], effectiveMinItems))
            return
          }
        }

        const cleanup = () => {
          resolved = true
          for (const unsub of unsubscribers) {
            unsub()
          }
        }

        const handleTaskEvent = async (
          taskId: string,
          status: "completed" | "failed" | "cancelled"
        ) => {
          if (!pending.has(taskId)) return

          const task = TaskRegistry.get(sessionID, taskId)
          if (task) {
            const result = await formatTaskResult(task, agent)
            completed.push(result)
          } else {
            completed.push({
              task_id: taskId,
              status,
              output: `Task ${taskId} ${status} but details unavailable`,
            })
          }
          pending.delete(taskId)
          checkDone()
        }

        // Subscribe to completion events
        unsubscribers.push(
          Bus.subscribe(BackgroundTask.Event.Completed, async (event) => {
            if (event.properties.task.sessionID === sessionID) {
              await handleTaskEvent(event.properties.task.id, "completed")
            }
          })
        )

        unsubscribers.push(
          Bus.subscribe(BackgroundTask.Event.Failed, async (event) => {
            if (event.properties.task.sessionID === sessionID) {
              await handleTaskEvent(event.properties.task.id, "failed")
            }
          })
        )

        unsubscribers.push(
          Bus.subscribe(BackgroundTask.Event.Cancelled, async (event) => {
            if (event.properties.task.sessionID === sessionID) {
              await handleTaskEvent(event.properties.task.id, "cancelled")
            }
          })
        )

        // Set up timeout
        const timeoutId = setTimeout(() => {
          if (resolved) return
          cleanup()
          const timedOut = Array.from(pending)
          resolve(formatOutput(completed, [], timedOut, effectiveMinItems))
        }, timeout)

        unsubscribers.push(() => clearTimeout(timeoutId))

        // Initial check in case we already have enough
        checkDone()
      })
    },
  }
})

function isTerminal(status: BackgroundTask.Status): boolean {
  return status === "completed" || status === "error" || status === "cancelled"
}

async function formatTaskResult(task: BackgroundTask.Info, agent?: Agent.Info): Promise<TaskResult> {
  let output = ""
  let outputPath: string | undefined

  if (task.status === "completed") {
    output = task.result || "Task completed with no output"
  } else if (task.status === "error") {
    output = `Task failed: ${task.error || "Unknown error"}`
  } else if (task.status === "cancelled") {
    output = "Task was cancelled"
  } else {
    output = `Task status: ${task.status}`
  }

  // Truncate output to prevent context explosion
  const truncated = await Truncate.output(output, {}, agent)
  if (truncated.truncated) {
    output = truncated.content
    outputPath = truncated.outputPath
  }

  const statusMap: Record<string, TaskResult["status"]> = {
    completed: "completed",
    error: "failed",
    cancelled: "cancelled",
  }

  return {
    task_id: task.id,
    status: statusMap[task.status] || "failed",
    output,
    duration: task.time.completed && task.time.started
      ? task.time.completed - task.time.started
      : undefined,
    outputPath,
  }
}

function formatOutput(
  completed: TaskResult[],
  stillRunning: string[],
  timedOut: string[],
  minItemsRequested: number
) {
  const successCount = completed.filter(r => r.status === "completed").length
  const failedCount = completed.filter(r => r.status === "failed").length
  const cancelledCount = completed.filter(r => r.status === "cancelled").length
  const notFoundCount = completed.filter(r => r.status === "not_found").length

  const lines: string[] = [
    `## Task Wait Results`,
    ``,
    `**Requested**: Wait for ${minItemsRequested} of ${completed.length + stillRunning.length + timedOut.length} tasks`,
    `**Completed**: ${completed.length} (${successCount} succeeded, ${failedCount} failed, ${cancelledCount} cancelled, ${notFoundCount} not found)`,
  ]

  if (stillRunning.length > 0) {
    lines.push(`**Still Running**: ${stillRunning.length} tasks`)
  }

  if (timedOut.length > 0) {
    lines.push(`**Timed Out**: ${timedOut.length} tasks`)
  }

  lines.push(``, `### Results`)

  for (const result of completed) {
    const statusEmoji = result.status === "completed" ? "✓" :
                        result.status === "failed" ? "✗" :
                        result.status === "cancelled" ? "⊘" : "?"
    const durationStr = result.duration ? ` (${Math.round(result.duration / 1000)}s)` : ""

    lines.push(``, `#### ${statusEmoji} ${result.task_id}${durationStr}`)
    lines.push(`Status: ${result.status}`)
    if (result.outputPath) {
      lines.push(`Full output: ${result.outputPath}`)
    }
    lines.push(``)
    lines.push(result.output)
  }

  if (stillRunning.length > 0) {
    lines.push(``, `### Still Running`)
    for (const taskId of stillRunning) {
      lines.push(`- ${taskId}`)
    }
  }

  if (timedOut.length > 0) {
    lines.push(``, `### Timed Out (did not complete in time)`)
    for (const taskId of timedOut) {
      lines.push(`- ${taskId}`)
    }
  }

  return {
    title: `Waited for ${completed.length} tasks`,
    output: lines.join("\n"),
    metadata: {
      completedCount: completed.length,
      minItemsRequested,
      timedOut: timedOut.length > 0,
      totalRequested: completed.length + stillRunning.length + timedOut.length,
    } as TaskWaitForNMetadata,
  }
}
