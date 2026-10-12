CREATE TABLE IF NOT EXISTS "game_state" (
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "game_state_pkey" PRIMARY KEY ("id")
);
