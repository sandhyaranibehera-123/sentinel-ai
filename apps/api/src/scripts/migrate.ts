import "../config/dotenv.js";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../../../database/migrations");

async function migrate() {
  const url = process.env.DATABASE_URL ?? "postgresql://nexus:nexus@localhost:5432/nexus";
  const sql = postgres(url, { max: 1 });

  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `;

  const applied = await sql<{ name: string }[]>`SELECT name FROM _migrations ORDER BY id`;
  const appliedSet = new Set(applied.map((r) => r.name));

  const files = readdirSync(migrationsDir)
    .filter((f) => f.match(/^\d{3}_.*\.sql$/))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`⏭  Skipping ${file} (already applied)`);
      continue;
    }
    console.log(`▶  Applying ${file}...`);
    const content = readFileSync(join(migrationsDir, file), "utf-8");
    if (content.includes("CONCURRENTLY")) {
      // CREATE INDEX CONCURRENTLY cannot run inside a transaction block, and
      // postgres.js implicitly wraps multi-statement `unsafe()` calls in one —
      // so run each statement in the file as its own round trip.
      const statements = content
        .split(";\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith("--"));
      for (const statement of statements) {
        await sql.unsafe(statement);
      }
    } else {
      await sql.unsafe(content);
    }
    await sql`INSERT INTO _migrations (name) VALUES (${file})`;
    console.log(`✓  Applied ${file}`);
  }

  console.log("Migration complete.");
  await sql.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
