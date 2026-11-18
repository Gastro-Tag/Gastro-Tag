-- Limite configurável do aviso de validade digitada muito distante. Só acrescenta uma coluna opcional:
-- nada existente é alterado ou apagado. Nulo (padrão): aviso por limite desligado.

-- AlterTable
ALTER TABLE "kitchen_settings" ADD COLUMN "expiry_warning_months" INTEGER;
