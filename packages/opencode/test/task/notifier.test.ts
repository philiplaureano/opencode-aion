import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { TaskNotifier } from "../../src/task/notifier"
import { Bus } from "../../src/bus"
import { BackgroundTask } from "../../src/task/background"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import * as MessageV2Module from "../../src/session/message-v2"

describe("TaskNotifier", () => {
  let emitNotificationSpy: ReturnType<typeof spyOn>

  afterEach(() => {
    emitNotificationSpy?.mockRestore()
  })

  describe("event handling", () => {
    it("should emit notification when Registered event fires", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Spy on the emitBackgroundTaskNotification function
          emitNotificationSpy = spyOn(MessageV2Module, "emitBackgroundTaskNotification").mockResolvedValue(undefined)
          
          // Initialize the notifier so it subscribes to events
          TaskNotifier.initialize()

          const task = {
            id: "test-task-123",
            sessionID: "test-session",
            messageID: "test-message",
            description: "Test task",
            status: "queued" as const,
            createdAt: new Date(),
          }

          // Emit the Registered event
          await Bus.publish(BackgroundTask.Event.Registered, { task })

          // Wait for async operations
          await new Promise((resolve) => setTimeout(resolve, 100))

          expect(emitNotificationSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              sessionID: "test-session",
              messageID: "test-message",
              taskID: "test-task-123",
              event: "queued",
            })
          )
        },
      })
    })

    it("should emit notification when Started event fires", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          emitNotificationSpy = spyOn(MessageV2Module, "emitBackgroundTaskNotification").mockResolvedValue(undefined)
          TaskNotifier.initialize()

          const task = {
            id: "test-task-456",
            sessionID: "test-session-2",
            messageID: "test-message-2",
            description: "Running task",
            status: "running" as const,
            createdAt: new Date(),
            startedAt: new Date(),
          }

          await Bus.publish(BackgroundTask.Event.Started, { task })
          await new Promise((resolve) => setTimeout(resolve, 100))

          expect(emitNotificationSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              sessionID: "test-session-2",
              messageID: "test-message-2",
              taskID: "test-task-456",
              event: "started",
            })
          )
        },
      })
    })

    it("should emit notification when Completed event fires", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          emitNotificationSpy = spyOn(MessageV2Module, "emitBackgroundTaskNotification").mockResolvedValue(undefined)
          TaskNotifier.initialize()

          const task = {
            id: "test-task-789",
            sessionID: "test-session-3",
            messageID: "test-message-3",
            description: "Completed task",
            status: "completed" as const,
            createdAt: new Date(),
            startedAt: new Date(),
            completedAt: new Date(),
            result: "success",
          }

          await Bus.publish(BackgroundTask.Event.Completed, { task })
          await new Promise((resolve) => setTimeout(resolve, 100))

          expect(emitNotificationSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              sessionID: "test-session-3",
              messageID: "test-message-3",
              taskID: "test-task-789",
              event: "completed",
            })
          )
        },
      })
    })

    it("should emit notification when Failed event fires", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          emitNotificationSpy = spyOn(MessageV2Module, "emitBackgroundTaskNotification").mockResolvedValue(undefined)
          TaskNotifier.initialize()

          const task = {
            id: "test-task-fail",
            sessionID: "test-session-4",
            messageID: "test-message-4",
            description: "Failed task",
            status: "error" as const,
            createdAt: new Date(),
            startedAt: new Date(),
            completedAt: new Date(),
            error: "Something went wrong",
          }

          await Bus.publish(BackgroundTask.Event.Failed, { task })
          await new Promise((resolve) => setTimeout(resolve, 100))

          expect(emitNotificationSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              sessionID: "test-session-4",
              messageID: "test-message-4",
              taskID: "test-task-fail",
              event: "failed",
            })
          )
        },
      })
    })

    it("should emit notification when Cancelled event fires", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          emitNotificationSpy = spyOn(MessageV2Module, "emitBackgroundTaskNotification").mockResolvedValue(undefined)
          TaskNotifier.initialize()

          const task = {
            id: "test-task-cancel",
            sessionID: "test-session-5",
            messageID: "test-message-5",
            description: "Cancelled task",
            status: "cancelled" as const,
            createdAt: new Date(),
            completedAt: new Date(),
          }

          await Bus.publish(BackgroundTask.Event.Cancelled, { task })
          await new Promise((resolve) => setTimeout(resolve, 100))

          expect(emitNotificationSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              sessionID: "test-session-5",
              messageID: "test-message-5",
              taskID: "test-task-cancel",
              event: "cancelled",
            })
          )
        },
      })
    })

    it("should emit notification when Progress event with output fires", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          emitNotificationSpy = spyOn(MessageV2Module, "emitBackgroundTaskNotification").mockResolvedValue(undefined)
          TaskNotifier.initialize()

          const task = {
            id: "test-task-output",
            sessionID: "test-session-6",
            messageID: "test-message-6",
            description: "Task with output",
            status: "running" as const,
            createdAt: new Date(),
            startedAt: new Date(),
          }

          const progress = {
            output: "Some output",
            error: false,
          }

          await Bus.publish(BackgroundTask.Event.Progress, { task, progress })
          await new Promise((resolve) => setTimeout(resolve, 100))

          expect(emitNotificationSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              sessionID: "test-session-6",
              messageID: "test-message-6",
              taskID: "test-task-output",
              event: "output",
            })
          )
        },
      })
    })

    it("should handle multiple events in sequence", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          emitNotificationSpy = spyOn(MessageV2Module, "emitBackgroundTaskNotification").mockResolvedValue(undefined)
          TaskNotifier.initialize()

          const task = {
            id: "test-sequence",
            sessionID: "test-session-seq",
            messageID: "test-message-seq",
            description: "Sequential task",
            status: "queued" as const,
            createdAt: new Date(),
          }

          // Emit Registered
          await Bus.publish(BackgroundTask.Event.Registered, { task })
          await new Promise((resolve) => setTimeout(resolve, 50))

          // Emit Started
          const runningTask = { ...task, status: "running" as const, startedAt: new Date() }
          await Bus.publish(BackgroundTask.Event.Started, { task: runningTask })
          await new Promise((resolve) => setTimeout(resolve, 50))

          // Emit Completed
          const completedTask = { ...runningTask, status: "completed" as const, completedAt: new Date(), result: "done" }
          await Bus.publish(BackgroundTask.Event.Completed, { task: completedTask })
          await new Promise((resolve) => setTimeout(resolve, 50))

          // Should have been called 3 times (queued, started, completed)
          expect(emitNotificationSpy).toHaveBeenCalledTimes(3)

          // Verify the sequence
          expect(emitNotificationSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ event: "queued" }))
          expect(emitNotificationSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ event: "started" }))
          expect(emitNotificationSpy).toHaveBeenNthCalledWith(3, expect.objectContaining({ event: "completed" }))
        },
      })
    })
  })
})
