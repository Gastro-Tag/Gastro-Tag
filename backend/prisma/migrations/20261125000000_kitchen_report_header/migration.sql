-- Cabeçalho do relatório do período: nome da cozinha e responsável técnico. Só acrescenta duas colunas
-- opcionais: nada existente é alterado ou apagado. Nulo (padrão): não informado.
-- O tamanho (1..80 caracteres) é validado na API.

-- AlterTable
ALTER TABLE "kitchen_settings" ADD COLUMN "kitchen_name" TEXT,
ADD COLUMN "technical_responsible" TEXT;
