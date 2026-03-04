import { mkdir, rm, cp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");

async function run() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  const files = ["index.html", "styles.css", "app.js", "README.md"];
  for (const f of files) {
    await cp(resolve(root, f), resolve(dist, f));
  }

  // Copy static provider snapshots if present (generated in Actions by data:build)
  try {
    await cp(resolve(root, "data"), resolve(dist, "data"), { recursive: true });
  } catch (_) {
    // optional
  }

  const now = new Date().toISOString();
  const indexPath = resolve(dist, "index.html");
  const html = await readFile(indexPath, "utf8");
  const stamped = html.replace(
    "</footer>",
    `<p class=\"build-meta\">Build timestamp (UTC): ${now}</p></footer>`
  );
  await writeFile(indexPath, stamped, "utf8");

  console.log("Build complete. Output in dist/");
}

run().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
