import { describe, expect, test, beforeEach, afterEach, mock, spyOn } from "bun:test"
import { Bus } from "../../src/bus"
import { BackgroundTask } from "../../src/task/background"
import { TaskNotifier } from "../../src/task/notifier"
import { MessageV2 } from "../../src/session/message-v2"

describe("TaskNotifier", () => {
  let mockSubscriptionHandlers: Map<string, Function>
  let originalSubscribe: typeof Bus.subscribe
  let emitNotificationSpy: any

  beforeEach(() => {
    mockSubscriptionHandlers = new Map()
    originalSubscribe = Bus.subscribe
    
    // Mock Bus.subscribe to capture handlers
    Bus.subscribe = mock((event: any, handler: Function) => {
      mockSubscriptionHandlers.set(event.name, handler)
      return () => {} // Return unsubscribe function
    }) as any

    // Spy on emitBackgroundTaskNotification
    emitNotificationSpy = spyOn(messageV2, "emitBackgroundTaskNotification")
  })

  afterEach(() => {
    Bus.subscribe = originalSubscribe
    mockSubscriptionHandlers.clear()
  })

  describe("initialize()", () => {
    test("should subscribe to all 5 BackgroundTask events", () => {
      TaskNotifier.initialize()

      expect(Bus.subscribe).toHaveBeenCalledTimes(5)
      expect(mockSubscriptionHandlers.has("background_task.registered")).toBe(true)
      expect(mockSubscriptionHandlers.has("background_task.started")).toBe(true)
      expect(mockSubscriptionHandlers.has("background_task.completed")).toBe(true)
      expect(mockSubscriptionHandlers.has("background_task.failed")).toBe(true)
      expect(mockSubscriptionHandlers.has("background_task.cancelled")).toBe(true)
    })

    test("should be idempotent (no-op on second call)", () => {
      TaskNotifier.initialize()
      const firstCallCount = (Bus.subscribe as any).mock.calls.length

      TaskNotifier.initialize()
      const secondCallCount = (Bus.subscribe as any).mock.calls.length

      // Should not have subscribed again
      expect(secondCallCount).toBe(firstCallCount)
    })
  })

  describe("event handling", () => {
    const createMockTask = (overrides?: Partial<BackgroundTask.Info>): BackgroundTask.Info => ({
      id: "tsk_test123",
      type: "task",
      sessionID: "session_abc",
      messageID: "msg_xyz",
      description: "Test task",
      status: "queued",
      time: {
        created: Date.now(),
      },
      ...overrides,
    })

    beforeEach(() => {
      TaskNotifier.initialize()
    })

    test("should emit notification on task registered (queued)", async () => {
      const task = createMockTask()
      const handler = mockSubscriptionHandlers.get("background_task.registered")
      
      expect(handler).toBeDefined()
      await handler!({ task })

      expect(emitNotificationSpy).toHaveBeenCalledWith(
        "session_abc",
        "msg_xyz",
        "tsk_test123",
        "queued",
        undefined
      )
    })

    test("should emit notification on task started", async () => {
      const task = createMockTask({ status: "running" })
      const handler = mockSubscriptionHandlers.get("background_task.started")
      
      expect(handler).toBeDefined()
      await handler!({ task })

      expect(emitNotificationSpy).toHaveBeenCalledWith(
        "session_abc",
        "msg_xyz",
        "tsk_test123",
        "started",
        undefined
      )
    })

    test("should emit notification on task completed with result", async () => {
      const task = createMockTask({ 
        status: "completed",
        result: "Task succeeded"
      })
      const handler = mockSubscriptionHandlers.get("background_task.completed")
      
      expect(handler).toBeDefined()
      await handler!({ task })

      expect(emitNotificationSpy).toHaveBeenCalledWith(
        "session_abc",
        "msg_xyz",
        "tsk_test123",
        "completed",
        { message: "Task succeeded" }
      )
    })

    test("should emit notification on task completed without result", async () => {
      const task = createMockTask({ status: "completed" })
      const handler = mockSubscriptionHandlers.get("background_task.completed")
      
      expect(handler).toBeDefined()
      await handler!({ task })

      expect(emitNotificationSpy).toHaveBeenCalledWith(
        "session_abc",
        "msg_xyz",
        "tsk_test123",
        "completed",
        undefined
      )
    })

    test("should emit notification on task failed with error", async () => {
      const task = createMockTask({ 
        status: "error",
        error: "Something went wrong"
      })
      const handler = mockSubscriptionHandlers.get("background_task.failed")
      
      expect(handler).toBeDefined()
      await handler!({ task })

      expect(emitNotificationSpy).toHaveBeenCalledWith(
        "session_abc",
        "msg_xyz",
        "tsk_test123",
        "failed",
        { error: "Something went wrong" }
      )
    })

    test("should emit notification on task failed without error message", async () => {
      const task = createMockTask({ status: "error" })
      const handler = mockSubscriptionHandlers.get("background_task.failed")
      
      expect(handler).toBeDefined()
      await handler!({ task })

      expect(emitNotificationSpy).toHaveBeenCalledWith(
        "session_abc",
        "msg_xyz",
        "tsk_test123",
        "failed",
        undefined
      )
    })

    test("should emit notification on task cancelled", async () => {
      const task = createMockTask({ status: "cancelled" })
      const handler = mockSubscriptionHandlers.get("background_task.cancelled")
      
      expect(handler).toBeDefined()
      await handler!({ task })

      expect(emitNotificationSpy).toHaveBeenCalledWith(
        "session_abc",
        "msg_xyz",
        "tsk_test123",
        "cancelled",
        undefined
      )
    })
  })

  describe("error handling", () => {
    const createMockTask = (overrides?: Partial<BackgroundTask.Info>): BackgroundTask.Info => ({
      id: "tsk_test123",
      type: "task",
      sessionID: "session_abc",
      messageID: "msg_xyz",
      description: "Test task",
      status: "queued",
      time: {
        created: Date.now(),
      },
      ...overrides,
    })

    let consoleErrorSpy: any

    beforeEach(() => {
      TaskNotifier.initialize()
      consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {})
    })

    afterEach(() => {
      consoleErrorSpy.mockRestore()
    })

    test("should catch and log errors without crashing", async () => {
      emitNotificationSpy.mockImplementationOnce(() => {
        throw new Error("Test error")
      })

      const task = createMockTask()
      const handler = mockSubscriptionHandlers.get("background_task.registered")
      
      // Should not throw
      await expect(handler!({ task })).resolves.toBeUndefined()
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[TaskNotifier] Failed to emit notification:",
        expect.any(Error)
      )
    })

    test("should handle missing sessionID gracefully", async () => {
      const task = createMockTask({ sessionID: "" })
      const handler = mockSubscriptionHandlers.get("background_task.registered")
      
      await handler!({ task })

      // Should still call with empty sessionID (let emitBackgroundTaskNotification handle it)
      expect(emitNotificationSpy).toHaveBeenCalledWith(
        "",
        "msg_xyz",
        "tsk_test123",
        "queued",
        undefined
      )
    })

    test("should handle missing messageID gracefully", async () => {
      const task = createMockTask({ messageID: "" })
      const handler = mockSubscriptionHandlers.get("background_task.registered")
      
      await handler!({ task })

      // Should still call with empty messageID (let emitBackgroundTaskNotification handle it)
      expect(emitNotificationSpy).toHaveBeenCalledWith(
        "session_abc",
        "",
        "tsk_test123",
        "queued",
        undefined
      )
    })
  })
})
