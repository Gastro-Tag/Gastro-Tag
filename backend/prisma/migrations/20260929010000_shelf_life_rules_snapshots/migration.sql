-- Shelf life rules and immutable label snapshots.
CREATE TABLE "shelf_life_rules" (
  "id" TEXT NOT NULL,
  "product_id" TEXT,
  "category" TEXT,
  "storage_type" "StorageType" NOT NULL,
  "shelf_life_days" INTEGER NOT NULL,
  "min_temperature" DECIMAL(5,2),
  "max_temperature" DECIMAL(5,2),
  "source" TEXT NOT NULL,
  "observation" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shelf_life_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shelf_life_rules_positive_days_check" CHECK ("shelf_life_days" > 0),
  CONSTRAINT "shelf_life_rules_scope_check" CHECK (("product_id" IS NOT NULL) <> ("category" IS NOT NULL))
);
CREATE INDEX "shelf_life_rules_product_id_storage_type_active_idx" ON "shelf_life_rules"("product_id", "storage_type", "active");
CREATE INDEX "shelf_life_rules_category_storage_type_active_idx" ON "shelf_life_rules"("category", "storage_type", "active");
ALTER TABLE "shelf_life_rules" ADD CONSTRAINT "shelf_life_rules_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "labels" ADD COLUMN "rule_id" TEXT;
ALTER TABLE "labels" ADD COLUMN "shelf_life_days" INTEGER;
ALTER TABLE "labels" ADD COLUMN "original_expiry_date" DATE;
ALTER TABLE "labels" ADD COLUMN "capped_by_original_expiry" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "labels" ADD COLUMN "product_name" TEXT;
ALTER TABLE "labels" ADD COLUMN "product_brand" TEXT;
UPDATE "labels" AS l
SET "shelf_life_days" = GREATEST((l."discard_at" - l."opened_at"), 1),
    "original_expiry_date" = p."original_expiry_date",
    "product_name" = p."name",
    "product_brand" = p."brand"
FROM "products" AS p
WHERE p."id" = l."product_id";
ALTER TABLE "labels" ALTER COLUMN "shelf_life_days" SET NOT NULL;
ALTER TABLE "labels" ALTER COLUMN "original_expiry_date" SET NOT NULL;
ALTER TABLE "labels" ALTER COLUMN "product_name" SET NOT NULL;
ALTER TABLE "labels" ALTER COLUMN "product_brand" SET NOT NULL;
CREATE INDEX "labels_rule_id_idx" ON "labels"("rule_id");
ALTER TABLE "labels" ADD CONSTRAINT "labels_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "shelf_life_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
