import { test, expect, beforeEach, mock } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { TaskRegistry } from "../../src/task/registry"
import { BackgroundTask } from "../../src/task/background"
import { Bus } from "../../src/bus"

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

// Import the tool after helpers
import { TaskWaitForNTool } from "../../src/tool/task-wait-for-n"

// Create a mock execution context
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

test("returns not_found for ghost IDs", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-session-ghost"
      const toolInfo = await TaskWaitForNTool.init()

      const result = await toolInfo.execute(
        {
          task_ids: ["tsk_nonexistent", "tsk_also_nonexistent"],
          min_items: 2,
          timeout: 1000,
        },
        createMockContext(sessionID) as any
      )

      expect(result.output).toContain("not_found")
      expect(result.output).toContain("tsk_nonexistent")
      expect(result.output).toContain("tsk_also_nonexistent")
      expect(result.metadata.completedCount).toBe(2)
    },
  })
})

test("returns immediately for already completed tasks", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-session-completed"

      // Register and complete a task
      const task = createMockTask(sessionID, {
        status: "completed",
        result: "Task finished successfully",
        time: {
          created: Date.now() - 1000,
          started: Date.now() - 500,
          completed: Date.now(),
        },
      })
      TaskRegistry.register(task)
      TaskRegistry.complete(task, "Task finished successfully")

      const toolInfo = await TaskWaitForNTool.init()
      const result = await toolInfo.execute(
        {
          task_ids: [task.id],
          min_items: 1,
          timeout: 5000,
        },
        createMockContext(sessionID) as any
      )

      expect(result.output).toContain("completed")
      expect(result.output).toContain("Task finished successfully")
      expect(result.metadata.completedCount).toBe(1)
    },
  })
})

test("returns immediately when min_items already satisfied", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-session-min-satisfied"

      // Create 3 tasks, 2 completed, 1 running
      const task1 = createMockTask(sessionID, { status: "completed", result: "Result 1" })
      const task2 = createMockTask(sessionID, { status: "completed", result: "Result 2" })
      const task3 = createMockTask(sessionID, { status: "running" })

      TaskRegistry.register(task1)
      TaskRegistry.complete(task1, "Result 1")
      TaskRegistry.register(task2)
      TaskRegistry.complete(task2, "Result 2")
      TaskRegistry.register(task3)

      const toolInfo = await TaskWaitForNTool.init()
      const result = await toolInfo.execute(
        {
          task_ids: [task1.id, task2.id, task3.id],
          min_items: 2, // Only need 2 of 3
          timeout: 5000,
        },
        createMockContext(sessionID) as any
      )

      // Should return immediately since 2 are already complete
      expect(result.metadata.completedCount).toBe(2)
      expect(result.output).toContain("Still Running")
      expect(result.output).toContain(task3.id)
    },
  })
})

test("handles failed tasks correctly", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-session-failed"

      const task = createMockTask(sessionID)
      TaskRegistry.register(task)
      TaskRegistry.fail(task, "Something went wrong")

      const toolInfo = await TaskWaitForNTool.init()
      const result = await toolInfo.execute(
        {
          task_ids: [task.id],
          min_items: 1,
          timeout: 5000,
        },
        createMockContext(sessionID) as any
      )

      expect(result.output).toContain("failed")
      expect(result.output).toContain("Something went wrong")
      expect(result.metadata.completedCount).toBe(1)
    },
  })
})

test("handles cancelled tasks correctly", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-session-cancelled"

      const task = createMockTask(sessionID)
      TaskRegistry.register(task)
      TaskRegistry.cancel(sessionID, task.id)

      const toolInfo = await TaskWaitForNTool.init()
      const result = await toolInfo.execute(
        {
          task_ids: [task.id],
          min_items: 1,
          timeout: 5000,
        },
        createMockContext(sessionID) as any
      )

      expect(result.output).toContain("cancelled")
      expect(result.metadata.completedCount).toBe(1)
    },
  })
})

test("waits for running tasks via Bus events", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-session-events"

      const task = createMockTask(sessionID)
      TaskRegistry.register(task)

      const toolInfo = await TaskWaitForNTool.init()

      // Start wait in background
      const waitPromise = toolInfo.execute(
        {
          task_ids: [task.id],
          min_items: 1,
          timeout: 5000,
        },
        createMockContext(sessionID) as any
      )

      // Give the tool time to set up event listeners
      await Bun.sleep(50)

      // Complete the task - this should trigger the event
      TaskRegistry.complete(task, "Completed via event")

      const result = await waitPromise

      expect(result.output).toContain("completed")
      expect(result.output).toContain("Completed via event")
      expect(result.metadata.completedCount).toBe(1)
    },
  })
}, 10000)

test("times out and returns partial results", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-session-timeout"

      // Create a running task that won't complete
      const task = createMockTask(sessionID)
      TaskRegistry.register(task)

      const toolInfo = await TaskWaitForNTool.init()
      const result = await toolInfo.execute(
        {
          task_ids: [task.id],
          min_items: 1,
          timeout: 100, // Very short timeout
        },
        createMockContext(sessionID) as any
      )

      expect(result.output).toContain("Timed Out")
      expect(result.output).toContain(task.id)
      expect(result.metadata.timedOut).toBe(true)
    },
  })
}, 5000)

test("min_items caps at task count", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-session-cap"

      const task1 = createMockTask(sessionID, { status: "completed", result: "R1" })
      const task2 = createMockTask(sessionID, { status: "completed", result: "R2" })
      TaskRegistry.register(task1)
      TaskRegistry.complete(task1, "R1")
      TaskRegistry.register(task2)
      TaskRegistry.complete(task2, "R2")

      const toolInfo = await TaskWaitForNTool.init()
      const result = await toolInfo.execute(
        {
          task_ids: [task1.id, task2.id],
          min_items: 100, // Requesting more than available
          timeout: 5000,
        },
        createMockContext(sessionID) as any
      )

      // Should return when all 2 are done, not wait for 100
      expect(result.metadata.completedCount).toBe(2)
    },
  })
})

test("handles mixed completed, failed, and not_found", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-session-mixed"

      const completedTask = createMockTask(sessionID, { status: "completed", result: "OK" })
      const failedTask = createMockTask(sessionID)
      TaskRegistry.register(completedTask)
      TaskRegistry.complete(completedTask, "OK")
      TaskRegistry.register(failedTask)
      TaskRegistry.fail(failedTask, "Error")

      const toolInfo = await TaskWaitForNTool.init()
      const result = await toolInfo.execute(
        {
          task_ids: [completedTask.id, failedTask.id, "tsk_ghost"],
          min_items: 3,
          timeout: 5000,
        },
        createMockContext(sessionID) as any
      )

      expect(result.output).toContain("completed")
      expect(result.output).toContain("failed")
      expect(result.output).toContain("not_found")
      expect(result.metadata.completedCount).toBe(3)
    },
  })
})

test("formats output with task details", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-session-format"

      const task = createMockTask(sessionID, {
        status: "completed",
        result: "Detailed output here",
        time: {
          created: Date.now() - 2000,
          started: Date.now() - 1500,
          completed: Date.now(),
        },
      })
      TaskRegistry.register(task)
      TaskRegistry.complete(task, "Detailed output here")

      const toolInfo = await TaskWaitForNTool.init()
      const result = await toolInfo.execute(
        {
          task_ids: [task.id],
          min_items: 1,
          timeout: 5000,
        },
        createMockContext(sessionID) as any
      )

      expect(result.title).toContain("Waited for 1 tasks")
      expect(result.output).toContain("## Task Wait Results")
      expect(result.output).toContain("### Results")
      expect(result.output).toContain(task.id)
      expect(result.output).toContain("Status: completed")
      expect(result.output).toContain("Detailed output here")
    },
  })
})
