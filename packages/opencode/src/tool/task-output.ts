import { Tool } from "./tool"
import DESCRIPTION from "./task-output.txt"
import z from "zod"
import { TaskRegistry } from "../task/registry"
import { BackgroundTask } from "../task/background"

/** Unified metadata type for task-output tool results */
interface TaskOutputMetadata {
  taskId?: string
  status?: string
  progress?: number
  duration?: number
  error?: string
  timedOut?: boolean
}

export const TaskOutputTool = Tool.define("taskoutput", async () => {
  return {
    description: DESCRIPTION,

    parameters: z.object({
      task_id: z.string().describe("The task ID to get output from"),
      block: z.boolean().default(true).describe("Whether to wait for completion"),
      timeout: z.number().max(600000).min(0).default(30000).describe("Max wait time in ms"),
    }),

    async execute(args, ctx) {
      const task = TaskRegistry.get(ctx.sessionID, args.task_id)

      if (!task) {
        return {
          title: "Task not found",
          output: `No task found with ID: ${args.task_id}`,
          metadata: { error: "not_found" } as TaskOutputMetadata,
        }
      }

      // Non-blocking status check
      if (!args.block) {
        return formatTaskStatus(task)
      }

      // Already terminal?
      if (isTerminal(task.status)) {
        return formatTaskResult(task)
      }

      // Wait for completion with timeout
      const startTime = Date.now()
      while (Date.now() - startTime < args.timeout) {
        await Bun.sleep(500) // Poll every 500ms

        const updated = TaskRegistry.get(ctx.sessionID, args.task_id)
        if (!updated) break

        if (isTerminal(updated.status)) {
          return formatTaskResult(updated)
        }

        // Check abort signal
        if (ctx.abort.aborted) {
          return {
            title: "Wait cancelled",
            output: "Task output retrieval was cancelled",
            metadata: { status: updated.status } as TaskOutputMetadata,
          }
        }
      }

      // Timeout - return current status
      const current = TaskRegistry.get(ctx.sessionID, args.task_id)
      return {
        title: "Timeout waiting for task",
        output: `Task ${args.task_id} is still ${current?.status || "unknown"} after ${args.timeout}ms`,
        metadata: {
          status: current?.status,
          timedOut: true,
        } as TaskOutputMetadata,
      }
    },
  }
})

function isTerminal(status: BackgroundTask.Status): boolean {
  return status === "completed" || status === "error" || status === "cancelled"
}

function formatTaskStatus(task: BackgroundTask.Info) {
  const elapsed = task.time.started
    ? Math.round((Date.now() - task.time.started) / 1000)
    : 0

  return {
    title: `Task ${task.id}: ${task.status}`,
    output: [
      `Status: ${task.status}`,
      `Agent: ${task.subagentType}`,
      `Description: ${task.description}`,
      task.status === "running" ? `Running for: ${elapsed}s` : null,
      task.progress !== undefined ? `Progress: ${task.progress}%` : null,
    ].filter(Boolean).join("\n"),
    metadata: {
      taskId: task.id,
      status: task.status,
      progress: task.progress,
    } as TaskOutputMetadata,
  }
}

function formatTaskResult(task: BackgroundTask.Info) {
  if (task.status === "completed") {
    return {
      title: `Task ${task.id}: completed`,
      output: task.result || "Task completed with no output",
      metadata: {
        taskId: task.id,
        status: "completed",
        duration: task.time.completed! - task.time.started!,
      } as TaskOutputMetadata,
    }
  }

  if (task.status === "error") {
    return {
      title: `Task ${task.id}: failed`,
      output: `Task failed with error: ${task.error}`,
      metadata: {
        taskId: task.id,
        status: "error",
        error: task.error,
      } as TaskOutputMetadata,
    }
  }

  return {
    title: `Task ${task.id}: ${task.status}`,
    output: `Task was ${task.status}`,
    metadata: { taskId: task.id, status: task.status } as TaskOutputMetadata,
  }
}
