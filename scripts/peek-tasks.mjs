import Database from "better-sqlite3";

const db = new Database(".macai/macai.db", { readonly: true });
const active = db
  .prepare(
    `SELECT id, title, status, mode, worktree_path
     FROM tasks
     WHERE status NOT IN ('completed', 'failed', 'blocked', 'cancelled', 'skipped')
     ORDER BY updated_at DESC
     LIMIT 30`,
  )
  .all();
console.log("active:", JSON.stringify(active, null, 2));
console.log("by status:", db.prepare("SELECT status, count(*) c FROM tasks GROUP BY status").all());
db.close();
