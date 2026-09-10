import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { Pool } from "pg";

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgres://flowforge:flowforge@localhost:5432/flowforge";
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DB_SSL === "true",
  });

  const client = await pool.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    );

    const dir = join(__dirname, "migrations");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    console.log(`Found ${files.length} migration files`);

    const { rows } = await client.query(`SELECT name FROM schema_migrations`);
    const applied = new Set(rows.map((r) => r.name));

    let appliedCount = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(dir, file), "utf8");
      console.log(`Applying migration: ${file}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [
          file,
        ]);
        await client.query("COMMIT");
        appliedCount++;
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`Migration ${file} failed:`, err);
        process.exit(1);
      }
    }

    console.log(
      appliedCount === 0
        ? "Database is up to date"
        : `Applied ${appliedCount} migration(s)`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});