-- Plano B: registro de contingência (embalagem aberta com etiqueta de papel sem rede) e queda de conexão
-- avisada pelo aparelho. Só cria duas tabelas e um enum: nada existente é alterado ou apagado.

-- CreateEnum
CREATE TYPE "ContingencyOutcome" AS ENUM ('EM_USO', 'USADO', 'DESCARTADO');

-- CreateTable
CREATE TABLE "contingency_records" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "product_brand" TEXT NOT NULL,
    "lot" TEXT NOT NULL,
    "original_expiry_date" DATE NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL,
    "opened_date" DATE NOT NULL,
    "storage_type" "StorageType" NOT NULL,
    "shelf_life_days" INTEGER NOT NULL,
    "rule_id" TEXT,
    "rule_version" INTEGER,
    "rule_source" TEXT,
    "discard_at" DATE NOT NULL,
    "capped_by_original_expiry" BOOLEAN NOT NULL,
    "responsible_name" TEXT NOT NULL,
    "paper_ref" TEXT,
    "note" TEXT,
    "outcome" "ContingencyOutcome" NOT NULL,
    "discard_reason" "DiscardReason",
    "closed_at" TIMESTAMP(3),
    "closed_by_name" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outage_id" TEXT,

    CONSTRAINT "contingency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connectivity_outages" (
    "id" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reported_by_id" TEXT NOT NULL,
    "reported_by_name" TEXT NOT NULL,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_name" TEXT,

    CONSTRAINT "connectivity_outages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contingency_records_created_at_idx" ON "contingency_records"("created_at");

-- CreateIndex
CREATE INDEX "contingency_records_outcome_idx" ON "contingency_records"("outcome");

-- CreateIndex
CREATE INDEX "contingency_records_product_id_idx" ON "contingency_records"("product_id");

-- CreateIndex
CREATE INDEX "connectivity_outages_reviewed_at_idx" ON "connectivity_outages"("reviewed_at");

-- AddForeignKey
ALTER TABLE "contingency_records" ADD CONSTRAINT "contingency_records_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contingency_records" ADD CONSTRAINT "contingency_records_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "shelf_life_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contingency_records" ADD CONSTRAINT "contingency_records_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contingency_records" ADD CONSTRAINT "contingency_records_outage_id_fkey" FOREIGN KEY ("outage_id") REFERENCES "connectivity_outages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connectivity_outages" ADD CONSTRAINT "connectivity_outages_reported_by_id_fkey" FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

