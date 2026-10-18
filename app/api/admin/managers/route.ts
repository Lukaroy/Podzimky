import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import {
  getSession,
  getSessionToken,
  hashTeamPassword,
  normalizeLoginName,
  verifyRequestOrigin,
} from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { readGameState } from "@/lib/game-store";

// Ověří přihlášení a oprávnění hlavního administrátora pro správu účtů.
async function requireOwner(request: Request) {
  const user = await getSession(getSessionToken(request));
  if (!user || user.role !== "admin") {
    return { error: NextResponse.json({ error: "Přihlaste se jako administrátor." }, { status: 401 }) };
  }
  if (user.managerId) {
    return { error: NextResponse.json({ error: "Správce může spravovat jen hlavní administrátor." }, { status: 403 }) };
  }
  // Podúčet správce nesmí vytvářet ani odebírat další správce.
  return { user };
}

// Vrátí bezpečný veřejný seznam správců bez hashů hesel.
async function listManagers() {
  const managers = await getPrisma().manager.findMany({ orderBy: { createdAt: "asc" } });
  return managers.map((manager) => ({
    id: manager.id,
    username: manager.displayName,
    createdAt: manager.createdAt.toISOString(),
  }));
}

// Načte seznam podřízených správců pro administraci.
export async function GET(request: Request) {
  const auth = await requireOwner(request);
  if (auth.error) return auth.error;
  return NextResponse.json({ managers: await listManagers() }, { headers: { "Cache-Control": "no-store" } });
}

// Ověří vstup a založí nový účet správce s hashovaným heslem.
export async function POST(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  const auth = await requireOwner(request);
  if (auth.error) return auth.error;

  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }
  const displayName = typeof body.username === "string" ? body.username.trim() : "";
  const username = normalizeLoginName(displayName);
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || displayName.length > 80) {
    return NextResponse.json({ error: "Zadejte jméno správce (max. 80 znaků)." }, { status: 400 });
  }
  if (password.length < 8 || password.length > 256) {
    return NextResponse.json({ error: "Heslo správce musí mít alespoň 8 znaků." }, { status: 400 });
  }

  // Jedno přihlašovací jméno sdílí stejný prostor pro týmy i správce.
  const state = await readGameState();
  if (state.teams.some((team) => normalizeLoginName(team.name) === username)) {
    return NextResponse.json({ error: "Toto jméno už používá tým." }, { status: 409 });
  }
  if (await getPrisma().manager.findUnique({ where: { username } })) {
    return NextResponse.json({ error: "Správce s tímto jménem už existuje." }, { status: 409 });
  }

  await getPrisma().manager.create({
    data: { id: randomUUID(), username, displayName, passwordHash: hashTeamPassword(password) },
  });
  return NextResponse.json({ managers: await listManagers() }, { status: 201 });
}

// Odebere účet správce a současně ukončí všechny jeho relace.
export async function DELETE(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  const auth = await requireOwner(request);
  if (auth.error) return auth.error;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Chybí správce." }, { status: 400 });
  // Odebrání účtu v téže transakci zneplatní i jeho existující relace.
  await getPrisma().$transaction([
    getPrisma().manager.deleteMany({ where: { id } }),
    getPrisma().authSession.deleteMany({ where: { firebaseUid: `manager-${id}` } }),
  ]);
  return NextResponse.json({ managers: await listManagers() });
}
