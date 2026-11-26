# Modo Totem — etiqueta em 4 toques

Rota: `http://<servidor>/totem` (mesmo frontend e mesma API do painel). A tela se adapta a celular (retrato e paisagem), tablet e telas grandes.

## Fluxo

| Toque | Tela | O que acontece |
|---|---|---|
| 1 | Início | Toca no produto (mais usados primeiro; busca e categorias disponíveis) |
| 2 | Etiqueta | Toca em **Temperatura** (ou em CONFIRMAR TEMPERATURA, o botão grande, que abre o mesmo teclado); o teclado numérico abre já preenchido com a temperatura sugerida |
| 3 | Teclado | Confere o termômetro, ajusta o valor se preciso e toca **Confirmar temperatura** |
| 4 | Etiqueta | Confere a embalagem e a data de descarte (calculada pelo servidor) e toca **IMPRIMIR ETIQUETA** |
| (5) | Navegador | Sem `--kiosk-printing`, o diálogo de impressão do navegador pede mais um toque (ver Instalação do totem) |
| — | Pronto | Confirmação + Reimprimir / Concluir; volta sozinho ao início em 10 s |

O caso simples (4 toques, 5 contando o diálogo de impressão) vale para produto com um único lote em uso e responsável do turno já escolhido. Se houver mais de um lote, nada vem marcado: o operador toca no lote da embalagem em mãos. Cada lote mostra quanto falta para vencer ("vence em N dias", contado pela data da cozinha), e o de menor validade ganha o selo **Usar primeiro** (empate marca todos; com um lote só, ou todos com a mesma validade, não há selo; o lote provisório "Confira na embalagem" fica fora do selo e da contagem). O selo só orienta: não escolhe o lote. Sem lote, ou com outra embalagem, toca em **Outra embalagem** e digita a validade impressa. Sem responsável do turno, há mais um passo para escolhê-lo.

Se precisar trocar o armazenamento (refrigerado/congelado), é 1 toque a mais. Cada cartão já mostra a data de descarte daquele armazenamento.

## O que vem preenchido

| Campo | Origem |
|---|---|
| Data de abertura | Hoje |
| Armazenamento | Último usado para o produto neste totem; senão o primeiro disponível |
| Temperatura | O teclado abre preenchido com o valor **sugerido** (4 °C refrigerado / -18 °C congelado), mas o campo da etiqueta fica sem valor até o operador tocar em **Confirmar temperatura** (1 toque). A sugestão não conta como medição; sem confirmação não imprime |
| Lote | O lote cadastrado escolhido. Em outra embalagem, o teclado pede o lote impresso; se não estiver legível, registra `NÃO INFORMADO` |
| Responsável | Escolhido uma vez por turno (expira em 10 h): operador com PIN ou nome digitado; nomes recentes em um toque |

As memórias ficam no `localStorage` do navegador do totem. A **data de abertura, o prazo, o teto pela validade da embalagem e a data de descarte vêm do backend** (`POST /api/labels/preview` e `POST /api/labels`). O relógio do aparelho não define a data da etiqueta.

## Dividir uma etiqueta

Na tela do produto, **Dividir uma etiqueta** gera etiquetas filhas de uma etiqueta ativa (`/totem/etiqueta/<produto>/dividir`):

1. Escolha a etiqueta de origem. A lista mostra só etiquetas **ativas** e não vencidas do produto; as encerradas não aparecem.
2. Informe a quantidade, o armazenamento e **confirme a temperatura** no teclado numérico (a sugestão não é medição).
3. Confira o responsável do turno e marque **A embalagem original acabou** se for o caso: a etiqueta de origem é encerrada como usada, em nome do responsável do turno.
4. Toque em imprimir. Cada filha sai com lote e validade do fabricante da origem e a data de descarte calculada pelo servidor, **nunca posterior à da origem**; se a origem limitar a data, a tela avisa e a etiqueta diz "Data limitada pela etiqueta de origem".

Reenviar o mesmo pedido não cria filhas repetidas. Etiqueta encerrada não pode ser reimpressa.

## Operador com PIN

O administrador pode definir um PIN de 4 a 6 dígitos para uma conta em **Usuários → Definir PIN** (e remover depois). Ao escolher o responsável do turno, se houver contas com PIN, o totem mostra a lista e um teclado numérico: o operador toca no nome e digita o PIN. Também continua possível digitar só o nome, sem PIN.

- O PIN é opcional e não substitui o login do totem: ele confirma **quem** está operando. Com PIN confirmado, a etiqueta grava o operador (`handlerId`) e o histórico mostra "Operador confirmado"; com nome digitado, fica só o nome.
- A confirmação vale por 10 h (ou até o fim do turno no aparelho) e só na sessão deste totem. Trocar ou remover o PIN, desativar a conta ou encerrar a sessão do totem a invalida, e o totem pede o operador de novo.
- 5 PINs errados para o mesmo operador, neste aparelho, bloqueiam novas tentativas por 15 minutos. O administrador pode desbloquear antes em **Usuários → Desbloquear PIN** (vale para todos os aparelhos e mantém o PIN); trocar o PIN também desbloqueia.
- O token do operador fica no `localStorage` do aparelho (chave `gastrotag:totem:operator`) e é enviado ao criar etiqueta, dividir e descartar.

## Para descartar

Na tela inicial, **Para descartar** mostra a contagem de etiquetas vencidas e que vencem hoje (`/totem/descartar`, datas pela data da cozinha). Cada etiqueta é um cartão grande:

- **Vencidas:** só **Descartei**, que registra descarte por prazo vencido.
- **Vencem hoje:** **Usei** ou **Descartei** (prazo vencido).
- **Vencem amanhã:** só informativo.

Cada ação pede uma confirmação e é feita em nome do operador do turno; a lista atualiza em seguida. Outros destinos e motivos (alteração sensorial, embalagem danificada, cancelamento) ficam no histórico do painel.

## Salvaguardas

- Lote **vencido** gera alerta, não aparece como opção e o produto só vai para o fim da lista se não tiver outro lote em uso.
- Lote `SEM-LOTE`, criado na migração com a validade antiga do produto, nunca vem marcado: o operador confere a embalagem.
- Validade digitada já vencida é recusada pelo servidor.
- Se a data for limitada pela validade da embalagem, o aviso aparece na tela antes de imprimir.
- Se a regra recusar a temperatura (fora da faixa), a mensagem aparece no cartão do armazenamento.
- Produto sem regra de validade usa o prazo do cadastro e mostra o aviso "Prazo do cadastro do produto, sem regra validada".
- **Após o deploy da etapa E, recarregue os totens abertos:** o pacote antigo ainda envia `storageTemp` e recebe erro 422 do servidor.
- O botão trava durante a geração (sem etiqueta duplicada por toque duplo).
- Se a rede cair depois que o servidor gravou, tocar de novo em imprimir devolve a mesma etiqueta, sem criar outra.
- Após 60 s sem toque, volta ao início (e limpa busca/filtros).
- As últimas etiquetas do produto mostram só as ativas.
- Etiqueta criada com falha de impressão fica salva; a tela oferece "Tentar imprimir".

## Instalação do totem

1. No painel, em **Usuários**, crie uma conta OPERATOR só para o totem. Abra `http://<servidor>/totem` e faça o login **uma vez** com essa conta (não use uma conta ADMIN: ela daria poderes de gestão a quem está na bancada). A sessão se renova sozinha enquanto o totem for usado pelo menos 1 vez a cada 7 dias. Redefinir a senha, desativar a conta ou mudar o perfil dela desconecta o totem na hora, e ele volta para a tela de login.
2. Defina a impressora de etiquetas como **padrão** do sistema e ajuste o tamanho do papel no driver. O totem imprime com o modelo de etiqueta salvo no aparelho (`localStorage`, chave `gastrotag_label_template`): escolha-o neste mesmo navegador, no menu do administrador do totem (segure o logo) ou no painel, na tela de gerar etiqueta. Sem escolha a impressão sai em A4 e a tela da etiqueta avisa; o modelo ativo aparece acima do botão de imprimir. Modelos: folha A4 / comum (9 cm) e térmica 100×60 mm (todas as informações), térmica 60×40 mm (resumida) e 50×30 mm (mínima), que omitem informações; a descrição de cada um aparece na tela de gerar etiqueta. Na térmica o `@page` define o tamanho; o papel do driver deve ser do mesmo tamanho.
3. Abra o navegador em modo quiosque com impressão direta (sem diálogo), exemplo no Windows:

```
chrome.exe --kiosk --kiosk-printing --disable-pinch --overscroll-history-navigation=0 http://<servidor>/totem
```

Sem `--kiosk-printing` o Chrome mostra o diálogo de impressão e exige um toque extra.

**Saída do totem:** segure o logo por ~1,5 s e confirme com e-mail e senha de um administrador para abrir o menu (painel ou encerrar sessão). O menu fecha sozinho após 60 s sem toque. O painel continua na sessão do totem: para gerenciar produtos e usuários, encerre a sessão e entre com a conta de administrador.

## Limitações conhecidas

- O PIN é opcional: sem ele, o responsável é só um **nome digitado**, sem prova de quem operou. O PIN confirma o operador, mas não é autenticação forte (4 a 6 dígitos, com limite de tentativas).
- A temperatura da etiqueta é a informada e confirmada pelo operador, não uma leitura de sensor.
- A data de abertura é sempre a do dia; para outra data (até `MAX_BACKDATE_DAYS` dias para trás, padrão 2), use o painel.
- O login do totem e a confirmação do administrador usam o teclado do sistema operacional; os campos de senha têm botão de olho e "Esqueci minha senha" (sem e-mail: a redefinição é feita por um administrador em Usuários → Senha).
- Impressão pelo navegador; integração direta com impressora térmica continua fora do escopo do TCC. O modelo térmico ainda não foi testado em impressora física.
- A etiqueta com "Quantidade" > 1 imprime cópias do mesmo registro (mesmo código), não registros separados.
- **Temperaturas dos equipamentos (opcional):** quando um administrador liga "Registro de temperatura dos equipamentos" no painel (menu Temperaturas), a tela inicial ganha o botão "Temperaturas", ao lado de "Para descartar", com quantos equipamentos estão sem leitura hoje. Toque no equipamento, digite a temperatura medida (o teclado abre vazio; aceita sinal negativo e uma casa decimal) e confirme; o responsável é o operador do turno. Fora da faixa cadastrada aparece um aviso vermelho grande, sem bloquear. É um registro à parte da etiqueta e não é leitura de sensor.
