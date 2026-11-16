-- Operador com PIN no totem (opcional) e etiqueta ligada ao operador confirmado.
-- Só adiciona colunas anuláveis: usuários existentes ficam sem PIN e etiquetas existentes sem operador confirmado.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pin_hash" TEXT;

-- AlterTable
ALTER TABLE "labels" ADD COLUMN     "handler_id" TEXT;

-- CreateIndex
CREATE INDEX "labels_handler_id_idx" ON "labels"("handler_id");

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_handler_id_fkey" FOREIGN KEY ("handler_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
