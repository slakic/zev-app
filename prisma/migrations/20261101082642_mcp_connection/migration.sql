-- CreateEnum
CREATE TYPE "McpConnectionKind" AS ENUM ('TOKEN', 'OAUTH');

-- CreateEnum
CREATE TYPE "McpClient" AS ENUM ('CLAUDE', 'OPENAI', 'OTHER');

-- CreateTable
CREATE TABLE "McpConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "client" "McpClient" NOT NULL,
    "kind" "McpConnectionKind" NOT NULL DEFAULT 'TOKEN',
    "scopes" JSONB NOT NULL,
    "tokenHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "McpConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpConnection_tokenHash_key" ON "McpConnection"("tokenHash");

-- CreateIndex
CREATE INDEX "McpConnection_userId_idx" ON "McpConnection"("userId");

-- AddForeignKey
ALTER TABLE "McpConnection" ADD CONSTRAINT "McpConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
