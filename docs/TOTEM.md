# Modo Totem — etiqueta em 2 toques

Rota: `http://<servidor>/totem` (mesmo frontend e mesma API do painel). A tela se adapta a celular (retrato e paisagem), tablet e telas grandes.

## Fluxo

| Toque | Tela | O que acontece |
|---|---|---|
| 1 | Início | Toca no produto (mais usados primeiro; busca e categorias disponíveis) |
| 2 | Etiqueta | Confere a embalagem e a data de descarte (calculada pelo servidor), **confirma a temperatura no teclado numérico** e toca **IMPRIMIR ETIQUETA** |
| — | Pronto | Confirmação + Reimprimir / Concluir; volta sozinho ao início em 10 s |

Como a temperatura precisa ser confirmada a cada etiqueta, o fluxo ganhou passos além dos 2 toques: o operador digita ou aceita a temperatura sugerida pelo teclado antes de imprimir. Os 2 toques de escolha valem para produto com um único lote em uso. Se houver mais de um lote, nada vem marcado: o operador toca no lote da embalagem em mãos. Sem lote, ou com outra embalagem, toca em **Outra embalagem** e digita a validade impressa.

Se precisar trocar o armazenamento (refrigerado/congelado), é 1 toque a mais. Cada cartão já mostra a data de descarte daquele armazenamento.

## O que vem preenchido

| Campo | Origem |
|---|---|
| Data de abertura | Hoje |
| Armazenamento | Último usado para o produto neste totem; senão o primeiro disponível |
| Temperatura | Só **sugerida** (4 °C refrigerado / -18 °C congelado), não vem como valor; não conta como medição e precisa ser confirmada no teclado numérico antes de imprimir |
| Lote | O lote cadastrado escolhido. Em outra embalagem, o teclado pede o lote impresso; se não estiver legível, registra `NÃO INFORMADO` |
| Responsável | Escolhido uma vez por turno (expira em 10 h); nomes recentes em um toque |

As memórias ficam no `localStorage` do navegador do totem. A **data de abertura, o prazo, o teto pela validade da embalagem e a data de descarte vêm do backend** (`POST /api/labels/preview` e `POST /api/labels`). O relógio do aparelho não define a data da etiqueta.

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
- Etiqueta criada com falha de impressão fica salva; a tela oferece "Tentar imprimir".

## Instalação do totem

1. No painel, em **Usuários**, crie uma conta OPERATOR só para o totem. Abra `http://<servidor>/totem` e faça o login **uma vez** com essa conta (não use uma conta ADMIN: ela daria poderes de gestão a quem está na bancada). A sessão se renova sozinha enquanto o totem for usado pelo menos 1 vez a cada 7 dias. Redefinir a senha, desativar a conta ou mudar o perfil dela desconecta o totem na hora, e ele volta para a tela de login.
2. Defina a impressora de etiquetas como **padrão** do sistema e ajuste o tamanho do papel no driver. O totem imprime com o modelo de etiqueta salvo no aparelho (`localStorage`, chave `gastrotag_label_template`): escolha-o antes, no painel, na tela de gerar etiqueta, neste mesmo navegador. Modelos: folha A4 / comum (9 cm) e térmica 100×60 mm (todas as informações), térmica 60×40 mm (resumida) e 50×30 mm (mínima), que omitem informações; a descrição de cada um aparece na tela de gerar etiqueta. Na térmica o `@page` define o tamanho; o papel do driver deve ser do mesmo tamanho.
3. Abra o navegador em modo quiosque com impressão direta (sem diálogo), exemplo no Windows:

```
chrome.exe --kiosk --kiosk-printing --disable-pinch --overscroll-history-navigation=0 http://<servidor>/totem
```

Sem `--kiosk-printing` o Chrome mostra o diálogo de impressão e exige um toque extra.

**Saída do totem:** segure o logo por ~1,5 s e confirme com e-mail e senha de um administrador para abrir o menu (painel ou encerrar sessão). O menu fecha sozinho após 60 s sem toque. O painel continua na sessão do totem: para gerenciar produtos e usuários, encerre a sessão e entre com a conta de administrador.

## Limitações conhecidas

- O responsável é um **nome digitado**, não uma conta: não há PIN por operador. Recomendado para o MVP (usuários + PIN).
- A temperatura da etiqueta é a informada e confirmada pelo operador, não uma leitura de sensor.
- A data de abertura é sempre a do dia; para outra data, use o painel administrativo.
- O login do totem e a confirmação do administrador usam o teclado do sistema operacional; os campos de senha têm botão de olho e "Esqueci minha senha" (sem e-mail: a redefinição é feita por um administrador em Usuários → Senha).
- Impressão pelo navegador; integração direta com impressora térmica continua fora do escopo do TCC. O modelo térmico ainda não foi testado em impressora física.
- A etiqueta com "Quantidade" > 1 imprime cópias do mesmo registro (mesmo código), não registros separados.
