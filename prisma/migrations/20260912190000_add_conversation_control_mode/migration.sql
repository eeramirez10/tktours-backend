CREATE TYPE "ConversationControlMode" AS ENUM ('AI', 'HUMAN');

ALTER TABLE "Conversation"
ADD COLUMN "controlMode" "ConversationControlMode" NOT NULL DEFAULT 'AI';
