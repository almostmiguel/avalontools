import { readFile } from "node:fs/promises";
import { watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderInline } from "../js/content-renderer.js";
import { createRuleLibrary } from "../js/rule-library.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["data/rules.json", "data/actions.json"];

function positionAt(text, offset) {
  const prefix = text.slice(0, offset);
  return { line: prefix.split("\n").length, column: offset - prefix.lastIndexOf("\n") };
}

// Use the renderer's resolver callbacks so formatting, escaped tags and literal code
// are checked exactly as they appear on the website. Ranges cover the JSON value.
export function checkRuleLinks(text, registry) {
  JSON.parse(text);
  const issues = [];
  for (const match of text.matchAll(/"(?:[^"\\]|\\[\s\S])*"/g)) {
    if (/^\s*:/.test(text.slice(match.index + match[0].length))) continue;
    const value = JSON.parse(match[0]);
    if (!value.includes("{@")) continue;
    renderInline(value, { resolveRule(name, source, { label = name } = {}) {
      const result = registry.resolve(name, source);
      if (result.status === "ambiguous") {
        const suggestions = result.matches.map(target => {
          const exact = registry.resolve(target.localId, target.source).target?.id === target.id ? target.localId : target.id;
          return `{@rule ${exact}|${target.source}|${label}}`;
        });
        const start = positionAt(text, match.index + 1);
        const end = positionAt(text, match.index + match[0].length - 1);
        issues.push({
          ...start, endLine: end.line, endColumn: end.column, severity: "error",
          message: `Ambiguous rule link "${name}"${source ? ` in ${source}` : ""}. Use ${suggestions.join(" or ")}.`.replace(/[\r\n]/g, " "),
          suggestions,
        });
      }
      return result;
    } });
  }
  return issues;
}

export function formatDiagnostic(file, issue) {
  return `${file}:${issue.line}:${issue.column}:${issue.endLine}:${issue.endColumn}: ${issue.severity}: ${issue.message}`;
}

async function validate() {
  console.log("Checking rule links...");
  let errors = 0;
  let library;
  const reads = await Promise.allSettled(files.map(file => readFile(resolve(projectRoot, file), "utf8")));
  const reportError = (file, text, error) => {
    const offset = Number(/position (\d+)/.exec(error.message)?.[1] || 0);
    const position = positionAt(text, offset);
    console.log(formatDiagnostic(file, { ...position, endLine: position.line, endColumn: position.column + 1, severity: "error", message: error.message.replace(/[\r\n]/g, " ") }));
    errors++;
  };
  reads.forEach((result, index) => { if (result.status === "rejected") reportError(files[index], "", result.reason); });
  if (errors) { console.log(`Rule link check complete: ${errors} errors.`); return errors; }
  const texts = reads.map(result => result.value);
  try {
    library = createRuleLibrary(JSON.parse(texts[0]));
  } catch (error) {
    reportError(files[0], texts[0], error);
    console.log("Rule link check complete: 1 error.");
    return 1;
  }
  for (let index = 0; index < files.length; index++) {
    try {
      const issues = checkRuleLinks(texts[index], library.registry);
      for (const issue of issues) console.log(formatDiagnostic(files[index], issue));
      errors += issues.length;
    } catch (error) {
      reportError(files[index], texts[index], error);
    }
  }
  console.log(`Rule link check complete: ${errors} ${errors === 1 ? "error" : "errors"}.`);
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--watch")) {
    let timer, running = false, pending = false;
    const check = async () => {
      if (running) { pending = true; return; }
      running = true;
      try { await validate(); }
      finally { running = false; if (pending) { pending = false; void check(); } }
    };
    const watcher = watch(resolve(projectRoot, "data"), (_event, filename) => {
      if (filename && !["rules.json", "actions.json"].includes(String(filename))) return;
      clearTimeout(timer);
      timer = setTimeout(check, 100);
    });
    watcher.on("error", error => { console.error(error.message); process.exitCode = 1; watcher.close(); });
    const close = () => { clearTimeout(timer); watcher.close(); };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    await check();
  } else {
    process.exitCode = (await validate()) ? 1 : 0;
  }
}
