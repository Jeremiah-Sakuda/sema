import ts from "typescript";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Transpile only the isolated modules under test. No network, database, native
// bundler, credentials, or running server is needed for this safety suite.
const directory = await mkdtemp(join(tmpdir(), "sema-tests-"));
try {
  const modules = ["google-cloud", "wave", "timing", "media", "processing"];
  for (const name of [...modules, "routes", "fixtures", "safety.test"]) {
    const source = await readFile(new URL(name === "routes" ? "../src/routes/sema.ts" : ["safety.test", "fixtures"].includes(name) ? `./${name}.ts` : `../src/lib/${name}.ts`, import.meta.url), "utf8");
    let output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
    output = output.replace(/from "(?:\.\.\/src\/lib\/|\.\.\/lib\/|\.\/)([^".]+)"/g, 'from "./$1.mjs"').replace('from "google-auth-library"', 'from "./auth.mjs"');
    output = output.replace(/from "(?:@google\/genai|express|drizzle-orm|@workspace\/db|\.\/objectStorage.mjs|\.\/sema-demo.mjs|\.\/logger.mjs)"/g, 'from "./fixtures.mjs"');
    output = output.replace(/import \{([^}]+)\} from "@workspace\/api-zod";/, (_all, names) => names.split(",").filter(name => name.trim()).map(name => `const ${name.trim()} = { safeParse: data => ({ success: true, data }), parse: data => data };`).join("\n"));
    await writeFile(join(directory, `${name}.mjs`), output);
  }
  await writeFile(join(directory, "auth.mjs"), 'export class GoogleAuth { async getAccessToken() { return "test-access-token"; } }');
  const result = spawnSync(process.execPath, ["--test", join(directory, "safety.test.mjs")], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
