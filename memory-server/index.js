const express = require("express");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "3001", 10);
const TOKEN = process.env.MEMORY_API_TOKEN || "";
const WORKSPACE = process.env.WORKSPACE_DIR || "/root/.openclaw/workspace";

if (!TOKEN) {
  console.error("MEMORY_API_TOKEN is required");
  process.exit(1);
}

const app = express();

// Auth middleware
app.use("/api/memory", (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${TOKEN}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

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

// Health check
app.get("/api/memory/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`memory-server listening on 127.0.0.1:${PORT}`);
});
