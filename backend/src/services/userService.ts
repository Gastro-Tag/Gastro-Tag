import { randomBytes } from 'node:crypto';
import { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../prisma/client';
import { Errors } from '../utils/errors';
import { AuthService } from './authService';
import { SessionService } from './sessionService';
import { OperatorService } from './operatorService';
import { releasePinLockout } from '../utils/pinLockout';

/**
 * Sem coluna própria: o usuário com dados pessoais removidos é reconhecido pelo e-mail neste domínio
 * (`.invalid` é reservado e nunca entrega mensagem). Cadastro e edição recusam e-mails nele.
 */
export const PSEUDONYM_EMAIL_DOMAIN = '@removido.invalid';

export function isPseudonymized(email: string): boolean {
  return email.trim().toLowerCase().endsWith(PSEUDONYM_EMAIL_DOMAIN);
}

const notPseudonymized = { NOT: { email: { endsWith: PSEUDONYM_EMAIL_DOMAIN } } } as const;
const lockedMessage = 'Dados pessoais removidos: o usuário não pode ser alterado.';
const alreadyRemovedMessage = 'Os dados pessoais deste usuário já foram removidos.';
const wrongNameMessage = 'Digite o nome exatamente como está para confirmar.';

const publicFields = {
  id: true, name: true, email: true, role: true, active: true, createdAt: true, pinHash: true,
} as const;

/** O hash do PIN nunca sai da API: a resposta diz só se o usuário tem PIN. */
function toPublic<T extends { pinHash: string | null; email: string }>({ pinHash, ...user }: T) {
  return { ...user, hasPin: pinHash !== null, pseudonymized: isPseudonymized(user.email) };
}

async function ensureEmailAvailable(email: string, exceptId?: string): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing && existing.id !== exceptId) throw Errors.conflict('Já existe um usuário com este e-mail.');
}

/** Usuário existe e ainda tem os dados pessoais: só então pode ser alterado. */
async function findEditable(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, email: true } });
  if (!user) throw Errors.notFound('Usuário');
  if (isPseudonymized(user.email)) throw Errors.conflict(lockedMessage);
  return user;
}

const EXPORT_LIST_LIMIT = 5000;
const labelItem = { shortCode: true, productName: true, createdAt: true, openedAt: true } as const;

async function labelList(where: Prisma.LabelWhereInput) {
  const [items, total] = await Promise.all([
    prisma.label.findMany({ where, select: labelItem, orderBy: { createdAt: 'desc' }, take: EXPORT_LIST_LIMIT }),
    prisma.label.count({ where }),
  ]);
  return { items, total, truncated: total > items.length };
}

const EXPORT_NOTICE = [
  'Este arquivo reúne os dados do usuário guardados no banco do GastroTag: cadastro, sessões de acesso,',
  'etiquetas ligadas à conta, regras cadastradas e alterações nas configurações da cozinha.',
  'Os logs de acesso (método, caminho, IP e tempo da requisição, sem identificar o usuário) ficam nos logs do Docker,',
  'com rotação de cerca de 30 MB por serviço, e não entram neste arquivo.',
  'Os nomes copiados nas etiquetas (responsável e quem encerrou) são registros de rastreabilidade dos alimentos.',
  '"typedNameMatches" lista etiquetas sem ligação com a conta em que o nome digitado é igual ao nome do usuário',
  'e pode incluir outra pessoa com o mesmo nome. Cada lista traz no máximo 5000 etiquetas ("truncated" indica corte).',
].join(' ');

export const UserService = {
  async list() {
    const users = await prisma.user.findMany({ select: publicFields, orderBy: { name: 'asc' } });
    return users.map(toPublic);
  },

  async create(data: { name: string; email: string; password: string; role: UserRole }) {
    await ensureEmailAvailable(data.email);
    return toPublic(await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        role: data.role,
        passwordHash: await AuthService.hashPassword(data.password),
      },
      select: publicFields,
    }));
  },

  async update(
    id: string,
    actorId: string,
    data: Partial<{ name: string; email: string; role: UserRole; active: boolean }>,
  ) {
    // Quem edita é um ADMIN ativo: travar a própria conta garante que sempre reste um administrador.
    if (id === actorId && (data.active === false || data.role === 'OPERATOR')) {
      throw Errors.validation('Você não pode desativar nem rebaixar a própria conta.');
    }
    const user = await findEditable(id);
    if (data.email) await ensureEmailAvailable(data.email, id);
    // A condição no where cobre uma remoção de dados concluída entre a leitura e a gravação.
    const updated = await prisma.user.update({ where: { id, ...notPseudonymized }, data, select: publicFields })
      .catch((err: { code?: string }) => {
        if (err.code === 'P2025') throw Errors.conflict(lockedMessage);
        throw err;
      });
    // Desativar ou trocar o perfil derruba as sessões abertas: quem volta entra com o acesso novo.
    if (data.active === false || (data.role && data.role !== user.role)) await SessionService.revokeAll(id);
    return toPublic(updated);
  },

  /** Define (4 a 6 dígitos) ou remove (null) o PIN do operador no totem. */
  async setPin(id: string, pin: string | null) {
    await findEditable(id);
    await OperatorService.setPin(id, pin);
    // PIN novo (o "esqueci o PIN") também solta um bloqueio por erros.
    releasePinLockout(id);
    return toPublic(await prisma.user.findUniqueOrThrow({ where: { id }, select: publicFields }));
  },

  /** Libera novas tentativas de PIN do operador em todos os aparelhos, sem trocar o PIN. */
  async unlockPin(id: string) {
    const user = await prisma.user.findUnique({ where: { id }, select: publicFields });
    if (!user) throw Errors.notFound('Usuário');
    releasePinLockout(id);
    return toPublic(user);
  },

  async resetPassword(id: string, password: string) {
    await findEditable(id);
    const { count } = await prisma.user.updateMany({
      where: { id, ...notPseudonymized },
      data: { passwordHash: await AuthService.hashPassword(password) },
    });
    if (count === 0) throw Errors.conflict(lockedMessage);
    await SessionService.revokeAll(id);
  },

  /** Arquivo com os dados do titular. Hashes de senha, PIN e token nunca entram. */
  async exportData(id: string) {
    const user = await prisma.user.findUnique({ where: { id }, select: { ...publicFields, updatedAt: true } });
    if (!user) throw Errors.notFound('Usuário');
    const pseudonymized = isPseudonymized(user.email);
    const name = user.name.trim();

    const [sessions, created, confirmedAsOperator, closed, typedNameMatches, rules, settingsEdits] = await Promise.all([
      prisma.userSession.findMany({
        where: { userId: id },
        select: { createdAt: true, expiresAt: true, revokedAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      labelList({ userId: id }),
      labelList({ handlerId: id }),
      labelList({ closedById: id }),
      // Depois da remoção o nome é "Usuário removido ...": comparar não diria nada sobre a pessoa.
      pseudonymized || !name
        ? Promise.resolve({ items: [], total: 0, truncated: false })
        : labelList({
          AND: [
            { userId: { not: id } },
            { OR: [{ handlerId: null }, { handlerId: { not: id } }] },
            { OR: [{ closedById: null }, { closedById: { not: id } }] },
            {
              OR: [
                { responsibleName: { equals: name, mode: 'insensitive' } },
                { closedByName: { equals: name, mode: 'insensitive' } },
              ],
            },
          ],
        }),
      prisma.shelfLifeRule.findMany({
        where: { createdById: id },
        select: { id: true, productId: true, category: true, storageType: true, version: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.kitchenSettings.findMany({ where: { updatedById: id }, select: { updatedAt: true } }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      notice: EXPORT_NOTICE,
      user: toPublic(user),
      sessions,
      labels: { created, confirmedAsOperator, closed, typedNameMatches },
      rules,
      settingsEdits,
    };
  },

  /**
   * Remove os dados pessoais da conta sem apagar a linha: etiquetas, regras e configurações continuam
   * apontando para ela (FKs Restrict), então o histórico não perde a ligação.
   */
  async pseudonymize(id: string, actorId: string, confirmName: string) {
    const current = await prisma.user.findUnique({ where: { id }, select: { name: true } });
    if (!current) throw Errors.notFound('Usuário');
    if (confirmName.trim() !== current.name.trim()) throw Errors.validation(wrongNameMessage);
    if (id === actorId) throw Errors.conflict('Você não pode remover os dados da própria conta.');

    // Senha aleatória que ninguém conhece: a conta não volta a entrar nem com a senha antiga.
    const passwordHash = await AuthService.hashPassword(randomBytes(32).toString('hex'));

    const updated = await prisma.$transaction(async (tx) => {
      // Trava o alvo e os ADMIN ativos numa só consulta, em ordem fixa: dois administradores removendo
      // um ao outro ao mesmo tempo não deixam a cozinha sem nenhum ADMIN ativo.
      const locked = await tx.$queryRaw<{ id: string; name: string; email: string; role: UserRole; active: boolean }[]>`
        SELECT id, name, email, role::text AS role, active FROM users
        WHERE id = ${id} OR (role = 'ADMIN' AND active = true)
        ORDER BY id
        FOR UPDATE`;
      const target = locked.find((row) => row.id === id);
      if (!target) throw Errors.notFound('Usuário');
      if (isPseudonymized(target.email)) throw Errors.conflict(alreadyRemovedMessage);
      if (confirmName.trim() !== target.name.trim()) throw Errors.validation(wrongNameMessage);
      // A conta de ADMIN_EMAIL seria recriada no próximo boot com o mesmo e-mail e a senha da variável.
      const bootEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
      if (bootEmail && target.email === bootEmail) {
        throw Errors.conflict(
          'Esta é a conta do administrador inicial (ADMIN_EMAIL). Troque ADMIN_EMAIL no .env antes de remover os dados, '
          + 'senão a conta é recriada ao reiniciar.',
        );
      }
      const activeAdmins = locked.filter((row) => row.role === 'ADMIN' && row.active).length;
      if (target.role === 'ADMIN' && target.active && activeAdmins <= 1) {
        throw Errors.conflict('Este é o último administrador ativo: cadastre ou ative outro antes de remover os dados.');
      }

      // As cópias do nome em Label.responsibleName / closedByName, KitchenSettings.updatedByName e
      // ShelfLifeRule.validatedByName NÃO são alteradas: são registros de rastreabilidade, e apagá-las
      // ou não é decisão do jurídico da cozinha, ainda pendente.
      const user = await tx.user.update({
        where: { id },
        data: {
          name: `Usuário removido ${id.slice(0, 8)}`,
          email: `removido-${id}${PSEUDONYM_EMAIL_DOMAIN}`,
          passwordHash,
          pinHash: null,
          active: false,
        },
        select: publicFields,
      });
      await SessionService.revokeAll(id, undefined, tx);
      return user;
    });
    return toPublic(updated);
  },
};
