// Audits the `generated` role heuristics on a local checkout: lists what the
// path rule and the header rule classify as generated (grouped by directory
// and by the matching header line), so false positives are easy to spot.
// Point it at any clone (a sparse TypeScript checkout is enough):
//
//   pnpm tsx scripts/audit-generated.ts <clone-dir>
//
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  classifyRole,
  hasGeneratedHeader,
  leadingComments,
  parseLsTree,
  sourceFiles,
} from "../src/deep-analysis/tree.ts";

const dir = process.argv[2];
if (dir === undefined) throw new Error("usage: audit-generated.ts <clone-dir>");

const listing = execFileSync("git", ["-C", dir, "ls-tree", "-r", "-z", "--full-tree", "HEAD"], {
  encoding: "utf8",
  maxBuffer: 1 << 28,
});

const byPath = new Map<string, number>();
const byHeader = new Map<string, Array<string>>();
for (const entry of sourceFiles(parseLsTree(listing), new Set())) {
  if (entry.declaration) continue;
  if (classifyRole(entry.file) === "generated") {
    const parent = entry.file.split("/").slice(0, -1).join("/");
    byPath.set(parent, (byPath.get(parent) ?? 0) + 1);
    continue;
  }
  let text: string;
  try {
    text = readFileSync(`${dir}/${entry.file}`, "utf8");
  } catch {
    continue; // not checked out
  }
  if (!hasGeneratedHeader(text)) continue;
  const line =
    leadingComments(text)
      .split("\n")
      .find((l) => /generat|do not (edit|modify)/i.test(l)) ?? "";
  const files = byHeader.get(line) ?? [];
  files.push(entry.file);
  byHeader.set(line, files);
}

console.log(`path rule: ${[...byPath.values()].reduce((a, b) => a + b, 0)} files`);
for (const [parent, count] of [...byPath].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${count}\t${parent}/`);
}
console.log(`header rule: ${[...byHeader.values()].reduce((a, b) => a + b.length, 0)} files`);
for (const [line, files] of [...byHeader].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${files.length}\t${line.slice(0, 100)}\n\t  e.g. ${files[0]}`);
}
