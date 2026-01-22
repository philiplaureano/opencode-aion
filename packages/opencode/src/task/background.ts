import z from "zod"
import { BusEvent } from "../bus/bus-event"

export namespace BackgroundTask {
  // Status enum
  export type Status = "queued" | "running" | "completed" | "error" | "cancelled"

  // Type discriminator for task vs bash
  export type TaskType = "task" | "bash"

  // Info schema (Zod for runtime validation)
  export const Info = z.object({
    id: z.string().startsWith("tsk_"),
    type: z.enum(["task", "bash"]).default("task"),
    sessionID: z.string(),           // Parent session that spawned this

    // Task-specific fields (optional for bash tasks)
    childSessionID: z.string().optional(),  // The subagent's own session
    subagentType: z.string().optional(),    // Agent name (e.g., "code-reviewer")
    prompt: z.string().optional(),          // Full prompt given to subagent

    // Bash-specific fields (optional for agent tasks)
    command: z.string().optional(),         // The command being executed
    pid: z.number().optional(),             // Process ID for kill support

    description: z.string(),         // Short task description
    status: z.enum(["queued", "running", "completed", "error", "cancelled"]),
    progress: z.number().optional(), // 0-100 if trackable
    result: z.string().optional(),   // Final output when completed
    error: z.string().optional(),    // Error message if failed
    time: z.object({
      created: z.number(),
      started: z.number().optional(),
      completed: z.number().optional(),
    }),
  })
  export type Info = z.infer<typeof Info>

  // Events
  export const Event = {
    Registered: BusEvent.define("background_task.registered", z.object({
      task: Info,
    })),
    Started: BusEvent.define("background_task.started", z.object({
      task: Info,
    })),
    Progress: BusEvent.define("background_task.progress", z.object({
      task: Info,
      progress: z.number(),
    })),
    Completed: BusEvent.define("background_task.completed", z.object({
      task: Info,
    })),
    Failed: BusEvent.define("background_task.failed", z.object({
      task: Info,
    })),
    Cancelled: BusEvent.define("background_task.cancelled", z.object({
      task: Info,
    })),
  }
}
