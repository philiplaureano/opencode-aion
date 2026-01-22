import { Tool } from "./tool"
import DESCRIPTION from "./task-list.txt"
import z from "zod"
import { TaskRegistry } from "../task/registry"
import { BackgroundTask } from "../task/background"

interface TaskListMetadata {
  totalCount: number
  byStatus: Record<string, number>
}

export const TaskListTool = Tool.define("tasklist", async () => {
  return {
    description: DESCRIPTION,

    parameters: z.object({
      status_filter: z
        .enum(["all", "running", "completed", "error", "cancelled", "queued"])
        .default("all")
        .describe("Filter tasks by status"),
    }),

    async execute(args, ctx) {
      const allTasks = TaskRegistry.list(ctx.sessionID)

      // Apply filter
      const tasks = args.status_filter === "all"
        ? allTasks
        : allTasks.filter(t => t.status === args.status_filter)

      if (tasks.length === 0) {
        return {
          title: "No tasks found",
          output: args.status_filter === "all"
            ? "No background tasks in this session."
            : `No tasks with status '${args.status_filter}'.`,
          metadata: {
            totalCount: 0,
            byStatus: {},
          } as TaskListMetadata,
        }
      }

      // Group by status for summary
      const byStatus: Record<string, number> = {}
      for (const task of allTasks) {
        byStatus[task.status] = (byStatus[task.status] || 0) + 1
      }

      // Format output
      const lines: string[] = [
        `## Background Tasks`,
        ``,
        `**Total**: ${allTasks.length} tasks`,
        `**Status Summary**: ${formatStatusSummary(byStatus)}`,
        ``,
      ]

      // Sort tasks: running first, then queued, then by completion time
      const sorted = [...tasks].sort((a, b) => {
        const order: Record<string, number> = {
          running: 0,
          queued: 1,
          completed: 2,
          error: 3,
          cancelled: 4,
        }
        const orderA = order[a.status] ?? 5
        const orderB = order[b.status] ?? 5
        if (orderA !== orderB) return orderA - orderB
        return (b.time.created || 0) - (a.time.created || 0)
      })

      for (const task of sorted) {
        lines.push(formatTask(task))
      }

      return {
        title: `${tasks.length} tasks`,
        output: lines.join("\n"),
        metadata: {
          totalCount: tasks.length,
          byStatus,
        } as TaskListMetadata,
      }
    },
  }
})

function formatStatusSummary(byStatus: Record<string, number>): string {
  const parts: string[] = []
  if (byStatus.running) parts.push(`${byStatus.running} running`)
  if (byStatus.queued) parts.push(`${byStatus.queued} queued`)
  if (byStatus.completed) parts.push(`${byStatus.completed} completed`)
  if (byStatus.error) parts.push(`${byStatus.error} failed`)
  if (byStatus.cancelled) parts.push(`${byStatus.cancelled} cancelled`)
  return parts.join(", ") || "none"
}

function formatTask(task: BackgroundTask.Info): string {
  const statusEmoji =
    task.status === "running" ? "▶"
    : task.status === "queued" ? "⏸"
    : task.status === "completed" ? "✓"
    : task.status === "error" ? "✗"
    : task.status === "cancelled" ? "⊘"
    : "?"

  const duration = getDuration(task)
  const durationStr = duration ? ` (${duration})` : ""

  return [
    `### ${statusEmoji} ${task.id}${durationStr}`,
    `- **Status**: ${task.status}`,
    `- **Agent**: ${task.subagentType}`,
    `- **Description**: ${task.description}`,
    task.status === "error" && task.error ? `- **Error**: ${task.error}` : null,
    ``,
  ].filter(Boolean).join("\n")
}

function getDuration(task: BackgroundTask.Info): string | null {
  if (task.time.completed && task.time.started) {
    const ms = task.time.completed - task.time.started
    return formatDuration(ms)
  }
  if (task.status === "running" && task.time.started) {
    const ms = Date.now() - task.time.started
    return formatDuration(ms) + " (running)"
  }
  return null
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${minutes}m ${secs}s`
}
