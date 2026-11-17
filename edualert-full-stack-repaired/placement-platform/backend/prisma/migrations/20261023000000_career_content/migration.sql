-- Roadmaps, preparation guides, tips & actions.
-- Hand-written to follow Prisma's naming conventions (see docs/INTEGRATION_REPORT.md: verify with
-- `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <empty db> --exit-code`).

-- CreateTable
CREATE TABLE "Roadmap" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "targetRole" TEXT,
    "description" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Roadmap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoadmapStep" (
    "id" TEXT NOT NULL,
    "roadmapId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "CourseCategory",
    "orderIndex" INTEGER NOT NULL,
    "durationDays" INTEGER,
    "resourceUrl" TEXT,
    CONSTRAINT "RoadmapStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoadmapProgress" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoadmapProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrepGuide" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "CourseCategory" NOT NULL,
    "summary" TEXT,
    "body" TEXT NOT NULL,
    "companyId" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrepGuide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tip" (
    "id" TEXT NOT NULL,
    "category" "CourseCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actionText" TEXT,
    "actionUrl" TEXT,
    "belowPct" DOUBLE PRECISION NOT NULL DEFAULT 60,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoadmapStep_roadmapId_orderIndex_idx" ON "RoadmapStep"("roadmapId", "orderIndex");
CREATE UNIQUE INDEX "RoadmapProgress_studentId_stepId_key" ON "RoadmapProgress"("studentId", "stepId");
CREATE INDEX "PrepGuide_category_idx" ON "PrepGuide"("category");
CREATE INDEX "Tip_category_idx" ON "Tip"("category");

-- AddForeignKey
ALTER TABLE "RoadmapStep" ADD CONSTRAINT "RoadmapStep_roadmapId_fkey" FOREIGN KEY ("roadmapId") REFERENCES "Roadmap"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoadmapProgress" ADD CONSTRAINT "RoadmapProgress_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoadmapProgress" ADD CONSTRAINT "RoadmapProgress_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "RoadmapStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrepGuide" ADD CONSTRAINT "PrepGuide_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data-integrity CHECK constraints (not expressible in schema.prisma)
ALTER TABLE "RoadmapStep" ADD CONSTRAINT "RoadmapStep_duration_chk" CHECK ("durationDays" IS NULL OR "durationDays" BETWEEN 1 AND 365);
ALTER TABLE "Tip" ADD CONSTRAINT "Tip_belowPct_range_chk" CHECK ("belowPct" > 0 AND "belowPct" <= 100);
