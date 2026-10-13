CREATE TABLE "team_qr_credentials" (
    "team_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_qr_credentials_pkey" PRIMARY KEY ("team_id")
);

CREATE UNIQUE INDEX "team_qr_credentials_token_hash_key" ON "team_qr_credentials"("token_hash");
