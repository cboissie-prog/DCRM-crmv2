-- Todo : listes multiples partageables, assignation, fil de tâche
-- (spec docs/superpowers/specs/2026-10-14-todo-listes-partagees-design.md, §3)
-- Migration avec remplissage : chaque propriétaire de tâche existant reçoit une liste
-- personnelle « Mes tâches » à laquelle ses tâches sont rattachées.

-- ─── 1. CreateTable ─────────────────────────────────────────────────────────
CREATE TABLE "TodoList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "isPersonal" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TodoList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TodoListMember" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'EDITOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TodoListMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TodoComment" (
    "id" TEXT NOT NULL,
    "todoId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TodoComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TodoEvent" (
    "id" TEXT NOT NULL,
    "todoId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "authorId" TEXT,
    "fromValue" TEXT,
    "toValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TodoEvent_pkey" PRIMARY KEY ("id")
);

-- ─── 2. AlterTable : Todo (colonnes nullable le temps du remplissage) ───────
ALTER TABLE "Todo" ADD COLUMN     "listId" TEXT,
ADD COLUMN     "assigneeId" TEXT;

-- ─── 3. Remplissage : liste personnelle par propriétaire de tâche ───────────
INSERT INTO "TodoList" ("id", "name", "isPersonal", "position", "ownerId", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || t."ownerId"), 'Mes tâches', true, 0, t."ownerId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "ownerId" FROM "Todo") t;

UPDATE "Todo" SET "listId" = (
    SELECT l."id" FROM "TodoList" l WHERE l."isPersonal" = true AND l."ownerId" = "Todo"."ownerId"
);

-- ─── 4. Contraintes, index et clés étrangères ───────────────────────────────
ALTER TABLE "Todo" ALTER COLUMN "listId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "TodoList_ownerId_idx" ON "TodoList"("ownerId");

CREATE INDEX "TodoListMember_userId_idx" ON "TodoListMember"("userId");

CREATE UNIQUE INDEX "TodoListMember_listId_userId_key" ON "TodoListMember"("listId", "userId");

CREATE INDEX "TodoComment_todoId_idx" ON "TodoComment"("todoId");

CREATE INDEX "TodoEvent_todoId_idx" ON "TodoEvent"("todoId");

CREATE INDEX "Todo_listId_idx" ON "Todo"("listId");

CREATE INDEX "Todo_assigneeId_idx" ON "Todo"("assigneeId");

-- AddForeignKey
ALTER TABLE "TodoList" ADD CONSTRAINT "TodoList_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TodoListMember" ADD CONSTRAINT "TodoListMember_listId_fkey" FOREIGN KEY ("listId") REFERENCES "TodoList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TodoListMember" ADD CONSTRAINT "TodoListMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TodoComment" ADD CONSTRAINT "TodoComment_todoId_fkey" FOREIGN KEY ("todoId") REFERENCES "Todo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TodoComment" ADD CONSTRAINT "TodoComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TodoEvent" ADD CONSTRAINT "TodoEvent_todoId_fkey" FOREIGN KEY ("todoId") REFERENCES "Todo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TodoEvent" ADD CONSTRAINT "TodoEvent_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Todo" ADD CONSTRAINT "Todo_listId_fkey" FOREIGN KEY ("listId") REFERENCES "TodoList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Todo" ADD CONSTRAINT "Todo_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
