import { test, expect } from "bun:test"
import { BackgroundTask } from "../../src/task/background"

test("Info schema validates task type correctly", () => {
  const taskInfo = BackgroundTask.Info.parse({
    id: "tsk_abc123",
    type: "task",
    sessionID: "session_123",
    childSessionID: "child_456",
    subagentType: "code-reviewer",
    prompt: "Review this code",
    description: "Code review task",
    status: "running",
    time: {
      created: Date.now(),
      started: Date.now(),
    },
  })

  expect(taskInfo.type).toBe("task")
  expect(taskInfo.childSessionID).toBe("child_456")
  expect(taskInfo.subagentType).toBe("code-reviewer")
})

test("Info schema validates bash type correctly", () => {
  const bashInfo = BackgroundTask.Info.parse({
    id: "tsk_bash123",
    type: "bash",
    sessionID: "session_123",
    command: "npm run build",
    pid: 12345,
    description: "Build project",
    status: "running",
    time: {
      created: Date.now(),
      started: Date.now(),
    },
  })

  expect(bashInfo.type).toBe("bash")
  expect(bashInfo.command).toBe("npm run build")
  expect(bashInfo.pid).toBe(12345)
})

test("Info schema defaults type to task", () => {
  const info = BackgroundTask.Info.parse({
    id: "tsk_default123",
    sessionID: "session_123",
    description: "Default type task",
    status: "queued",
    time: {
      created: Date.now(),
    },
  })

  expect(info.type).toBe("task")
})

test("Info schema allows optional task fields for bash type", () => {
  const bashInfo = BackgroundTask.Info.parse({
    id: "tsk_bashonly",
    type: "bash",
    sessionID: "session_123",
    command: "echo hello",
    description: "Simple echo",
    status: "completed",
    result: "hello",
    time: {
      created: Date.now(),
      started: Date.now(),
      completed: Date.now(),
    },
  })

  expect(bashInfo.childSessionID).toBeUndefined()
  expect(bashInfo.subagentType).toBeUndefined()
  expect(bashInfo.prompt).toBeUndefined()
})

test("Info schema allows optional bash fields for task type", () => {
  const taskInfo = BackgroundTask.Info.parse({
    id: "tsk_taskonly",
    type: "task",
    sessionID: "session_123",
    childSessionID: "child_789",
    subagentType: "build",
    prompt: "Build the project",
    description: "Build task",
    status: "queued",
    time: {
      created: Date.now(),
    },
  })

  expect(taskInfo.command).toBeUndefined()
  expect(taskInfo.pid).toBeUndefined()
})

test("Info schema validates all status values", () => {
  const statuses: BackgroundTask.Status[] = ["queued", "running", "completed", "error", "cancelled"]

  for (const status of statuses) {
    const info = BackgroundTask.Info.parse({
      id: "tsk_status",
      sessionID: "session_123",
      description: `Status: ${status}`,
      status,
      time: { created: Date.now() },
    })
    expect(info.status).toBe(status)
  }
})

test("Info schema rejects invalid id prefix", () => {
  expect(() => {
    BackgroundTask.Info.parse({
      id: "invalid_123",
      sessionID: "session_123",
      description: "Invalid ID",
      status: "queued",
      time: { created: Date.now() },
    })
  }).toThrow()
})

test("Info schema includes progress and result fields", () => {
  const info = BackgroundTask.Info.parse({
    id: "tsk_progress",
    sessionID: "session_123",
    description: "Progress task",
    status: "running",
    progress: 50,
    time: { created: Date.now(), started: Date.now() },
  })

  expect(info.progress).toBe(50)
})

test("Info schema includes error field for failed tasks", () => {
  const info = BackgroundTask.Info.parse({
    id: "tsk_error",
    sessionID: "session_123",
    description: "Failed task",
    status: "error",
    error: "Something went wrong",
    time: { created: Date.now(), started: Date.now(), completed: Date.now() },
  })

  expect(info.error).toBe("Something went wrong")
})

test("TaskType includes both task and bash", () => {
  type ValidTypes = BackgroundTask.TaskType
  const types: ValidTypes[] = ["task", "bash"]
  expect(types).toHaveLength(2)
})
