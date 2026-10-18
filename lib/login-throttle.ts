import { createHash } from "node:crypto";

import { getPrisma } from "@/lib/db";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 10;
let cleanupCounter = 0;

export class LoginRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Příliš mnoho neúspěšných pokusů. Zkuste to znovu později.");
    this.name = "LoginRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// Vytvoří anonymní klíč limitu z normalizovaného jména a adresy klienta.
function getThrottleKey(request: Request, teamName: string) {
  const forwardedFor = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")
    ?? "unknown";
  const clientAddress = forwardedFor.split(",").map((part) => part.trim()).filter(Boolean).at(-1) ?? "unknown";
  const normalizedName = teamName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  // Hash chrání identitu týmu i adresu před uložením v čitelné podobě.
  return createHash("sha256").update(`${normalizedName}\0${clientAddress}`).digest("hex");
}

// Zastaví další pokus, pokud tým v aktuálním časovém okně překročil limit.
export async function assertTeamLoginAllowed(request: Request, teamName: string) {
  const key = getThrottleKey(request, teamName);
  const record = await getPrisma().loginThrottle.findUnique({ where: { key } });
  if (!record || record.attempts < MAX_FAILED_ATTEMPTS) return key;

  const retryAfterSeconds = Math.ceil((record.windowStartedAt.getTime() + WINDOW_MS - Date.now()) / 1000);
  if (retryAfterSeconds <= 0) return key;
  throw new LoginRateLimitError(retryAfterSeconds);
}

// Zaznamená chybný pokus a občas promaže dávno neaktivní limity.
export async function recordFailedTeamLogin(key: string) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - WINDOW_MS);
  const prisma = getPrisma();
  await prisma.loginThrottle.updateMany({
    where: { key, windowStartedAt: { lte: cutoff } },
    data: { windowStartedAt: now, attempts: 0 },
  });
  await prisma.loginThrottle.upsert({
    where: { key },
    create: { key, attempts: 1, windowStartedAt: now },
    update: { attempts: { increment: 1 } },
  });
  cleanupCounter += 1;
  if (cleanupCounter >= 100) {
    // Staré záznamy mažeme průběžně, ne při každém neúspěšném pokusu.
    cleanupCounter = 0;
    await prisma.loginThrottle.deleteMany({
      where: { windowStartedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
    });
  }
}

// Odstraní neúspěšné pokusy po úspěšném přihlášení.
export async function clearTeamLoginFailures(key: string) {
  await getPrisma().loginThrottle.deleteMany({ where: { key } });
}
