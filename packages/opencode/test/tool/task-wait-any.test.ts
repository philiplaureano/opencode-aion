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

import { TaskWaitAnyTool } from "../../src/tool/task-wait-any"

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

test("returns immediately when one task is already complete", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-wait-any-1"

      // Create 3 tasks, only 1 completed
      const task1 = createMockTask(sessionID, { status: "completed", result: "First!" })
      const task2 = createMockTask(sessionID, { status: "running" })
      const task3 = createMockTask(sessionID, { status: "running" })

      TaskRegistry.register(task1)
      TaskRegistry.complete(task1, "First!")
      TaskRegistry.register(task2)
      TaskRegistry.register(task3)

      const toolInfo = await TaskWaitAnyTool.init()
      const result = await toolInfo.execute(
        {
          task_ids: [task1.id, task2.id, task3.id],
          timeout: 5000,
        },
        createMockContext(sessionID) as any
      )

      // Should return immediately with 1 completed, 2 still running
      expect(result.metadata.completedCount).toBe(1)
      expect(result.output).toContain("First!")
      expect(result.output).toContain("Still Running")
    },
  })
})

test("returns ghost ID immediately as first completion", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-wait-any-ghost"

      const toolInfo = await TaskWaitAnyTool.init()
      const result = await toolInfo.execute(
        {
          task_ids: ["tsk_ghost"],
          timeout: 1000,
        },
        createMockContext(sessionID) as any
      )

      // Ghost ID counts as "complete" (not_found)
      expect(result.output).toContain("not_found")
      expect(result.metadata.completedCount).toBe(1)
    },
  })
})

test("times out when no task completes", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-wait-any-timeout"

      const task = createMockTask(sessionID, { status: "running" })
      TaskRegistry.register(task)

      const toolInfo = await TaskWaitAnyTool.init()
      const result = await toolInfo.execute(
        {
          task_ids: [task.id],
          timeout: 100, // Short timeout
        },
        createMockContext(sessionID) as any
      )

      expect(result.metadata.timedOut).toBe(true)
      expect(result.output).toContain("Timed Out")
    },
  })
}, 5000)

test("accepts failed task as completion", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-wait-any-failed"

      const task = createMockTask(sessionID)
      TaskRegistry.register(task)
      TaskRegistry.fail(task, "Oops")

      const toolInfo = await TaskWaitAnyTool.init()
      const result = await toolInfo.execute(
        {
          task_ids: [task.id],
          timeout: 5000,
        },
        createMockContext(sessionID) as any
      )

      expect(result.metadata.completedCount).toBe(1)
      expect(result.output).toContain("failed")
    },
  })
})
