/**
 * prompt.chat — a LangChain `ChatPromptTemplate` expressed in config.
 *
 * Uses LangChain's native `{var}` placeholder syntax (single braces) because
 * the messages are compiled by ChatPromptTemplate itself — this atom is the
 * genuine LangChain templating integration (severity-categorization lineage).
 */

import { ChatPromptTemplate } from "@langchain/core/prompts";

export const meta = {
  name: "prompt.chat",
  category: "prompt",
  summary: "LangChain ChatPromptTemplate from config messages (native {var} placeholders).",
  params: {
    type: "object",
    required: ["messages"],
    properties: {
      messages: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["role", "content"],
          properties: {
            role: { enum: ["system", "human", "user", "ai", "assistant"] },
            content: { type: "string" },
          },
        },
      },
    },
  },
  returns: "prompt",
};

const ROLE_MAP = { user: "human", assistant: "ai" };

/**
 * @returns {(vars: object) => Promise<{system: string, user: string}>}
 */
export function chat(params) {
  const template = ChatPromptTemplate.fromMessages(
    params.messages.map((m) => [ROLE_MAP[m.role] ?? m.role, m.content]),
  );
  return async (vars = {}) => {
    const messages = await template.formatMessages(vars);
    const system = messages
      .filter((m) => m.getType() === "system")
      .map((m) => m.content)
      .join("\n");
    const user = messages
      .filter((m) => m.getType() !== "system")
      .map((m) => m.content)
      .join("\n");
    return { system, user };
  };
}
