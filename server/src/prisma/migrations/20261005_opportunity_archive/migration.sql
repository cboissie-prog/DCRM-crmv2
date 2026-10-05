-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "autoArchive" BOOLEAN NOT NULL DEFAULT true;
