CREATE TABLE "team_qr_cards" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "team_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_qr_cards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_qr_cards_token_hash_key" ON "team_qr_cards"("token_hash");
CREATE UNIQUE INDEX "team_qr_cards_team_id_key" ON "team_qr_cards"("team_id");
