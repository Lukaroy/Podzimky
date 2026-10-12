import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function getFirebaseAdminAuth() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase Admin credentials are not fully configured.");
  }
  const app = getApps().find((item) => item.name === "tracker-admin")
    ?? initializeApp(
      { credential: cert({ projectId, clientEmail, privateKey }) },
      "tracker-admin",
    );
  return getAuth(app);
}

export function createTeamCustomToken(teamId: string) {
  return getFirebaseAdminAuth().createCustomToken(teamId, { role: "team", teamId });
}

export async function createFirebaseSessionCookie(idToken: string) {
  const auth = getFirebaseAdminAuth();
  const decoded = await auth.verifyIdToken(idToken, true);
  const adminUid = process.env.FIREBASE_ADMIN_UID?.trim();
  const isAdmin = Boolean(adminUid && decoded.uid === adminUid);
  const teamId = decoded.role === "team" && typeof decoded.teamId === "string"
    ? decoded.teamId
    : null;
  if (!isAdmin && !teamId) return null;
  const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 14;
  const cookie = await auth.createSessionCookie(idToken, { expiresIn: expiresAt - Date.now() });
  if (isAdmin) return { cookie, expiresAt, firebaseUid: decoded.uid, user: { role: "admin" as const } };
  if (!teamId) return null;
  return { cookie, expiresAt, firebaseUid: decoded.uid, user: { role: "team" as const, teamId } };
}

export async function verifyFirebaseSessionCookie(cookie: string) {
  return getFirebaseAdminAuth().verifySessionCookie(cookie, true);
}
