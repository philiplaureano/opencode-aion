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

import { TaskListTool } from "../../src/tool/task-list"

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

test("returns empty list when no tasks", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-list-empty-" + Math.random().toString(36).slice(2)

      const toolInfo = await TaskListTool.init()
      const result = await toolInfo.execute(
        { status_filter: "all" },
        createMockContext(sessionID) as any
      )

      expect(result.output).toContain("No background tasks")
      expect(result.metadata.totalCount).toBe(0)
    },
  })
})

test("lists all tasks in session", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-list-all"

      const task1 = createMockTask(sessionID, {
        status: "completed",
        result: "Done",
        subagentType: "explore",
        description: "Explore codebase",
      })
      const task2 = createMockTask(sessionID, {
        status: "running",
        subagentType: "bash",
        description: "Run build",
      })

      TaskRegistry.register(task1)
      TaskRegistry.complete(task1, "Done")
      TaskRegistry.register(task2)

      const toolInfo = await TaskListTool.init()
      const result = await toolInfo.execute(
        { status_filter: "all" },
        createMockContext(sessionID) as any
      )

      expect(result.metadata.totalCount).toBe(2)
      expect(result.output).toContain(task1.id)
      expect(result.output).toContain(task2.id)
      expect(result.output).toContain("explore")
      expect(result.output).toContain("bash")
      expect(result.output).toContain("Explore codebase")
      expect(result.output).toContain("Run build")
    },
  })
})

test("filters by status", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-list-filter"

      const task1 = createMockTask(sessionID, { status: "completed", result: "Done" })
      const task2 = createMockTask(sessionID, { status: "running" })
      const task3 = createMockTask(sessionID)

      TaskRegistry.register(task1)
      TaskRegistry.complete(task1, "Done")
      TaskRegistry.register(task2)
      TaskRegistry.register(task3)
      TaskRegistry.fail(task3, "Error")

      const toolInfo = await TaskListTool.init()

      // Filter to running only
      const runningResult = await toolInfo.execute(
        { status_filter: "running" },
        createMockContext(sessionID) as any
      )
      expect(runningResult.metadata.totalCount).toBe(1)
      expect(runningResult.output).toContain(task2.id)
      expect(runningResult.output).not.toContain(task1.id)
      expect(runningResult.output).not.toContain(task3.id)

      // Filter to error only
      const errorResult = await toolInfo.execute(
        { status_filter: "error" },
        createMockContext(sessionID) as any
      )
      expect(errorResult.metadata.totalCount).toBe(1)
      expect(errorResult.output).toContain(task3.id)
    },
  })
})

test("shows status summary", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-list-summary"

      const task1 = createMockTask(sessionID, { status: "completed", result: "Done" })
      const task2 = createMockTask(sessionID, { status: "completed", result: "Done2" })
      const task3 = createMockTask(sessionID, { status: "running" })

      TaskRegistry.register(task1)
      TaskRegistry.complete(task1, "Done")
      TaskRegistry.register(task2)
      TaskRegistry.complete(task2, "Done2")
      TaskRegistry.register(task3)

      const toolInfo = await TaskListTool.init()
      const result = await toolInfo.execute(
        { status_filter: "all" },
        createMockContext(sessionID) as any
      )

      expect(result.output).toContain("2 completed")
      expect(result.output).toContain("1 running")
      expect(result.metadata.byStatus.completed).toBe(2)
      expect(result.metadata.byStatus.running).toBe(1)
    },
  })
})

test("isolates sessions", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionA = "session-A"
      const sessionB = "session-B"

      const taskA = createMockTask(sessionA, { status: "completed", result: "A" })
      const taskB = createMockTask(sessionB, { status: "completed", result: "B" })

      TaskRegistry.register(taskA)
      TaskRegistry.complete(taskA, "A")
      TaskRegistry.register(taskB)
      TaskRegistry.complete(taskB, "B")

      const toolInfo = await TaskListTool.init()

      // Session A should only see task A
      const resultA = await toolInfo.execute(
        { status_filter: "all" },
        createMockContext(sessionA) as any
      )
      expect(resultA.metadata.totalCount).toBe(1)
      expect(resultA.output).toContain(taskA.id)
      expect(resultA.output).not.toContain(taskB.id)

      // Session B should only see task B
      const resultB = await toolInfo.execute(
        { status_filter: "all" },
        createMockContext(sessionB) as any
      )
      expect(resultB.metadata.totalCount).toBe(1)
      expect(resultB.output).toContain(taskB.id)
      expect(resultB.output).not.toContain(taskA.id)
    },
  })
})
