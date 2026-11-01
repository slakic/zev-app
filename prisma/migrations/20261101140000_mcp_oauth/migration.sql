-- CreateEnum
CREATE TYPE "McpOAuthClientKind" AS ENUM ('DCR', 'CIMD');

-- CreateEnum
CREATE TYPE "McpOAuthTokenKind" AS ENUM ('ACCESS', 'REFRESH');

-- AlterTable
ALTER TABLE "McpConnection" ADD COLUMN     "oauthClientId" TEXT;

-- CreateTable
CREATE TABLE "McpOAuthClient" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "McpOAuthClientKind" NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientUri" TEXT,
    "redirectUris" JSONB NOT NULL,
    "softwareId" TEXT,
    "softwareVersion" TEXT,
    "registeredIpHash" TEXT,
    "metadataExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "McpOAuthClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpOAuthCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "connectionName" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "connectionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpOAuthCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpOAuthToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "kind" "McpOAuthTokenKind" NOT NULL,
    "connectionId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpOAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpOAuthClient_clientId_key" ON "McpOAuthClient"("clientId");

-- CreateIndex
CREATE INDEX "McpOAuthClient_createdAt_idx" ON "McpOAuthClient"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "McpOAuthCode_codeHash_key" ON "McpOAuthCode"("codeHash");

-- CreateIndex
CREATE INDEX "McpOAuthCode_expiresAt_idx" ON "McpOAuthCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "McpOAuthToken_tokenHash_key" ON "McpOAuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "McpOAuthToken_connectionId_idx" ON "McpOAuthToken"("connectionId");

-- CreateIndex
CREATE INDEX "McpOAuthToken_expiresAt_idx" ON "McpOAuthToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "McpConnection" ADD CONSTRAINT "McpConnection_oauthClientId_fkey" FOREIGN KEY ("oauthClientId") REFERENCES "McpOAuthClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpOAuthCode" ADD CONSTRAINT "McpOAuthCode_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "McpOAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpOAuthToken" ADD CONSTRAINT "McpOAuthToken_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "McpConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpOAuthToken" ADD CONSTRAINT "McpOAuthToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "McpOAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
