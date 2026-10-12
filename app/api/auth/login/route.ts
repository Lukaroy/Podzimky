import { NextResponse } from "next/server";

import { createTeamCustomToken } from "@/lib/firebase-admin";
import { findTeamByCredentials, hashTeamPassword, verifyRequestOrigin } from "@/lib/auth";
import { readGameState, updateGameState } from "@/lib/game-store";
import {
  assertTeamLoginAllowed,
  clearTeamLoginFailures,
  LoginRateLimitError,
  recordFailedTeamLogin,
} from "@/lib/login-throttle";

export async function POST(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 8192) {
    return NextResponse.json({ error: "Požadavek je příliš velký." }, { status: 413 });
  }

  let body: { role?: unknown; name?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }
  if (
    body.role !== "team" ||
    typeof body.name !== "string" ||
    body.name.length > 120 ||
    typeof body.password !== "string" ||
    body.password.length < 1 ||
    body.password.length > 256
  ) {
    return NextResponse.json({ error: "Nesprávné přihlašovací údaje." }, { status: 401 });
  }

  const enteredPassword = body.password;
  let throttleKey: string;
  try {
    throttleKey = await assertTeamLoginAllowed(request, body.name);
  } catch (error) {
    if (error instanceof LoginRateLimitError) {
      return NextResponse.json(
        { error: error.message },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    throw error;
  }
  let state = await readGameState();
  const team = findTeamByCredentials(state, body.name, enteredPassword);
  if (!team) {
    await recordFailedTeamLogin(throttleKey);
    return NextResponse.json({ error: "Nesprávné přihlašovací údaje." }, { status: 401 });
  }
  await clearTeamLoginFailures(throttleKey);

  if (!team.password.startsWith("scrypt$")) {
    await updateGameState((current) => ({
      ...current,
      teams: current.teams.map((currentTeam) =>
        currentTeam.id === team.id
          ? { ...currentTeam, password: hashTeamPassword(enteredPassword) }
          : currentTeam,
      ),
    }));
    state = await readGameState();
  }

  const currentTeam = state.teams.find((item) => item.id === team.id);
  if (!currentTeam) return NextResponse.json({ error: "Tým nebyl nalezen." }, { status: 404 });
  const customToken = await createTeamCustomToken(currentTeam.id);
  return NextResponse.json({ customToken });
}
