import { Tool } from "./tool"
import DESCRIPTION from "./kill-task.txt"
import z from "zod"
import { TaskRegistry } from "../task/registry"

/** Unified metadata type for kill-task tool results */
interface KillTaskMetadata {
  taskId: string
  cancelled: boolean
  status?: string
}

export const KillTaskTool = Tool.define("killtask", async () => {
  return {
    description: DESCRIPTION,

    parameters: z.object({
      task_id: z.string().describe("The task ID to kill"),
    }),

    async execute(args, ctx) {
      const success = TaskRegistry.cancel(ctx.sessionID, args.task_id)

      if (success) {
        return {
          title: `Task ${args.task_id} cancelled`,
          output: `Successfully cancelled task ${args.task_id}`,
          metadata: { taskId: args.task_id, cancelled: true } as KillTaskMetadata,
        }
      }

      const task = TaskRegistry.get(ctx.sessionID, args.task_id)
      if (task) {
        return {
          title: "Cannot cancel task",
          output: `Task ${args.task_id} is already ${task.status} and cannot be cancelled`,
          metadata: { taskId: args.task_id, status: task.status, cancelled: false } as KillTaskMetadata,
        }
      }

      return {
        title: "Task not found",
        output: `No task found with ID: ${args.task_id}`,
        metadata: { taskId: args.task_id, cancelled: false } as KillTaskMetadata,
      }
    },
  }
})
