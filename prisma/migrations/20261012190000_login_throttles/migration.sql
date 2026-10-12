CREATE TABLE "login_throttles" (
    "key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "login_throttles_pkey" PRIMARY KEY ("key")
);
