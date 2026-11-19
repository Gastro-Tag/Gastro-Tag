-- Modelo de etiqueta padrão da cozinha. Só acrescenta uma coluna opcional:
-- nada existente é alterado ou apagado. Nulo (padrão): modelo não definido; cada aparelho segue como hoje.
-- Sem enum no banco: os valores aceitos são validados na API.

-- AlterTable
ALTER TABLE "kitchen_settings" ADD COLUMN "label_template" TEXT;
