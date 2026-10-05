-- AlterTable
ALTER TABLE "TicketAttachment" ADD COLUMN     "commentId" TEXT;

-- CreateIndex
CREATE INDEX "TicketAttachment_commentId_idx" ON "TicketAttachment"("commentId");

-- AddForeignKey
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "TicketComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

