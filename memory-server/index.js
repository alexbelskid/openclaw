const express = require("express");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "3001", 10);
const TOKEN = process.env.MEMORY_API_TOKEN || "";
const WORKSPACE = process.env.WORKSPACE_DIR || "/root/.openclaw/workspace";

const app = express();
app.use(express.json());

// Auth middleware — optional, only enforced if TOKEN is set.
// When behind nginx on localhost, token can be omitted.
if (TOKEN) {
  app.use("/api/memory", (req, res, next) => {
    const auth = req.headers.authorization;
    if (auth && auth === `Bearer ${TOKEN}`) return next();
    // Allow requests without auth when no token is configured
    if (!TOKEN) return next();
    return res.status(401).json({ error: "unauthorized" });
  });
}

/**
 * GET /api/memory/files
 *
 * Returns ALL .md files with their contents in a single response.
 * Scans: top-level *.md + memory/*.md for each agent directory.
 *
 * Response: { files: [{ path, name, content, mtime }] }
 */
app.get("/api/memory/files", (req, res) => {
  try {
    const agentDirs = fs
      .readdirSync(WORKSPACE, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const files = [];

    for (const agent of agentDirs) {
      const agentPath = path.join(WORKSPACE, agent);

      // Top-level .md files (MEMORY.md, AGENTS.md, etc.)
      collectMdFiles(agentPath, agent, "", files);

      // memory/ subdirectory
      const memoryDir = path.join(agentPath, "memory");
      if (fs.existsSync(memoryDir) && fs.statSync(memoryDir).isDirectory()) {
        collectMdFiles(memoryDir, agent, "memory/", files);
      }
    }

    res.json({ files });
  } catch (err) {
    console.error("Error reading workspace:", err.message);
    res.status(500).json({ error: "failed to read workspace" });
  }
});

function collectMdFiles(dir, agent, prefix, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

    const fullPath = path.join(dir, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      const content = fs.readFileSync(fullPath, "utf-8");
      out.push({
        path: `${agent}/${prefix}${entry.name}`,
        name: entry.name.replace(/\.md$/, ""),
        content,
        mtime: stat.mtimeMs,
      });
    } catch {
      // skip unreadable files
    }
  }
}

/**
 * PUT /api/memory/files/:path(*)
 *
 * Save file content. Body: { content: string }
 * Path must resolve within WORKSPACE and end in .md.
 */
app.put("/api/memory/files/:path(*)", (req, res) => {
  try {
    const relPath = req.params.path;
    if (!relPath || !relPath.endsWith(".md")) {
      return res.status(400).json({ error: "only .md files allowed" });
    }

    const filePath = path.resolve(WORKSPACE, relPath);
    const resolvedWorkspace = path.resolve(WORKSPACE);

    // Security: ensure path stays within workspace
    if (!filePath.startsWith(resolvedWorkspace + path.sep) && filePath !== resolvedWorkspace) {
      return res.status(403).json({ error: "forbidden" });
    }

    const content = req.body?.content;
    if (typeof content !== "string") {
      return res.status(400).json({ error: "content must be a string" });
    }

    // Ensure parent directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, content, "utf-8");
    res.json({ ok: true });
  } catch (err) {
    console.error("Error saving file:", err.message);
    res.status(500).json({ error: "failed to save file" });
  }
});

// Health check
app.get("/api/memory/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`memory-server listening on 127.0.0.1:${PORT}`);
});
