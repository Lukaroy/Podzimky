import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { getPrisma } from "@/lib/db";
import { verifyFirebaseSessionCookie } from "@/lib/firebase-admin";
import type { GameState, Team } from "@/lib/game-store";

export type SessionUser = { role: "admin" } | { role: "team"; teamId: string };

export const SESSION_COOKIE_NAME = "tracker_session";

export function getSessionToken(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const token = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`))
    ?.slice(SESSION_COOKIE_NAME.length + 1);
  return token;
}

export async function getSession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const session = await getPrisma().authSession.findUnique({ where: { tokenHash } });
  if (!session || session.expiresAt.getTime() <= Date.now()) return null;
  try {
    const decoded = await verifyFirebaseSessionCookie(token);
    if (decoded.uid !== session.firebaseUid) return null;
    if (
      session.role === "admin" &&
      process.env.FIREBASE_ADMIN_UID &&
      decoded.uid === process.env.FIREBASE_ADMIN_UID.trim() &&
      session.teamId === null
    ) {
      return { role: "admin" };
    }
    if (
      session.role === "team" &&
      typeof session.teamId === "string" &&
      decoded.role === "team" &&
      decoded.teamId === session.teamId
    ) {
      return { role: "team", teamId: session.teamId };
    }
    return null;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && error.code.startsWith("auth/")) {
      return null;
    }
    throw error;
  }
}

export async function storeFirebaseSession(
  token: string,
  firebaseUid: string,
  user: SessionUser,
  expiresAt: number,
) {
  const prisma = getPrisma();
  const now = new Date();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await prisma.authSession.deleteMany({ where: { expiresAt: { lte: now } } });
  await prisma.authSession.upsert({
    where: { tokenHash },
    create: {
      tokenHash,
      firebaseUid,
      role: user.role,
      teamId: user.role === "team" ? user.teamId : null,
      expiresAt: new Date(expiresAt),
    },
    update: {
      firebaseUid,
      role: user.role,
      teamId: user.role === "team" ? user.teamId : null,
      expiresAt: new Date(expiresAt),
    },
  });
}

export async function revokeSession(token: string | undefined) {
  if (!token) return;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await getPrisma().authSession.deleteMany({ where: { tokenHash } });
}

export function verifyTeamPassword(password: string, storedPassword: string) {
  if (storedPassword.startsWith("scrypt$")) {
    const [, salt, expectedHex] = storedPassword.split("$");
    if (!salt || !/^[0-9a-f]{128}$/i.test(expectedHex ?? "")) return false;
    const expected = Buffer.from(expectedHex, "hex");
    const actual = scryptSync(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
  }

  const actual = Buffer.from(password);
  const expected = Buffer.from(storedPassword);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function hashTeamPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function sanitizeGameState(state: GameState, user: SessionUser): GameState {
  const safeTeams = state.teams.map((team) => ({ ...team, password: "" }));
  if (user.role === "admin") return { ...state, teams: safeTeams };

  const team = state.teams.find((item) => item.id === user.teamId);
  const nextOrder = Math.max(
    ...state.stations
      .filter((station) => team?.completedStations.includes(station.id))
      .map((station) => station.order),
    0,
  ) + 1;
  const safeStations = state.stations.map((station) => {
    const isCompleted = team?.completedStations.includes(station.id) ?? false;
    const isCurrent = station.order === nextOrder;
    const visibleStation = { ...station };
    delete visibleStation.answer;
    visibleStation.uid = "";
    if (isCompleted) {
      return { ...visibleStation, uid: "", description: "", clue: "", task: "", answer: undefined, options: undefined, formQuestions: undefined };
    }
    if (isCurrent) {
      const hasScannedCurrent = team?.scannedStationIds.includes(station.id) ?? false;
      return {
        ...visibleStation,
        uid: "",
        answer: undefined,
        ...(!hasScannedCurrent
          ? {
              task: "",
              type: "text" as const,
              instructions: undefined,
              options: undefined,
              formQuestions: undefined,
            }
          : {}),
      };
    }
    return {
      ...visibleStation,
      title: "Uzamčeno",
      uid: "",
      description: "",
      clue: "",
      task: "",
      answer: undefined,
      options: undefined,
      formQuestions: undefined,
      instructions: undefined,
      image: undefined,
    };
  });

  return {
    ...state,
    stations: safeStations,
    teams: safeTeams.filter((team) => team.id === user.teamId),
    submissions: state.submissions.filter((submission) => submission.teamId === user.teamId),
    flashMissions: state.flashMissions.filter(
      (mission) =>
        state.teams.some((team) => team.id === user.teamId && team.flashMissionId === mission.id),
    ),
    events: state.events.filter((event) => !event.teamId || event.teamId === user.teamId),
  };
}

export function verifyRequestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    const requestUrl = new URL(request.url);
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const publicUrl = forwardedHost
      ? new URL(`${forwardedProto === "https" ? "https" : requestUrl.protocol.slice(0, -1)}://${forwardedHost}`)
      : requestUrl;
    return new URL(origin).origin === publicUrl.origin;
  } catch {
    return false;
  }
}

export function findTeamByCredentials(state: GameState, name: string, password: string): Team | undefined {
  const normalizedName = (value: string) =>
    value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

  return state.teams.find(
    (team) =>
      normalizedName(team.name) === normalizedName(name) &&
      verifyTeamPassword(password, team.password),
  );
}
