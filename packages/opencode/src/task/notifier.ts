/**
 * TaskNotifier - Subscribes to BackgroundTask events and emits notifications to parent session
 *
 * This module implements the async callback pattern:
 * 1. Subscribes to task lifecycle events (queued, started, completed, failed, cancelled)
 * 2. Extracts parentSessionID and parentMessageID from task context
 * 3. Appends AgentNotificationPart to the parent message via emitBackgroundTaskNotification()
 * 4. Enables real-time feedback for long-running background tasks
 */

import { Bus } from "@/bus"
import { BackgroundTask } from "./background"
import { emitBackgroundTaskNotification } from "@/session/message-v2"
import { Log } from "@/util/log"

const log = Log.create({ service: "task-notifier" })

/**
 * Maps BackgroundTask.Event types to AgentNotificationPart event types
 */
const eventMapping: Record<string, string> = {
  [BackgroundTask.Event.Registered.type]: "queued",
  [BackgroundTask.Event.Started.type]: "started",
  [BackgroundTask.Event.Completed.type]: "completed",
  [BackgroundTask.Event.Failed.type]: "failed",
  [BackgroundTask.Event.Cancelled.type]: "cancelled",
} as const

/**
 * TaskNotifier namespace for background task notification handling
 */
export namespace TaskNotifier {
  /**
   * Initialize TaskNotifier by subscribing to all BackgroundTask events.
   *
   * MUST be called exactly once during application startup.
   * Safe to call multiple times (no-op after first initialization).
   */
  let initialized = false

  export function initialize() {
  if (initialized) {
    log.debug("TaskNotifier already initialized, skipping")
    return
  }

  log.info("Initializing TaskNotifier")

  // Subscribe to all task lifecycle events
  const events = [
    BackgroundTask.Event.Registered,
    BackgroundTask.Event.Started,
    BackgroundTask.Event.Progress,
    BackgroundTask.Event.Completed,
    BackgroundTask.Event.Failed,
    BackgroundTask.Event.Cancelled,
  ]

  for (const eventType of events) {
    Bus.subscribe(eventType, async (data) => {
      try {
        // Progress events have a different structure
        if (eventType === BackgroundTask.Event.Progress) {
          await handleProgressEvent(data as { task: BackgroundTask.Info; progress: any })
        } else {
          await handleTaskEvent(eventType.type, (data as { task: BackgroundTask.Info }).task)
        }
      } catch (error) {
        log.error(`Failed to handle ${eventType.type} event`, {
          error,
          data,
        })
      }
    })
  }

  initialized = true
  log.info("TaskNotifier initialized successfully")
}

/**
 * Handles a single task event and emits notification if parent context exists.
 *
 * @param eventType - The BackgroundTask.Event type
 * @param task - The task info containing sessionID and messageID
 */
async function handleTaskEvent(eventType: string, task: BackgroundTask.Info) {
  const notificationEvent = eventMapping[eventType as keyof typeof eventMapping]

  if (!notificationEvent) {
    log.warn(`Unknown event type: ${eventType}`)
    return
  }

  // Parent context MUST be present (set when task was created via Task tool)
  if (!task.sessionID || !task.messageID) {
    log.debug(`Task ${task.id} has no parent context, skipping notification`, {
      taskID: task.id,
      event: notificationEvent,
      hasSessionID: !!task.sessionID,
      hasMessageID: !!task.messageID,
    })
    return
  }

  // Build details based on event type
  const details: { message?: string; error?: string } = {}

  if (eventType === BackgroundTask.Event.Failed && task.error) {
    details.error = task.error
  }

  if (task.description) {
    details.message = task.description
  }

  log.debug(`Emitting ${notificationEvent} notification for task ${task.id}`, {
    taskID: task.id,
    sessionID: task.sessionID,
    messageID: task.messageID,
    event: notificationEvent,
  })

  // Emit notification to parent message
  await emitBackgroundTaskNotification({
    sessionID: task.sessionID,
    messageID: task.messageID,
    taskID: task.id,
    event: notificationEvent,
    details: Object.keys(details).length > 0 ? details : undefined,
  })
}

/**
 * Handles a task progress event with output
 */
async function handleProgressEvent(data: { task: BackgroundTask.Info; progress: any }) {
  const { task, progress } = data

  // Only emit notifications for progress events with output
  if (!progress.output) {
    return
  }

  // Parent context MUST be present
  if (!task.sessionID || !task.messageID) {
    return
  }

  log.debug(`Emitting output notification for task ${task.id}`, {
    taskID: task.id,
    sessionID: task.sessionID,
    messageID: task.messageID,
  })

  await emitBackgroundTaskNotification({
    sessionID: task.sessionID,
    messageID: task.messageID,
    taskID: task.id,
    event: "output",
    details: {
      message: progress.output,
      error: progress.error ? "true" : undefined,
    },
  })
}
}  // End TaskNotifier namespace
