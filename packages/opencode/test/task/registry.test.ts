import { test, expect, beforeEach } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { TaskRegistry } from "../../src/task/registry"
import { BackgroundTask } from "../../src/task/background"

function createMockTask(sessionID: string, overrides?: Partial<BackgroundTask.Info>): BackgroundTask.Info {
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

function createMockBashTask(sessionID: string, overrides?: Partial<BackgroundTask.Info>): BackgroundTask.Info {
  return {
    id: "tsk_" + Math.random().toString(36).slice(2),
    type: "bash",
    sessionID,
    command: "echo hello",
    description: "Test bash task",
    status: "queued",
    time: { created: Date.now() },
    ...overrides,
  }
}

test("register adds task to registry and starts immediately when below limit", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-session-1"
      const task = createMockTask(sessionID)

      TaskRegistry.register(task)

      const retrieved = TaskRegistry.get(sessionID, task.id)
      expect(retrieved).toBeDefined()
      expect(retrieved?.status).toBe("running")
      expect(retrieved?.time.started).toBeDefined()
    },
  })
})

test("list returns all tasks for a session", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-session-2"
      const task1 = createMockTask(sessionID)
      const task2 = createMockTask(sessionID)

      TaskRegistry.register(task1)
      TaskRegistry.register(task2)

      const tasks = TaskRegistry.list(sessionID)
      expect(tasks.length).toBe(2)
      expect(tasks.map(t => t.id)).toContain(task1.id)
      expect(tasks.map(t => t.id)).toContain(task2.id)
    },
  })
})

test("get returns undefined for non-existent task", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const result = TaskRegistry.get("nonexistent-session", "tsk_nonexistent")
      expect(result).toBeUndefined()
    },
  })
})

test("complete marks task as completed with result", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-session-3"
      const task = createMockTask(sessionID)

      TaskRegistry.register(task)
      TaskRegistry.complete(task, "Task completed successfully")
      await new Promise(resolve => setTimeout(resolve, 0))

      const retrieved = TaskRegistry.get(sessionID, task.id)
      expect(retrieved?.status).toBe("completed")
      expect(retrieved?.result).toBe("Task completed successfully")
      expect(retrieved?.time.completed).toBeDefined()
    },
  })
})

test("fail marks task as error with message", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-session-4"
      const task = createMockTask(sessionID)

      TaskRegistry.register(task)
      TaskRegistry.fail(task, "Something went wrong")

      const retrieved = TaskRegistry.get(sessionID, task.id)
      expect(retrieved?.status).toBe("error")
      expect(retrieved?.error).toBe("Something went wrong")
      expect(retrieved?.time.completed).toBeDefined()
    },
  })
})

test("cancel queued task removes from queue", async () => {
  // Override concurrent limit for this test (default is 128, use 32 for faster test)
  const originalLimit = process.env.OPENCODE_MAX_BACKGROUND_TASKS
  process.env.OPENCODE_MAX_BACKGROUND_TASKS = "32"

  await using tmp = await tmpdir()
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "test-session-5"

        // Fill up running slots first (limit is 32 via env override)
        const runningTasks: BackgroundTask.Info[] = []
        for (let i = 0; i < 32; i++) {
          const task = createMockTask(sessionID)
          TaskRegistry.register(task)
          runningTasks.push(task)
        }

        // This task should be queued (33rd task, limit is 32)
        const queuedTask = createMockTask(sessionID)
        TaskRegistry.register(queuedTask)
        expect(queuedTask.status).toBe("queued")

        // Cancel the queued task
        const result = TaskRegistry.cancel(sessionID, queuedTask.id)
        expect(result).toBe(true)

        const retrieved = TaskRegistry.get(sessionID, queuedTask.id)
        expect(retrieved?.status).toBe("cancelled")
      },
    })
  } finally {
    // Restore original env var
    if (originalLimit === undefined) {
      delete process.env.OPENCODE_MAX_BACKGROUND_TASKS
    } else {
      process.env.OPENCODE_MAX_BACKGROUND_TASKS = originalLimit
    }
  }
})

test("cancel returns false for already terminal task", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-session-6"
      const task = createMockTask(sessionID)

      TaskRegistry.register(task)
      TaskRegistry.complete(task, "Done")

      const result = TaskRegistry.cancel(sessionID, task.id)
      expect(result).toBe(false)
    },
  })
})

test("update modifies task in registry", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-session-7"
      const task = createMockBashTask(sessionID)

      TaskRegistry.register(task)

      task.pid = 12345
      TaskRegistry.update(task)

      const retrieved = TaskRegistry.get(sessionID, task.id)
      expect(retrieved?.pid).toBe(12345)
    },
  })
})

test("bash task type is preserved", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-session-8"
      const task = createMockBashTask(sessionID, {
        command: "npm test",
        pid: 9999,
      })

      TaskRegistry.register(task)

      // Allow async registration to complete
      await new Promise(resolve => setTimeout(resolve, 0))

      const retrieved = TaskRegistry.get(sessionID, task.id)
      expect(retrieved?.type).toBe("bash")
      expect(retrieved?.command).toBe("npm test")
      expect(retrieved?.pid).toBe(9999)
    },
  })
}, 30000)

test("executeBackground completes task on success", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-session-9"
      const task = createMockTask(sessionID)

      TaskRegistry.register(task)

      await TaskRegistry.executeBackground(task, async () => {
        return "Execution result"
      })

      const retrieved = TaskRegistry.get(sessionID, task.id)
      expect(retrieved?.status).toBe("completed")
      expect(retrieved?.result).toBe("Execution result")
    },
  })
})

test("executeBackground fails task on error", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = "test-session-10"
      const task = createMockTask(sessionID)

      TaskRegistry.register(task)

      await TaskRegistry.executeBackground(task, async () => {
        throw new Error("Execution failed")
      })

      // Allow Bus.publish to complete
      await new Promise(resolve => setTimeout(resolve, 0))

      const retrieved = TaskRegistry.get(sessionID, task.id)
      expect(retrieved?.status).toBe("error")
      expect(retrieved?.error).toBe("Execution failed")
    },
  })
}, 30000)
