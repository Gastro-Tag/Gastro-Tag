-- Regras de validade versionadas (fonte tipada, responsável pela validação) e temperatura numérica na etiqueta.

-- CreateEnum
CREATE TYPE "RuleSourceType" AS ENUM ('NORMA_LEGAL', 'REFERENCIA_TECNICA', 'FABRICANTE', 'PROCEDIMENTO_INTERNO');

-- Regras já existentes não têm o tipo da fonte: ficam como referência técnica, sem responsável pela validação.
-- O default só serve para estas linhas; regras novas precisam informar o tipo.
ALTER TABLE "shelf_life_rules" ADD COLUMN     "created_by_id" TEXT,
ADD COLUMN     "deactivated_at" TIMESTAMP(3),
ADD COLUMN     "previous_version_id" TEXT,
ADD COLUMN     "source_type" "RuleSourceType" NOT NULL DEFAULT 'REFERENCIA_TECNICA',
ADD COLUMN     "validated_at" DATE,
ADD COLUMN     "validated_by_name" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "shelf_life_rules" ALTER COLUMN "source_type" DROP DEFAULT;

-- Regra já desativada: a data mais próxima conhecida é a da última alteração.
UPDATE "shelf_life_rules" SET "deactivated_at" = "updated_at" WHERE "active" = false;

-- CreateIndex
CREATE UNIQUE INDEX "shelf_life_rules_previous_version_id_key" ON "shelf_life_rules"("previous_version_id");

-- AddForeignKey
ALTER TABLE "shelf_life_rules" ADD CONSTRAINT "shelf_life_rules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelf_life_rules" ADD CONSTRAINT "shelf_life_rules_previous_version_id_fkey" FOREIGN KEY ("previous_version_id") REFERENCES "shelf_life_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "labels" ADD COLUMN     "rule_source" TEXT,
ADD COLUMN     "rule_version" INTEGER,
ADD COLUMN     "storage_temperature" DECIMAL(4,1);

-- Temperatura numérica só quando o texto antigo for um número simples ("4", "-18,5", "4 °C", "4ºC", "4 °c").
-- O texto original (storage_temp) não muda.
UPDATE "labels" AS l
SET "storage_temperature" = parsed."value"
FROM (
  SELECT "id",
    CASE WHEN "storage_temp" ~ '^\s*-?\d+([.,]\d+)?\s*([°º]\s*[Cc])?\s*$'
      THEN ROUND(REPLACE(SUBSTRING("storage_temp" FROM '-?\d+(?:[.,]\d+)?'), ',', '.')::numeric, 1)
    END AS "value"
  FROM "labels"
) AS parsed
WHERE parsed."id" = l."id"
  AND parsed."value" IS NOT NULL
  AND ABS(parsed."value") < 1000;

-- Antes das versões, cada regra tinha uma única versão: a etiqueta guarda a fonte que valia.
UPDATE "labels" AS l
SET "rule_version" = r."version",
    "rule_source" = r."source"
FROM "shelf_life_rules" AS r
WHERE r."id" = l."rule_id";

-- Regra usada por etiqueta não pode ser apagada, só desativada.
ALTER TABLE "labels" DROP CONSTRAINT "labels_rule_id_fkey";

ALTER TABLE "labels" ADD CONSTRAINT "labels_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "shelf_life_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
