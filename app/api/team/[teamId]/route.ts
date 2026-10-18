import { NextResponse } from "next/server";

import { getSession, getSessionToken, sanitizeGameState, verifyRequestOrigin } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { readGameState, updateGameState } from "@/lib/game-store";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }

  const user = await getSession(getSessionToken(request));
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Přihlaste se jako administrátor." }, { status: 401 });
  }

  const { teamId } = await params;
  if (!/^team-[A-Za-z0-9_-]{1,128}$/.test(teamId)) {
    return NextResponse.json({ error: "Neplatný tým." }, { status: 400 });
  }
  if ((await readGameState()).gameClosedAt) {
    return NextResponse.json({ error: "Po uzavření hry už týmy nelze měnit." }, { status: 409 });
  }

  let removedTeamName: string | undefined;
  const state = await updateGameState((current) => {
    if (current.gameClosedAt) return current;
    const team = current.teams.find((item) => item.id === teamId);
    if (!team) return current;

    removedTeamName = team.name;
    const teams = current.teams.filter((item) => item.id !== teamId);
    const flashMissions = current.flashMissions
      .map((mission) => ({
        ...mission,
        targetTeamIds: mission.targetTeamIds.filter((id) => id !== teamId),
      }))
      .filter((mission) => mission.targetTeamIds.length > 0);
    const activeMissionIds = new Set(flashMissions.map((mission) => mission.id));

    return {
      ...current,
      teams: teams.map((item) =>
        item.flashMissionId && !activeMissionIds.has(item.flashMissionId)
          ? { ...item, flashMissionId: undefined }
          : item,
      ),
      flashMissions,
      submissions: current.submissions.filter((submission) => submission.teamId !== teamId),
      events: [
        {
          id: crypto.randomUUID(),
          message: `Pořadatel odstranil tým ${team.name}.`,
          tone: "warning" as const,
          createdAt: new Date().toISOString(),
        },
        ...current.events.filter((event) => event.teamId !== teamId),
      ].slice(0, 12),
    };
  });

  if (state.gameClosedAt) {
    return NextResponse.json({ error: "Po uzavření hry už týmy nelze měnit." }, { status: 409 });
  }
  if (!removedTeamName) {
    return NextResponse.json({ error: "Tým už neexistuje." }, { status: 404 });
  }

  const prisma = getPrisma();
  await prisma.$transaction([
    prisma.authSession.deleteMany({ where: { teamId } }),
    prisma.teamQrCredential.deleteMany({ where: { teamId } }),
  ]);

  return NextResponse.json({ ok: true, state: sanitizeGameState(state, user) });
}
