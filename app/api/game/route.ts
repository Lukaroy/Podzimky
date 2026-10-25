import { NextResponse } from "next/server";

import {
  getSession,
  getSessionToken,
  hashTeamPassword,
  sanitizeGameState,
  verifyRequestOrigin,
} from "@/lib/auth";
import { normalizeGameState, readGameState, updateGameState, type GameState } from "@/lib/game-store";

// Vrátí přihlášenému uživateli herní stav očištěný podle jeho role.
export async function GET(request: Request) {
  const user = await getSession(getSessionToken(request));
  if (!user) return NextResponse.json({ error: "Přihlaste se pro pokračování." }, { status: 401 });

  const state = await readGameState();
  return NextResponse.json(sanitizeGameState(state, user));
}

// Sloučí povolené klientské změny se stavem serveru bez ztráty novějších dat.
export async function POST(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  const user = await getSession(getSessionToken(request));
  if (!user) return NextResponse.json({ error: "Přihlášení vypršelo." }, { status: 401 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 2_000_000) {
    return NextResponse.json({ error: "Požadavek je příliš velký." }, { status: 413 });
  }

  let clientPayload: GameState;
  try {
    clientPayload = normalizeGameState(await request.json() as Partial<GameState>);
  } catch {
    return NextResponse.json({ error: "Neplatná data hry." }, { status: 400 });
  }
  if (!Array.isArray(clientPayload.stations) || !Array.isArray(clientPayload.teams)) {
    return NextResponse.json({ error: "Neplatná data hry." }, { status: 400 });
  }

  if (user.role === "team") {
    // Týmová obrazovka se obnoví ze serveru; klientem poslaný stav týmu se neukládá.
    const state = await readGameState();
    return NextResponse.json({ ok: true, state: sanitizeGameState(state, user) });
  }

  const currentState = await readGameState();
  if (currentState.gameClosedAt) {
    return NextResponse.json({ error: "Hra je uzavřená a další změny nejsou povolené." }, { status: 409 });
  }
  const existingTeamIds = new Set(currentState.teams.map((team) => team.id));
  const incomingNames = new Set(currentState.teams.map((team) => team.name.trim().toLowerCase()));
  // Nové týmy musí mít jedinečné jméno a dostatečně dlouhé heslo.
  for (const team of clientPayload.teams) {
    if (existingTeamIds.has(team.id)) continue;
    const normalizedName = team.name.trim().toLowerCase();
    if (!normalizedName || normalizedName.length > 80 || incomingNames.has(normalizedName)) {
      return NextResponse.json({ error: "Názvy týmů musí být vyplněné a jedinečné." }, { status: 400 });
    }
    incomingNames.add(normalizedName);
    if (team.password.trim().length < 8) {
      return NextResponse.json({ error: "Nový tým musí mít heslo alespoň 8 znaků." }, { status: 400 });
    }
  }

  const nextState = await updateGameState((current) => {
    if (current.gameClosedAt) return current;
    // Správce může měnit jen přepady a události; týmy, stanoviště a odevzdání zůstávají podle serveru.
    const payload: GameState = user.managerId
      ? {
          ...current,
          flashMissions: clientPayload.flashMissions,
          events: clientPayload.events,
          teams: current.teams.map((team) => ({
            ...team,
            flashMissionId: clientPayload.teams.find((item) => item.id === team.id)?.flashMissionId ?? team.flashMissionId,
          })),
        }
      : clientPayload;
    // Klientský snapshot slučujeme se serverem, aby refresh ani stará karta nevrátily čas či postup.
    const submittedTeams = new Map(payload.teams.map((team) => [team.id, team]));
    const isOutdatedGameState = payload.gameStartedAt !== current.gameStartedAt;
    const mergedExistingTeams = current.teams.map((oldTeam) => {
      if (isOutdatedGameState) return oldTeam;
      const team = submittedTeams.get(oldTeam.id);
      if (!team) return oldTeam;
      const progressIsOutdated = (team.progressVersion ?? 0) !== (oldTeam.progressVersion ?? 0);
      const submittedPassword = team.password.trim();
      const password = submittedPassword
        ? submittedPassword.startsWith("scrypt$")
          ? submittedPassword
          : hashTeamPassword(submittedPassword)
        : oldTeam.password;
      submittedTeams.delete(team.id);
      return {
        ...team,
        password,
        completedStations: progressIsOutdated
          // Hlavní admin mohl mezitím změnit postup; starý klient jej nesmí obnovit.
          ? oldTeam.completedStations
          : [...new Set([...oldTeam.completedStations, ...team.completedStations])],
        scannedStationIds: progressIsOutdated
          ? oldTeam.scannedStationIds
          : [...new Set([...oldTeam.scannedStationIds, ...team.scannedStationIds])],
        progressVersion: oldTeam.progressVersion,
        flashMissionsUsed: oldTeam.flashMissionsUsed ?? 0,
        flashMissionId: oldTeam.flashMissionId && activeMissionIds.has(oldTeam.flashMissionId)
          ? oldTeam.flashMissionId
          : team.flashMissionId && activeMissionIds.has(team.flashMissionId)
            ? team.flashMissionId
            : undefined,
      };
    });
    const addedTeams = [...submittedTeams.values()].map((team) => ({
      ...team,
      password: team.password.startsWith("scrypt$") ? team.password : hashTeamPassword(team.password),
      flashMissionsUsed: 0,
    }));
    const currentSubmissions = new Map(current.submissions.map((submission) => [submission.id, submission]));
    // Zachová již známá odevzdání a přijme jen nové či dosud čekající klientské záznamy.
    for (const submission of payload.submissions) {
      const currentSubmission = currentSubmissions.get(submission.id);
      if (!currentSubmission || (
        user.role === "admin" &&
        currentSubmission.status === "pending" &&
        !currentSubmission.archivedAt
      )) {
        currentSubmissions.set(submission.id, submission);
      }
    }
    const mergedEvents = new Map(current.events.map((event) => [event.id, event]));
    // Přidá klientské události, aniž by přepsal souběžně přijaté události.
    for (const event of payload.events) {
      if (!mergedEvents.has(event.id)) mergedEvents.set(event.id, event);
    }

    const currentMissions = new Map(current.flashMissions.map((mission) => [mission.id, mission]));
    const submittedMissions = payload.flashMissions.map((mission) => {
      const existingMission = currentMissions.get(mission.id);
      currentMissions.delete(mission.id);
      return existingMission?.archivedAt
        ? { ...mission, archivedAt: existingMission.archivedAt }
        : mission;
    });
    const activeMissionIds = new Set(
      [...submittedMissions, ...currentMissions.values()]
        .filter((mission) => !mission.archivedAt)
        .map((mission) => mission.id),
    );

    return {
      ...payload,
      gameStartedAt: current.gameStartedAt,
      gameStoppedAt: current.gameStoppedAt,
      gamePausedMs: current.gamePausedMs,
      emergencyMessage: current.emergencyMessage,
      gameClosedAt: current.gameClosedAt,
      gameResults: current.gameResults,
      submissions: [...currentSubmissions.values()],
      flashMissions: [...submittedMissions, ...currentMissions.values()],
      teams: [...mergedExistingTeams, ...addedTeams],
      events: [...mergedEvents.values()]
        .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
        .slice(0, 12),
    };
  });
  if (nextState.gameClosedAt) {
    return NextResponse.json({ error: "Hra je uzavřená a další změny nejsou povolené." }, { status: 409 });
  }
  return NextResponse.json({ ok: true, state: sanitizeGameState(nextState, user) });
}
