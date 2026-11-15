import { Prisma, RuleSourceType, ShelfLifeRule, StorageType } from '@prisma/client';
import { prisma } from '../prisma/client';
import { Errors } from '../utils/errors';
import { kitchenToday } from '../utils/dateUtils';
import { parseDateOnly } from '../domain/shelfLife';

/** Conteúdo de uma versão. Alvo (produto ou categoria) e armazenamento não mudam entre versões. */
export interface RuleVersionInput {
  shelfLifeDays: number;
  minTemperature?: number | null;
  maxTemperature?: number | null;
  sourceType: RuleSourceType;
  source: string;
  observation?: string | null;
  validatedByName: string;
  validatedAt: string;
}

export interface RuleCreateInput extends RuleVersionInput {
  productId?: string;
  category?: string;
  storageType: StorageType;
}

export interface RuleFilters {
  productId?: string;
  category?: string;
  storageType?: StorageType;
  includeInactive?: boolean;
  page?: number;
  limit?: number;
}

const ruleInclude = {
  product: { select: { id: true, name: true, brand: true } },
  createdBy: { select: { name: true } },
} as const;

type RuleWithRelations = ShelfLifeRule & {
  product?: { id: string; name: string; brand: string } | null;
  createdBy?: { name: string } | null;
};

const decimalToNumber = (value: Prisma.Decimal | null) => (value === null ? null : Number(value));
const dateOnly = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

/** Formato da API: temperaturas como número e data de validação como YYYY-MM-DD. */
export function serializeRule(rule: RuleWithRelations) {
  return {
    id: rule.id,
    productId: rule.productId,
    category: rule.category,
    storageType: rule.storageType,
    shelfLifeDays: rule.shelfLifeDays,
    minTemperature: decimalToNumber(rule.minTemperature),
    maxTemperature: decimalToNumber(rule.maxTemperature),
    sourceType: rule.sourceType,
    source: rule.source,
    observation: rule.observation,
    validatedByName: rule.validatedByName,
    validatedAt: dateOnly(rule.validatedAt),
    version: rule.version,
    previousVersionId: rule.previousVersionId,
    active: rule.active,
    deactivatedAt: rule.deactivatedAt,
    createdAt: rule.createdAt,
    product: rule.product ?? null,
    createdBy: rule.createdBy ?? null,
  };
}

function versionData(data: RuleVersionInput) {
  const validatedAt = parseDateOnly(data.validatedAt, 'Data da validação');
  if (validatedAt.getTime() > kitchenToday().getTime()) {
    throw Errors.validation('A data da validação não pode ser futura.');
  }
  return {
    shelfLifeDays: data.shelfLifeDays,
    minTemperature: data.minTemperature ?? null,
    maxTemperature: data.maxTemperature ?? null,
    sourceType: data.sourceType,
    source: data.source,
    observation: data.observation ?? null,
    validatedByName: data.validatedByName,
    validatedAt,
  };
}

/**
 * Serializa as escritas do mesmo alvo + armazenamento até o fim da transação. Junto com a checagem
 * dentro dela, impede duas regras ativas para o mesmo alvo em envios simultâneos.
 */
async function lockTarget(
  tx: Prisma.TransactionClient,
  target: { productId: string | null; category: string | null; storageType: StorageType },
) {
  const key = `shelf-life-rule:${target.productId ? `p:${target.productId}` : `c:${target.category}`}:${target.storageType}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/** Compara categorias sem diferenciar maiúsculas, acentos e espaços nas pontas. */
const normalizeCategory = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * Devolve o texto da categoria como está nos produtos ativos ("laticínios" → "Laticínios"),
 * para a busca exata do preview, o 409 e o lock usarem o mesmo valor.
 */
async function canonicalCategory(category: string) {
  const wanted = normalizeCategory(category);
  const rows = await prisma.product.groupBy({
    by: ['category'], where: { active: true, category: { not: null } }, _count: { _all: true },
  });
  // Grafias diferentes da mesma categoria: vale a mais usada.
  const match = rows
    .filter((row) => row.category !== null && normalizeCategory(row.category) === wanted)
    .sort((a, b) => b._count._all - a._count._all || a.category!.localeCompare(b.category!))[0];
  if (!match?.category) throw Errors.validation('Categoria não encontrada entre os produtos ativos.');
  return match.category;
}

const activeConflict = () =>
  Errors.conflict('Já existe uma regra ativa para este alvo. Crie uma nova versão dela.');

async function findRule(id: string) {
  const rule = await prisma.shelfLifeRule.findUnique({ where: { id } });
  if (!rule) throw Errors.notFound('Regra');
  return rule;
}

export const RuleService = {
  async list(filters: RuleFilters) {
    const { productId, category, storageType, includeInactive = false, page = 1 } = filters;
    const limit = Math.min(filters.limit ?? 20, 100);
    const where: Prisma.ShelfLifeRuleWhereInput = {
      ...(!includeInactive && { active: true }),
      ...(productId && { productId }),
      ...(category && { category: { equals: category, mode: 'insensitive' } }),
      ...(storageType && { storageType }),
    };
    const [total, items] = await Promise.all([
      prisma.shelfLifeRule.count({ where }),
      prisma.shelfLifeRule.findMany({
        where, skip: (page - 1) * limit, take: limit, include: ruleInclude,
        orderBy: [
          { product: { name: 'asc' } }, { category: 'asc' }, { storageType: 'asc' },
          { version: 'desc' }, { createdAt: 'desc' },
        ],
      }),
    ]);
    return {
      data: items.map(serializeRule),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  },

  /** Todas as versões da cadeia da regra, da mais nova para a mais antiga. */
  async versions(id: string) {
    let newest = await findRule(id);
    for (;;) {
      const next = await prisma.shelfLifeRule.findUnique({ where: { previousVersionId: newest.id } });
      if (!next) break;
      newest = next;
    }
    const chain: RuleWithRelations[] = [];
    let currentId: string | null = newest.id;
    while (currentId) {
      const rule: RuleWithRelations | null = await prisma.shelfLifeRule.findUnique({
        where: { id: currentId }, include: ruleInclude,
      });
      if (!rule) break;
      chain.push(rule);
      currentId = rule.previousVersionId;
    }
    return chain.map(serializeRule);
  },

  async create(data: RuleCreateInput, adminId: string) {
    const productId = data.productId ?? null;
    const category = productId || !data.category ? null : await canonicalCategory(data.category);
    if (productId) {
      const product = await prisma.product.findUnique({ where: { id: productId, active: true } });
      if (!product) throw Errors.notFound('Produto');
    }
    const content = versionData(data);

    const rule = await prisma.$transaction(async (tx) => {
      await lockTarget(tx, { productId, category, storageType: data.storageType });
      const existing = await tx.shelfLifeRule.findFirst({
        where: { active: true, storageType: data.storageType, ...(productId ? { productId } : { productId: null, category }) },
        select: { id: true },
      });
      if (existing) throw activeConflict();
      return tx.shelfLifeRule.create({
        data: { ...content, productId, category, storageType: data.storageType, createdById: adminId },
        include: ruleInclude,
      });
    });
    return serializeRule(rule);
  },

  /** Editar cria a próxima versão e desativa a atual; etiquetas antigas continuam na versão que usaram. */
  async createVersion(id: string, data: RuleVersionInput, adminId: string) {
    const current = await findRule(id);
    if (!current.active) throw Errors.conflict('Esta versão da regra está desativada. Só a versão ativa pode ser editada.');
    const content = versionData(data);

    const rule = await prisma.$transaction(async (tx) => {
      await lockTarget(tx, current);
      const now = new Date();
      // Só desativa se ainda estiver ativa: dois envios simultâneos não geram duas versões.
      const closed = await tx.shelfLifeRule.updateMany({
        where: { id, active: true }, data: { active: false, deactivatedAt: now },
      });
      if (closed.count !== 1) {
        throw Errors.conflict('Esta versão da regra está desativada. Só a versão ativa pode ser editada.');
      }
      return tx.shelfLifeRule.create({
        data: {
          ...content,
          productId: current.productId, category: current.category, storageType: current.storageType,
          version: current.version + 1, previousVersionId: current.id, createdById: adminId,
        },
        include: ruleInclude,
      });
    });
    return serializeRule(rule);
  },

  /** Desativa sem apagar: etiquetas continuam apontando para esta versão. */
  async deactivate(id: string) {
    await findRule(id);
    // Já desativada: mantém a data original da desativação.
    await prisma.shelfLifeRule.updateMany({ where: { id, active: true }, data: { active: false, deactivatedAt: new Date() } });
    const updated = await prisma.shelfLifeRule.findUniqueOrThrow({ where: { id }, include: ruleInclude });
    return serializeRule(updated);
  },
};
