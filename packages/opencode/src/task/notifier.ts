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
 * Maps BackgroundTask.Event to AgentNotificationPart event types
 */
const eventMapping = {
  [BackgroundTask.Event.Queued]: "queued",
  [BackgroundTask.Event.Started]: "started",
  [BackgroundTask.Event.Completed]: "completed",
  [BackgroundTask.Event.Failed]: "failed",
  [BackgroundTask.Event.Cancelled]: "cancelled",
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
    BackgroundTask.Event.Queued,
    BackgroundTask.Event.Started,
    BackgroundTask.Event.Completed,
    BackgroundTask.Event.Failed,
    BackgroundTask.Event.Cancelled,
  ]

  for (const eventType of events) {
    Bus.subscribe(eventType, async (data) => {
      try {
        await handleTaskEvent(eventType, data as BackgroundTask.Info)
      } catch (error) {
        log.error(`Failed to handle ${eventType} event for task ${(data as any)?.id}`, {
          error,
          taskID: (data as any)?.id,
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
}  // End TaskNotifier namespace
