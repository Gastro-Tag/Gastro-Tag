-- Temperatura dos equipamentos (geladeira, freezer): registro separado da etiqueta, desligado por padrão.
-- Aditiva: uma coluna com padrão false em kitchen_settings e duas tabelas novas. Nada existente é alterado ou apagado.

-- AlterTable
ALTER TABLE "kitchen_settings" ADD COLUMN     "equipment_temperature_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "equipment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storage_type" "StorageType" NOT NULL,
    "min_temperature" DECIMAL(4,1) NOT NULL,
    "max_temperature" DECIMAL(4,1) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temperature_readings" (
    "id" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "equipment_name" TEXT NOT NULL,
    "temperature" DECIMAL(4,1) NOT NULL,
    "min_temperature" DECIMAL(4,1) NOT NULL,
    "max_temperature" DECIMAL(4,1) NOT NULL,
    "out_of_range" BOOLEAN NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kitchen_date" DATE NOT NULL,
    "responsible_name" TEXT NOT NULL,
    "handler_id" TEXT,
    "user_id" TEXT NOT NULL,
    "note" TEXT,
    "request_id" TEXT,

    CONSTRAINT "temperature_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "temperature_readings_equipment_id_read_at_idx" ON "temperature_readings"("equipment_id", "read_at");

-- CreateIndex
CREATE INDEX "temperature_readings_kitchen_date_idx" ON "temperature_readings"("kitchen_date");

-- CreateIndex
CREATE UNIQUE INDEX "temperature_readings_user_id_request_id_key" ON "temperature_readings"("user_id", "request_id");

-- AddForeignKey
ALTER TABLE "temperature_readings" ADD CONSTRAINT "temperature_readings_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temperature_readings" ADD CONSTRAINT "temperature_readings_handler_id_fkey" FOREIGN KEY ("handler_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temperature_readings" ADD CONSTRAINT "temperature_readings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

