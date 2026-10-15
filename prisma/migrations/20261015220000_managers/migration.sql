CREATE TABLE "managers" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "managers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "managers_username_key" ON "managers"("username");
