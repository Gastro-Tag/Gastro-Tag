-- Medição do tempo de cada etiqueta e da origem da temperatura (itens 13, 14 e O4). Só acrescenta um
-- tipo e duas colunas opcionais: nada existente é alterado ou apagado. Etiquetas antigas ficam nulas.

-- CreateEnum
CREATE TYPE "TemperatureSource" AS ENUM ('SUGERIDO', 'DIGITADO');

-- AlterTable
ALTER TABLE "labels" ADD COLUMN "flow_ms" INTEGER,
ADD COLUMN "temperature_source" "TemperatureSource";
