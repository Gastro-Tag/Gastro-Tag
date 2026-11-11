-- A validade do fabricante passa do produto para o lote.
CREATE TABLE "product_lots" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiry_date" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_lots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_lots_product_id_active_expiry_date_idx" ON "product_lots"("product_id", "active", "expiry_date");

ALTER TABLE "product_lots" ADD CONSTRAINT "product_lots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserva a validade já cadastrada antes de remover a coluna. O código real não existe: fica para o administrador corrigir.
INSERT INTO "product_lots" ("id", "product_id", "code", "expiry_date", "updated_at")
SELECT gen_random_uuid()::text, "id", 'SEM-LOTE', "original_expiry_date", CURRENT_TIMESTAMP
FROM "products";

-- Etiquetas antigas continuam com o texto do lote e a própria cópia da validade.
ALTER TABLE "labels" ADD COLUMN "lot_id" TEXT;

CREATE INDEX "labels_lot_id_idx" ON "labels"("lot_id");

ALTER TABLE "labels" ADD CONSTRAINT "labels_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "product_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX "products_original_expiry_date_idx";

ALTER TABLE "products" DROP COLUMN "original_expiry_date";
