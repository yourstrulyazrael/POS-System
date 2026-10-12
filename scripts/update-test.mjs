// Test the desktop app's live update without publishing to GitHub.
//
//   npm run update:test [-- --version 1.1.1] [-- --port 5055] [-- --skip-web]
//     Builds the app as a newer version into dist-update-test/ (package.json is
//     not changed) and serves the update files on http://127.0.0.1:<port>/.
//
//   npm run update:test-launch [-- --exe "<path to Clover POS.exe>"] [-- --port 5055]
//     Starts the installed app pointed at that server (CLOVER_UPDATE_URL).
//
// Typical run: install the normal build (dist-desktop), then in one terminal
// `npm run update:test`, and in another `npm run update:test-launch`. The app
// finds the newer version within seconds, downloads it, and offers
// "Restart to update" (marked TEST UPDATE).
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(root, "dist-update-test");
const args = process.argv.slice(2);
const command = args[0];
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index > 0 && args[index + 1] ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const port = Number(option("port", "5055"));
const feedUrl = `http://127.0.0.1:${port}/`;

function run(executable, commandArgs) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE; // set by VS Code terminals; breaks Electron builds
    const child = spawn(executable, commandArgs, { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${executable} ${commandArgs.join(" ")} exited with ${code}`))));
    child.on("error", reject);
  });
}

function nextPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new Error(`Can't read version "${version}" from package.json.`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

async function buildTestVersion() {
  const current = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
  const version = option("version", nextPatch(current));
  console.log(`\nBuilding test update ${version} (installed builds are ${current}) into dist-update-test/ …\n`);
  if (!flag("skip-web")) await run("npx", ["--no-install", "next", "build"]);
  await run("npx", [
    "--no-install", "electron-builder", "--win", "nsis", "--publish", "never",
    `-c.extraMetadata.version=${version}`,
    `-c.directories.output=dist-update-test`,
  ]);
  return version;
}

// Only the update files are served: latest.yml, the installer and its blockmap.
const servable = /^(latest\.yml|Clover-POS-Setup-[\w.-]+\.exe(\.blockmap)?)$/;
const contentTypes = { ".yml": "text/yaml; charset=utf-8", ".exe": "application/octet-stream", ".blockmap": "application/octet-stream" };

function serve() {
  if (!existsSync(path.join(outputDir, "latest.yml"))) {
    throw new Error("dist-update-test/latest.yml is missing. Run `npm run update:test` (without --serve-only) first.");
  }
  const manifest = readFileSync(path.join(outputDir, "latest.yml"), "utf8");
  const version = /^version:\s*(.+)$/m.exec(manifest)?.[1]?.trim();

  const server = createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url ?? "/", feedUrl).pathname.slice(1));
    const file = path.join(outputDir, name);
    const time = new Date().toLocaleTimeString();
    if ((request.method !== "GET" && request.method !== "HEAD") || !servable.test(name) || !existsSync(file)) {
      console.log(`${time}  ${request.method} /${name} → 404`);
      response.writeHead(404).end();
      return;
    }
    const size = statSync(file).size;
    const headers = { "Content-Type": contentTypes[path.extname(name)] ?? "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
    // Single byte ranges are supported; multi-range (differential) requests get
    // the whole file, and the updater falls back to a full download.
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
        response.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
      console.log(`${time}  ${request.method} /${name} bytes ${start}-${end}`);
      response.writeHead(206, { ...headers, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}` });
      if (request.method === "HEAD") return response.end();
      createReadStream(file, { start, end }).pipe(response);
      return;
    }
    console.log(`${time}  ${request.method} /${name} (${(size / 1048576).toFixed(1)} MB)`);
    response.writeHead(200, { ...headers, "Content-Length": size });
    if (request.method === "HEAD") return response.end();
    createReadStream(file).pipe(response);
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`\nTest update server: ${feedUrl}  (offering version ${version})`);
    console.log("Next: in another terminal run  npm run update:test-launch");
    console.log("Press Ctrl+C to stop.\n");
  });
}

function findInstalledApp() {
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const candidates = [
    option("exe", ""),
    path.join(localAppData, "Programs", "clover-pos", "Clover POS.exe"),
    path.join(localAppData, "Programs", "Clover POS", "Clover POS.exe"),
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Couldn't find the installed app. Install dist-desktop/Clover-POS-Setup-<version>.exe first, or pass --exe "<path to Clover POS.exe>".\nLooked in:\n  ${candidates.join("\n  ")}`);
  }
  return found;
}

function launch() {
  const exe = findInstalledApp();
  const env = { ...process.env, CLOVER_UPDATE_URL: feedUrl };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(exe, [], { env, detached: true, stdio: "ignore" });
  child.unref();
  console.log(`Started ${exe}\nwith CLOVER_UPDATE_URL=${feedUrl}\nThe app checks within a few seconds; see Account → App updates.`);
}

try {
  if (command === "build-and-serve") {
    if (!flag("serve-only")) await buildTestVersion();
    serve();
  } else if (command === "launch") {
    launch();
  } else {
    console.log("Usage: node scripts/update-test.mjs build-and-serve [--version x.y.z] [--port 5055] [--skip-web] [--serve-only]\n       node scripts/update-test.mjs launch [--exe <path>] [--port 5055]");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
