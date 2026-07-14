/**
 * template.markdownReport — deterministic markdown report builder: title,
 * optional intro, then one `## section` per configured entry pulling values
 * from the scope. No template file needed — structure lives in config.
 */

import { renderTemplate } from "../../template/engine.mjs";

export const meta = {
  name: "template.markdownReport",
  category: "template",
  summary: "Config-declared markdown report: title + sections pulled from scope values.",
  params: {
    type: "object",
    required: ["title", "sections"],
    properties: {
      title: { type: "string", minLength: 1 },
      intro: { type: "string" },
      sections: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["heading"],
          properties: {
            heading: { type: "string" },
            text: { type: "string" },
            from: { type: "string" },
            code: { type: "boolean" },
          },
        },
      },
    },
  },
  returns: "template",
};

function renderValue(value, asCode) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (asCode || typeof value !== "string") return "```\n" + text + "\n```";
  return text;
}

/** @returns {(scope: object) => string} */
export function markdownReport(params) {
  return (scope = {}) => {
    const lines = [`# ${renderTemplate(params.title, scope)}`, ""];
    if (params.intro) lines.push(renderTemplate(params.intro, scope), "");
    for (const section of params.sections) {
      lines.push(`## ${renderTemplate(section.heading, scope)}`, "");
      if (section.text) lines.push(renderTemplate(section.text, scope), "");
      if (section.from) {
        const value = scope[section.from];
        lines.push(value === undefined ? "_not produced_" : renderValue(value, section.code), "");
      }
    }
    return lines.join("\n");
  };
}
