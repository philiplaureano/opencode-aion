import { test, expect, mock } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { TaskRegistry } from "../../src/task/registry"
import { BackgroundTask } from "../../src/task/background"

// Helper to create mock task info
function createMockTask(
  sessionID: string,
  overrides?: Partial<BackgroundTask.Info>
): BackgroundTask.Info {
  return {
    id: "tsk_" + Math.random().toString(36).slice(2),
    type: "task",
    sessionID,
    childSessionID: "child_" + Math.random().toString(36).slice(2),
    subagentType: "test-agent",
    prompt: "Test prompt",
    description: "Test task",
    status: "queued",
    time: { created: Date.now() },
    ...overrides,
  }
}

import { TaskWaitAllTool } from "../../src/tool/task-wait-all"

function createMockContext(sessionID: string) {
  return {
    sessionID,
    messageID: "msg-" + Math.random().toString(36).slice(2),
    agent: "test",
    abort: new AbortController().signal,
    metadata: mock(() => {}),
    ask: mock(() => Promise.resolve()),
  }
}

test("waits for all tasks to complete", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-wait-all-1"

      // Create and complete 3 tasks
      const task1 = createMockTask(sessionID, { status: "completed", result: "R1" })
      const task2 = createMockTask(sessionID, { status: "completed", result: "R2" })
      const task3 = createMockTask(sessionID, { status: "completed", result: "R3" })

      TaskRegistry.register(task1)
      TaskRegistry.complete(task1, "R1")
      TaskRegistry.register(task2)
      TaskRegistry.complete(task2, "R2")
      TaskRegistry.register(task3)
      TaskRegistry.complete(task3, "R3")

      const toolInfo = await TaskWaitAllTool.init()
      const result = await toolInfo.execute(
        {
          task_ids: [task1.id, task2.id, task3.id],
          timeout: 5000,
        },
        createMockContext(sessionID) as any
      )

      // Should have all 3 completed
      expect(result.metadata.completedCount).toBe(3)
      expect(result.output).toContain("R1")
      expect(result.output).toContain("R2")
      expect(result.output).toContain("R3")
    },
  })
})

test("handles ghost IDs same as TaskWaitForN", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-wait-all-ghost"

      const toolInfo = await TaskWaitAllTool.init()
      const result = await toolInfo.execute(
        {
          task_ids: ["tsk_ghost1", "tsk_ghost2"],
          timeout: 1000,
        },
        createMockContext(sessionID) as any
      )

      expect(result.output).toContain("not_found")
      expect(result.output).toContain("tsk_ghost1")
      expect(result.output).toContain("tsk_ghost2")
      expect(result.metadata.completedCount).toBe(2)
    },
  })
})

test("includes failed tasks in results", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-wait-all-failed"

      const task1 = createMockTask(sessionID, { status: "completed", result: "OK" })
      const task2 = createMockTask(sessionID)

      TaskRegistry.register(task1)
      TaskRegistry.complete(task1, "OK")
      TaskRegistry.register(task2)
      TaskRegistry.fail(task2, "Error!")

      const toolInfo = await TaskWaitAllTool.init()
      const result = await toolInfo.execute(
        {
          task_ids: [task1.id, task2.id],
          timeout: 5000,
        },
        createMockContext(sessionID) as any
      )

      expect(result.metadata.completedCount).toBe(2)
      expect(result.output).toContain("completed")
      expect(result.output).toContain("failed")
    },
  })
})
