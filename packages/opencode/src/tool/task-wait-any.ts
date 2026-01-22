import { Tool } from "./tool"
import DESCRIPTION from "./task-wait-any.txt"
import z from "zod"
import { TaskWaitForNTool } from "./task-wait-for-n"

const DEFAULT_TIMEOUT = 300000 // 5 minutes

export const TaskWaitAnyTool = Tool.define("taskwaitany", async () => {
  const waitForNTool = await TaskWaitForNTool.init()

  return {
    description: DESCRIPTION,

    parameters: z.object({
      task_ids: z.array(z.string()).min(1).describe("Array of task IDs to wait on"),
      timeout: z.number().max(600000).min(0).default(DEFAULT_TIMEOUT).describe("Max wait time in ms"),
    }),

    async execute(args, ctx) {
      const { task_ids, timeout } = args

      // Delegate to TaskWaitForN with min_items = 1 (wait for any)
      return waitForNTool.execute(
        {
          task_ids,
          min_items: 1,
          timeout,
        },
        ctx
      )
    },
  }
})
