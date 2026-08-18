import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ArtifactTarget, BuildAnalysis, CopyResult } from "./types.js";

const TARGETS: ArtifactTarget[] = ["cdn", "worker", "lambda"];

export function copySplitArtifacts(
  analysis: BuildAnalysis,
  outputDir = ".open-next-split",
): CopyResult {
  const destination = resolve(outputDir);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });

  const copied: Record<ArtifactTarget, string[]> = {
    cdn: [],
    worker: [],
    lambda: [],
  };

  for (const target of TARGETS) {
    const targetDir = join(destination, target);
    mkdirSync(targetDir, { recursive: true });
    for (const file of analysis.files[target]) {
      const source = join(analysis.inputDir, file);
      const output = join(targetDir, file);
      if (!existsSync(source)) continue;
      mkdirSync(dirname(output), { recursive: true });
      cpSync(source, output);
      copied[target].push(file);
    }
  }

  const manifestPath = join(destination, "analysis.json");
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        inputDir: analysis.inputDir,
        routes: analysis.routes,
        assets: analysis.assets,
        entries: analysis.entries,
        files: copied,
        warnings: analysis.warnings,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return { outputDir: destination, copied, manifestPath };
}