import { execSync } from "node:child_process";

const run = (command) => execSync(command, { stdio: "inherit" });

// Migrace se spouští jen při produkčním nasazení; preview nemusí mít přístup k databázi.
if (process.env.VERCEL_ENV === "production") {
  run("npx prisma migrate deploy");
}
run("npx prisma generate");
run("npx next build");
