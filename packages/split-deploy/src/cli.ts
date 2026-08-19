#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeOpenNext, summarizeAnalysis } from "./analyze.js";
import { copySplitArtifacts } from "./copy.js";
import { validateSplitOutput } from "./validator.js";

interface CliOptions {
  input: string;
  output: string;
  json: boolean;
  tenant: string;
  build: string;
  split: boolean;
  cwd: string;
}

function usage(): string {
  return [
    "Usage:",
    "  split-deploy build  [options]   Build with OpenNext, analyze, and split",
    "  split-deploy analyze [options]  Analyze existing OpenNext output",
    "",
    "Options:",
    "  -i, --input <dir>     OpenNext output directory (default: .open-next)",
    "  -o, --output <dir>    Split output directory (default: .open-next-split)",
    "  --tenant <id>         Tenant identifier",
    "  --build <id>          Build identifier",
    "  --json                Print machine-readable analysis",
    "  --split               Generate split output (with analyze command)",
    "  --cwd <dir>           Working directory for build command (default: cwd)",
  ].join("\n");
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    input: ".open-next",
    output: ".open-next-split",
    json: false,
    tenant: "",
    build: "",
    split: false,
    cwd: "",
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--split") options.split = true;
    else if (arg === "-i" || arg === "--input") options.input = args[++i] ?? "";
    else if (arg === "-o" || arg === "--output") options.output = args[++i] ?? "";
    else if (arg === "--tenant") options.tenant = args[++i] ?? "";
    else if (arg === "--build") options.build = args[++i] ?? "";
    else if (arg === "--cwd") options.cwd = args[++i] ?? "";
    else throw new Error(`Unknown argument: ${arg ?? "(missing value)"}`);
  }
  return options;
}

function detectPackageManager(cwd: string): string {
  if (existsSync(resolve(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(resolve(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(resolve(cwd, "bun.lockb")) || existsSync(resolve(cwd, "bun.lock"))) return "bun";
  return "npm";
}

function detectNextJs(cwd: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8")) as Record<string, unknown>;
    const deps = { ...(pkg.dependencies as Record<string, string> | undefined), ...(pkg.devDependencies as Record<string, string> | undefined) };
    return "next" in deps;
  } catch {
    return false;
  }
}

function log(symbol: string, message: string): void {
  process.stdout.write(`${symbol} ${message}\n`);
}

function runOpenNextBuild(cwd: string): void {
  const pm = detectPackageManager(cwd);
  log("✓", `Package manager: ${pm}`);

  const runCmd = pm === "npm" ? "npx" : pm === "yarn" ? "yarn dlx" : pm === "bun" ? "bunx" : "pnpm dlx";
  const cmd = `${runCmd} open-next build`;
  log("…", "Running OpenNext build...");
  execSync(cmd, { cwd, stdio: "inherit" });
}

export function runCli(args: string[]): number {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const command = normalizedArgs[0];
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(`${usage()}\n`);
    return command ? 0 : 1;
  }
  if (command !== "build" && command !== "analyze") {
    process.stderr.write(`Unknown command: ${command}\n\n${usage()}\n`);
    return 1;
  }

  try {
    const options = parseOptions(normalizedArgs.slice(1));
    const cwd = options.cwd ? resolve(options.cwd) : process.cwd();

    process.stdout.write("\nSplit Deploy\n\n");

    if (command === "build") {
      if (!detectNextJs(cwd)) {
        log("✗", "No Next.js project detected (missing next in package.json)");
        return 1;
      }
      log("✓", "Next.js detected");
      runOpenNextBuild(cwd);
      log("✓", "OpenNext build completed");
    }

    const inputDir = resolve(cwd, options.input);
    if (!existsSync(inputDir)) {
      log("✗", `OpenNext output not found: ${inputDir}`);
      return 1;
    }
    log("✓", "OpenNext output detected");

    const analysis = analyzeOpenNext(inputDir);
    log("✓", "Routes analyzed");
    log("✓", "Dependencies analyzed");
    log("✓", "Worker verification completed");
    process.stdout.write("\n");

    if (command === "analyze" && options.json) {
      process.stdout.write(`${JSON.stringify(analysis, null, 2)}\n`);
      if (!options.split) return 0;
    }

    process.stdout.write(summarizeAnalysis(analysis));

    if (command === "analyze" && !options.split) return 0;

    const splitOpts = {
      output: options.output,
      tenantId: options.tenant || undefined,
      buildId: options.build || undefined,
    };
    const result = copySplitArtifacts(analysis, splitOpts);

    // Validate
    const errors = validateSplitOutput(result.outputDir);
    if (errors.length > 0) {
      log("✗", "Validation errors:");
      for (const err of errors) {
        log("  ✗", `[${err.target}] ${err.message}`);
      }
      return 1;
    }

    log("✓", "Artifacts validated");
    log("✓", "Artifacts generated");
    process.stdout.write(`\n${result.outputDir}/\n├── cdn/\n├── worker/\n├── lambda/\n└── manifest.json\n`);
    return 0;
  } catch (error) {
    process.stderr.write(
      `split-deploy: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = runCli(process.argv.slice(2));
}
