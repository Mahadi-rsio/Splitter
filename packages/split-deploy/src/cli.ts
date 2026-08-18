#!/usr/bin/env node
import { analyzeOpenNext, summarizeAnalysis } from "./analyze.js";
import { copySplitArtifacts } from "./copy.js";

interface CliOptions {
  input: string;
  output: string;
  json: boolean;
}

function usage(): string {
  return [
    "Usage:",
    "  split-deploy build [--input .open-next] [--output .open-next-split]",
    "  split-deploy analyze [--input .open-next] [--json]",
    "",
    "Options:",
    "  -i, --input   OpenNext output directory (default: .open-next)",
    "  -o, --output  Split output directory (default: .open-next-split)",
    "  --json        Print machine-readable analysis",
  ].join("\n");
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    input: ".open-next",
    output: ".open-next-split",
    json: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") options.json = true;
    else if (argument === "-i" || argument === "--input") {
      options.input = args[++index] ?? "";
    } else if (argument === "-o" || argument === "--output") {
      options.output = args[++index] ?? "";
    } else if (argument && !argument.startsWith("-") && options.input === ".open-next") {
      options.input = argument;
    } else {
      throw new Error(`Unknown argument: ${argument ?? "(missing value)"}`);
    }
  }
  return options;
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
    const analysis = analyzeOpenNext(options.input);
    if (command === "analyze") {
      process.stdout.write(
        `${options.json ? JSON.stringify(analysis, null, 2) : summarizeAnalysis(analysis)}\n`,
      );
      return 0;
    }

    const result = copySplitArtifacts(analysis, options.output);
    process.stdout.write(
      `${summarizeAnalysis(analysis)}\n\nWrote split build to ${result.outputDir}\n`,
    );
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