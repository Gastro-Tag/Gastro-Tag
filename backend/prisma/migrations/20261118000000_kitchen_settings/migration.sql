-- Configuração da cozinha (linha única). Só cria a tabela: nada existente é alterado ou apagado.
-- Sem linha, vale o padrão (bloqueio de etiqueta sem regra validada desligado).

-- CreateTable
CREATE TABLE "kitchen_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "require_validated_rule" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,
    "updated_by_name" TEXT,

    CONSTRAINT "kitchen_settings_pkey" PRIMARY KEY ("id"),
    -- Linha única até a Fase 2 (uma por cliente).
    CONSTRAINT "kitchen_settings_single_row" CHECK ("id" = 1)
);

-- AddForeignKey
ALTER TABLE "kitchen_settings" ADD CONSTRAINT "kitchen_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
