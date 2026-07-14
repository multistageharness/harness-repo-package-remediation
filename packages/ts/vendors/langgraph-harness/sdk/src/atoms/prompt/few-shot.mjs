/**
 * prompt.fewShot — a LangChain `FewShotPromptTemplate` expressed in config:
 * a prefix, worked examples, and a suffix that receives the live input.
 *
 * Native LangChain `{var}` placeholder syntax, same as prompt.chat.
 */

import { FewShotPromptTemplate, PromptTemplate } from "@langchain/core/prompts";

export const meta = {
  name: "prompt.fewShot",
  category: "prompt",
  summary: "LangChain FewShotPromptTemplate: prefix + worked examples + suffix.",
  params: {
    type: "object",
    required: ["examples", "example_template", "suffix"],
    properties: {
      system: { type: "string" },
      prefix: { type: "string" },
      examples: { type: "array", minItems: 1, items: { type: "object" } },
      example_template: { type: "string", minLength: 1 },
      suffix: { type: "string", minLength: 1 },
      input_vars: { type: "array", items: { type: "string" } },
    },
  },
  returns: "prompt",
};

/**
 * @returns {(vars: object) => Promise<{system: string, user: string}>}
 */
export function fewShot(params) {
  const examplePrompt = PromptTemplate.fromTemplate(params.example_template);
  const template = new FewShotPromptTemplate({
    examples: params.examples,
    examplePrompt,
    prefix: params.prefix ?? "",
    suffix: params.suffix,
    inputVariables: params.input_vars ?? [],
  });
  return async (vars = {}) => ({
    system: params.system ?? "",
    user: await template.format(vars),
  });
}
