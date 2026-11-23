-- Phase 1: Visitor Activity Tracking & Lead Intelligence
-- Same change `npx prisma db push` makes from schema.prisma (additive only, no data is touched).
-- Use this file only where db push can't run (e.g. applying it by hand in pgAdmin / psql).

-- Lead: the website visitor who sent the inquiry
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "visitorId" TEXT;
CREATE INDEX IF NOT EXISTS "Lead_tenantId_visitorId_idx" ON "Lead"("tenantId", "visitorId");

-- VisitorActivity: one row per thing a visitor did on a dealer website
CREATE TABLE IF NOT EXISTS "VisitorActivity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "leadId" TEXT,
    "eventType" TEXT NOT NULL,
    "vehicleId" TEXT,
    "vehicleTitle" TEXT,
    "pagePath" TEXT,
    "scrollDepth" INTEGER,
    "durationSec" INTEGER,
    "city" TEXT,
    "region" TEXT,
    "userAgent" TEXT,
    "deviceType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisitorActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VisitorActivity_tenantId_createdAt_idx" ON "VisitorActivity"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "VisitorActivity_tenantId_visitorId_idx" ON "VisitorActivity"("tenantId", "visitorId");
CREATE INDEX IF NOT EXISTS "VisitorActivity_leadId_idx" ON "VisitorActivity"("leadId");
CREATE INDEX IF NOT EXISTS "VisitorActivity_createdAt_idx" ON "VisitorActivity"("createdAt");
CREATE INDEX IF NOT EXISTS "VisitorActivity_eventType_createdAt_idx" ON "VisitorActivity"("eventType", "createdAt");

DO $$ BEGIN
  ALTER TABLE "VisitorActivity" ADD CONSTRAINT "VisitorActivity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "VisitorActivity" ADD CONSTRAINT "VisitorActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
