-- Destino da etiqueta (Usado, Descartado, Cancelado) e Dividir (etiqueta filha ligada à de origem).

-- CreateEnum
CREATE TYPE "LabelStatus" AS ENUM ('ATIVA', 'ENCERRADA');

-- CreateEnum
CREATE TYPE "LabelOutcome" AS ENUM ('USADO', 'DESCARTADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "DiscardReason" AS ENUM ('PRAZO_VENCIDO', 'ALTERACAO_SENSORIAL', 'EMBALAGEM_DANIFICADA', 'OUTRO');

-- Etiquetas já existentes ficam ATIVA (default), sem destino nem origem.
-- AlterTable
ALTER TABLE "labels" ADD COLUMN     "capped_by_parent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "close_note" TEXT,
ADD COLUMN     "closed_at" TIMESTAMP(3),
ADD COLUMN     "closed_by_id" TEXT,
ADD COLUMN     "closed_by_name" TEXT,
ADD COLUMN     "discard_reason" "DiscardReason",
ADD COLUMN     "fractioned_at" DATE,
ADD COLUMN     "outcome" "LabelOutcome",
ADD COLUMN     "parent_label_id" TEXT,
ADD COLUMN     "split_request_id" TEXT,
ADD COLUMN     "status" "LabelStatus" NOT NULL DEFAULT 'ATIVA';

-- CreateIndex
CREATE INDEX "labels_status_discard_at_idx" ON "labels"("status", "discard_at");

-- CreateIndex
CREATE INDEX "labels_parent_label_id_idx" ON "labels"("parent_label_id");

-- CreateIndex
CREATE INDEX "labels_parent_label_id_split_request_id_idx" ON "labels"("parent_label_id", "split_request_id");

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Etiqueta de origem com filhas não pode ser apagada.
-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_parent_label_id_fkey" FOREIGN KEY ("parent_label_id") REFERENCES "labels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
