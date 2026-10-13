import { Prisma } from "@prisma/client";

import { getPrisma } from "@/lib/db";

export type StationType =
  | "photo"
  | "video"
  | "text"
  | "number"
  | "multiple-choice"
  | "riddle"
  | "form";

export type SubmissionStatus = "pending" | "approved" | "rejected";

export type Station = {
  id: string;
  order: number;
  title: string;
  uid: string;
  description: string;
  clue: string;
  task: string;
  type: StationType;
  requiresApproval: boolean;
  instructions?: string;
  options?: string[];
  answer?: string;
  image?: string;
  formQuestions?: Array<{
    id: string;
    label: string;
    type: "text" | "number" | "multiple-choice";
    options?: string[];
  }>;
};

export type Submission = {
  id: string;
  stationId: string;
  missionId?: string;
  teamId: string;
  status: SubmissionStatus;
  content: string;
  evidence: string;
  mediaUrl?: string;
  comment: string;
  createdAt: string;
};

export type Team = {
  id: string;
  name: string;
  password: string;
  completedStations: string[];
  scannedStationIds: string[];
  flashMissionId?: string;
};

export type FlashMission = {
  id: string;
  title: string;
  description: string;
  type: StationType;
  targetMode: "all" | "specific";
  targetTeamIds: string[];
  requiresApproval: boolean;
  instructions: string;
};

export type GameEvent = {
  id: string;
  teamId?: string;
  message: string;
  tone: "info" | "success" | "warning";
  createdAt: string;
};

export type GameState = {
  stations: Station[];
  teams: Team[];
  submissions: Submission[];
  flashMissions: FlashMission[];
  events: GameEvent[];
};

export const emptyGameState: GameState = {
  stations: [],
  teams: [],
  submissions: [],
  flashMissions: [],
  events: [],
};

export function normalizeGameState(value?: Partial<GameState> | null): GameState {
  const safeValue = value && typeof value === "object" ? value : {};

  return {
    stations: Array.isArray(safeValue.stations)
      ? safeValue.stations.map((station) => ({
          ...station,
          clue: station.clue || "",
          requiresApproval: station.requiresApproval ?? true,
        }))
      : [],
    teams: Array.isArray(safeValue.teams)
      ? safeValue.teams.map((team) => ({
          ...team,
          scannedStationIds: Array.isArray(team.scannedStationIds) ? team.scannedStationIds : [],
        }))
      : [],
    submissions: Array.isArray(safeValue.submissions) ? safeValue.submissions : [],
    flashMissions: Array.isArray(safeValue.flashMissions)
      ? safeValue.flashMissions.map((mission) => ({
          ...mission,
          requiresApproval: mission.requiresApproval ?? true,
        }))
      : [],
    events: Array.isArray(safeValue.events) ? safeValue.events : [],
  };
}

let databaseReady: Promise<void> | undefined;

export async function ensureDatabase(): Promise<void> {
  databaseReady ??= (async () => {
    await getPrisma().gameState.upsert({
      where: { id: "current" },
      update: {},
      create: {
        id: "current",
        payload: JSON.parse(JSON.stringify(emptyGameState)) as Prisma.InputJsonValue,
      },
    });
  })().catch((error: unknown) => {
    databaseReady = undefined;
    throw error;
  });
  await databaseReady;
}

export async function readGameState(): Promise<GameState> {
  await ensureDatabase();
  const prisma = getPrisma();
  const record = await prisma.gameState.findUnique({ where: { id: "current" } });
  if (!record) throw new Error("Game state record was not initialized.");
  return normalizeGameState(JSON.parse(JSON.stringify(record.payload)) as Partial<GameState>);
}

export async function updateGameState(
  update: (currentState: GameState) => GameState,
): Promise<GameState> {
  await ensureDatabase();
  const prisma = getPrisma();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const row = await prisma.gameState.findUnique({ where: { id: "current" } });
    if (!row) throw new Error("Stored game state was not initialized.");
    const stored = JSON.parse(JSON.stringify(row.payload)) as Partial<GameState>;
    const nextState = normalizeGameState(update(normalizeGameState(stored)));
    const result = await prisma.gameState.updateMany({
      where: { id: "current", version: row.version },
      data: {
        payload: JSON.parse(JSON.stringify(nextState)) as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
    if (result.count > 0) return nextState;
  }
  throw new Error("Could not update game state after concurrent changes.");
}
