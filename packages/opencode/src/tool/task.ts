import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { Provider } from "../provider/provider"
import { PermissionNext } from "@/permission/next"
import { TaskRegistry } from "../task/registry"
import { BackgroundTask } from "../task/background"
import { Plugin } from "../plugin"
import { NamedError } from "@opencode-ai/util/error"

/** Unified metadata type for task tool results */
interface TaskMetadata {
  sessionId: string
  taskId?: string
  agentId?: string
  background?: boolean
  summary?: Array<{
    id: string
    tool: string
    state: { status: string; title?: string }
  }>
}

/** Task tool events for visibility and monitoring */
export namespace Task {
  export const Event = {
    /** Emitted before a subagent spawns, showing provider/model selection */
    SpawnVisibility: BusEvent.define(
      "task.spawn.visibility",
      z.object({
        sessionID: z.string(),
        agentName: z.string(),
        description: z.string(),
        provider: z.string(),
        model: z.string(),
        cost: z.object({
          input: z.number(),
          output: z.number(),
        }).optional(),
        source: z.enum(["parameter", "user-override", "agent-config", "default"]),
        fallback: z.object({
          configured: z.object({
            provider: z.string(),
            model: z.string(),
          }),
          reason: z.string(),
        }).optional(),
      }),
    ),
  }
}

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  session_id: z.string().describe("Existing Task session to continue").optional(),
  resume: z.string().optional().describe("Agent ID to resume from previous execution"),
  command: z.string().describe("The command that triggered this task").optional(),
  run_in_background: z.boolean().optional().describe(
    "Set to true to run this agent in the background. Use TaskOutput tool to check status and retrieve results later."
  ),
  model: z.string().optional().describe("Optional model to use for this agent (format: provider/model)"),
})

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  // Filter agents by permissions if agent provided
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => PermissionNext.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents

  const description = DESCRIPTION.replace(
    "{agents}",
    accessibleAgents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(args: z.infer<typeof parameters>, ctx) {
      const config = await Config.get()

      // Skip permission check when user explicitly invoked via @ or command subtask
      if (!ctx.extra?.bypassAgentCheck) {
        await ctx.ask({
          permission: "task",
          patterns: [args.subagent_type],
          always: ["*"],
          metadata: {
            description: args.description,
            subagent_type: args.subagent_type,
          },
        })
      }

      const agent = await Agent.get(args.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${args.subagent_type} is not a valid agent type`)
      const session = await iife(async () => {
        // Handle resume parameter - look up task to find childSessionID
        if (args.resume) {
          const task = TaskRegistry.get(ctx.sessionID, args.resume)
          if (!task) {
            throw new Error(`Agent ID not found: ${args.resume}. Cannot resume from unknown agent.`)
          }
          if (!task.childSessionID) {
            throw new Error(`Agent ID ${args.resume} has no session to resume.`)
          }
          const found = await Session.get(task.childSessionID).catch(() => {})
          if (found) return found
        }

        if (args.session_id) {
          const found = await Session.get(args.session_id).catch(() => {})
          if (found) return found
        }

        return await Session.create({
          parentID: ctx.sessionID,
          title: args.description + ` (@${agent.name} subagent)`,
          permission: [
            {
              permission: "todowrite",
              pattern: "*",
              action: "deny",
            },
            {
              permission: "todoread",
              pattern: "*",
              action: "deny",
            },
            {
              permission: "task",
              pattern: "*",
              action: "deny",
            },
            ...(config.experimental?.primary_tools?.map((t) => ({
              pattern: "*",
              action: "allow" as const,
              permission: t,
            })) ?? []),
          ],
        })
      })
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      // Extract parent model info after type narrowing (TypeScript can't track through async closures)
      const parentModelID = msg.info.modelID
      const parentProviderID = msg.info.providerID

      ctx.metadata({
        title: args.description,
        metadata: {
          sessionId: session.id,
        },
      })

      const messageID = Identifier.ascending("message")
      const parts: Record<string, { id: string; tool: string; state: { status: string; title?: string } }> = {}
      const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
        if (evt.properties.part.sessionID !== session.id) return
        if (evt.properties.part.messageID === messageID) return
        if (evt.properties.part.type !== "tool") return
        const part = evt.properties.part
        parts[part.id] = {
          id: part.id,
          tool: part.tool,
          state: {
            status: part.state.status,
            title: part.state.status === "completed" ? part.state.title : undefined,
          },
        }
        ctx.metadata({
          title: args.description,
          metadata: {
            summary: Object.values(parts).sort((a, b) => a.id.localeCompare(b.id)),
            sessionId: session.id,
          },
        })
      })

      // Compute initial model from params, agent config, preferred_model, or parent message
      // Priority: args.model > agent.model > preferred_model > parent message model
      const initialModel = iife(() => {
        // Explicit model parameter - highest priority
        if (args.model) return Provider.parseModel(args.model)

        // Agent-specific model config
        if (agent.model) return agent.model

        // User's preferred_model for subagents (prevents inheriting expensive parent model)
        if (config.preferred_model) {
          // If preferred_provider is also set, combine them
          if (config.preferred_provider) {
            return {
              providerID: config.preferred_provider,
              modelID: config.preferred_model,
            }
          }
          // Otherwise use parent's provider with preferred model
          return {
            providerID: parentProviderID,
            modelID: config.preferred_model,
          }
        }

        // Fall back to parent message model
        return {
          modelID: parentModelID,
          providerID: parentProviderID,
        }
      })

      // Apply preferred_provider if model would be available there
      // This allows users to control billing by preferring free/subscription providers
      const preferredModel = await Provider.applyPreferredProvider(initialModel)

      // Resolve model with fallback if invalid (aligns with command() path in prompt.ts)
      const resolvedModel = await Provider.resolveModelWithFallback(preferredModel)
      let model = resolvedModel.model
      if (resolvedModel.fallbackUsed) {
        const hint = resolvedModel.suggestions?.length ? ` Did you mean: ${resolvedModel.suggestions.join(", ")}?` : ""
        Bus.publish(Session.Event.Error, {
          sessionID: session.id,
          error: new NamedError.Unknown({
            message: `Model not found: ${initialModel.providerID}/${initialModel.modelID}.${hint} Falling back to ${model.providerID}/${model.modelID}.`,
          }).toObject(),
        })
      }

      // Emit visibility event so UI/CLI can display spawn info
      const modelInfo = await Provider.getModel(model.providerID, model.modelID)
      const source: "parameter" | "user-override" | "agent-config" | "default" =
        args.model ? "parameter"
        : agent.model ? "agent-config"
        : (config.preferred_model || preferredModel.preferredProviderUsed) ? "user-override"
        : "default"

      Bus.publish(Task.Event.SpawnVisibility, {
        sessionID: ctx.sessionID,
        agentName: args.subagent_type,
        description: args.description,
        provider: model.providerID,
        model: model.modelID,
        cost: modelInfo.cost ? { input: modelInfo.cost.input, output: modelInfo.cost.output } : undefined,
        source,
        fallback: resolvedModel.fallbackUsed ? {
          configured: { provider: initialModel.providerID, model: initialModel.modelID },
          reason: "Model not found",
        } : undefined,
      })

      function cancel() {
        SessionPrompt.cancel(session.id)
      }
      ctx.abort.addEventListener("abort", cancel)
      using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))
      const promptParts = await SessionPrompt.resolvePromptParts(args.prompt)

      // Check if background execution requested
      if (args.run_in_background) {
        const taskID = Identifier.ascending("task")

        const backgroundTask: BackgroundTask.Info = {
          id: taskID,
          type: "task",
          sessionID: ctx.sessionID,
          childSessionID: session.id,
          subagentType: args.subagent_type,
          description: args.description,
          prompt: args.prompt,
          status: "queued",
          time: { created: Date.now() },
        }

        // Register task (may start immediately or queue based on MAX_CONCURRENT)
        TaskRegistry.register(backgroundTask)

        // Execute in background (do not await) - use the executor pattern
        TaskRegistry.executeBackground(backgroundTask, async () => {
          const result = await SessionPrompt.prompt({
            messageID,
            sessionID: session.id,
            model: {
              modelID: model.modelID,
              providerID: model.providerID,
            },
            agent: agent.name,
            tools: {
              todowrite: false,
              todoread: false,
              task: false,
              ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
            },
            parts: promptParts,
          })

          unsub()
          const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

          // Trigger subagent.stop hook for background task completion
          await Plugin.trigger(
            "subagent.stop",
            {
              sessionID: session.id,
              parentSessionID: ctx.sessionID,
              agentName: args.subagent_type,
              toolCallID: taskID,
              result: text,
            },
            { shouldContinue: false }
          )

          return text + "\n\n" + ["<task_metadata>", `session_id: ${session.id}`, "</task_metadata>"].join("\n")
        })

        // Return immediately with task ID
        return {
          title: `Background task started: ${args.description}`,
          output: [
            `Task ${taskID} started in background.`,
            `Agent: ${args.subagent_type}`,
            `Session: ${session.id}`,
            ``,
            `Use TaskOutput("${taskID}") to check status or retrieve results.`,
          ].join("\n"),
          metadata: {
            taskId: taskID,
            sessionId: session.id,
            background: true,
          } as TaskMetadata,
        }
      }

      const result = await SessionPrompt.prompt({
        messageID,
        sessionID: session.id,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        agent: agent.name,
        tools: {
          todowrite: false,
          todoread: false,
          task: false,
          ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
        },
        parts: promptParts,
      })
      unsub()
      const messages = await Session.messages({ sessionID: session.id })
      const summary = messages
        .filter((x) => x.info.role === "assistant")
        .flatMap((msg) => msg.parts.filter((x: any) => x.type === "tool") as MessageV2.ToolPart[])
        .map((part) => ({
          id: part.id,
          tool: part.tool,
          state: {
            status: part.state.status,
            title: part.state.status === "completed" ? part.state.title : undefined,
          },
        }))
      const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

      // Trigger subagent.stop hook for orchestration
      const subagentHookOutput = await Plugin.trigger(
        "subagent.stop",
        {
          sessionID: session.id,
          parentSessionID: ctx.sessionID,
          agentName: args.subagent_type,
          toolCallID: ctx.callID,
          result: text,
        },
        { shouldContinue: false }
      )
      // Note: shouldContinue can be used by orchestration logic if needed

      const output = text + "\n\n" + ["<task_metadata>", `session_id: ${session.id}`, "</task_metadata>"].join("\n")

      return {
        title: args.description,
        metadata: {
          summary,
          sessionId: session.id,
          agentId: session.id.substring(0, 7), // Short ID for resumption
        } as TaskMetadata,
        output,
      }
    },
  }
})
