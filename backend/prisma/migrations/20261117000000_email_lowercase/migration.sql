-- E-mail sem diferenciar maiúsculas: a API passa a guardar e buscar em minúsculas.
-- Converte os e-mails existentes. Se duas contas só diferem pela caixa, para sem alterar nada:
-- resolva manualmente (troque o e-mail de uma delas) e aplique de novo. Nada é apagado.

DO $$
DECLARE
  duplicates text;
BEGIN
  SELECT string_agg(normalized, ', ' ORDER BY normalized) INTO duplicates
  FROM (
    SELECT lower(btrim(email)) AS normalized
    FROM users
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ) AS conflicting;

  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'Migração 20261117000000_email_lowercase interrompida: há contas cujo e-mail só difere por maiúsculas/minúsculas (%). Nenhum dado foi alterado. Troque o e-mail de uma das contas, rode "npx prisma migrate resolve --rolled-back 20261117000000_email_lowercase" e aplique as migrações de novo.', duplicates;
  END IF;
END $$;

UPDATE users
SET email = lower(btrim(email))
WHERE email <> lower(btrim(email));
