CREATE TABLE "auth_sessions" (
    "token_hash" TEXT NOT NULL,
    "firebase_uid" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "team_id" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("token_hash")
);

CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");
