# Modo Totem — etiqueta em 2 toques

Rota: `http://<servidor>/totem` (mesmo frontend e mesma API do painel).

## Fluxo

| Toque | Tela | O que acontece |
|---|---|---|
| 1 | Início | Toca no produto (mais usados primeiro; busca e categorias disponíveis) |
| 2 | Etiqueta | Confere a embalagem e a data de descarte (calculada pelo servidor) e toca **IMPRIMIR ETIQUETA** |
| — | Pronto | Confirmação + Reimprimir / Concluir; volta sozinho ao início em 10 s |

Os 2 toques valem para produto com um único lote em uso. Se houver mais de um lote, nada vem marcado: o operador toca no lote da embalagem em mãos. Sem lote, ou com outra embalagem, toca em **Outra embalagem** e digita a validade impressa.

Se precisar trocar o armazenamento (refrigerado/congelado), é 1 toque a mais. Cada cartão já mostra a data de descarte daquele armazenamento.

## O que vem preenchido

| Campo | Origem |
|---|---|
| Data de abertura | Hoje |
| Armazenamento | Último usado para o produto neste totem; senão o primeiro disponível |
| Temperatura | 4 °C (refrigerado) / -18 °C (congelado); editável por teclado numérico |
| Lote | O lote cadastrado escolhido. Em outra embalagem, o teclado pede o lote impresso; se não estiver legível, registra `NÃO INFORMADO` |
| Responsável | Escolhido uma vez por turno (expira em 10 h); nomes recentes em um toque |

As memórias ficam no `localStorage` do navegador do totem. A **data de abertura, o prazo, o teto pela validade da embalagem e a data de descarte vêm do backend** (`POST /api/labels/preview` e `POST /api/labels`). O relógio do tablet não define a data da etiqueta.

## Salvaguardas

- Lote **vencido** gera alerta, não aparece como opção e o produto só vai para o fim da lista se não tiver outro lote em uso.
- Lote `SEM-LOTE`, criado na migração com a validade antiga do produto, nunca vem marcado: o operador confere a embalagem.
- Validade digitada já vencida é recusada pelo servidor.
- Se a data for limitada pela validade da embalagem, o aviso aparece na tela antes de imprimir.
- Se a regra recusar a temperatura, a mensagem aparece no cartão do armazenamento.
- O botão trava durante a geração (sem etiqueta duplicada por toque duplo).
- Se a rede cair depois que o servidor gravou, tocar de novo em imprimir devolve a mesma etiqueta, sem criar outra.
- Após 60 s sem toque, volta ao início (e limpa busca/filtros).
- Etiqueta criada com falha de impressão fica salva; a tela oferece "Tentar imprimir".

## Instalação do totem

1. No painel, em **Usuários**, crie uma conta OPERATOR só para o totem. Abra `http://<servidor>/totem` e faça o login **uma vez** com essa conta (não use uma conta ADMIN: ela daria poderes de gestão a quem está na bancada). A sessão se renova sozinha enquanto o totem for usado pelo menos 1 vez a cada 7 dias. Redefinir a senha, desativar a conta ou mudar o perfil dela desconecta o totem na hora, e ele volta para a tela de login.
2. Defina a impressora de etiquetas como **padrão** do sistema e ajuste o tamanho do papel no driver.
3. Abra o navegador em modo quiosque com impressão direta (sem diálogo), exemplo no Windows:

```
chrome.exe --kiosk --kiosk-printing --disable-pinch --overscroll-history-navigation=0 http://<servidor>/totem
```

Sem `--kiosk-printing` o Chrome mostra o diálogo de impressão e exige um toque extra.

**Saída do totem:** segure o logo por ~1,5 s e confirme com e-mail e senha de um administrador para abrir o menu (painel ou encerrar sessão). O menu fecha sozinho após 60 s sem toque. O painel continua na sessão do totem: para gerenciar produtos e usuários, encerre a sessão e entre com a conta de administrador.

## Limitações conhecidas

- O responsável é um **nome digitado**, não uma conta: não há PIN por operador. Recomendado para o MVP (usuários + PIN).
- A temperatura da etiqueta é a de armazenamento padrão/informada, não uma leitura de sensor.
- A data de abertura é sempre a do dia; para outra data, use o painel administrativo.
- O login do totem e a confirmação do administrador usam o teclado do sistema operacional.
- Impressão pelo navegador; integração direta com impressora térmica continua fora do escopo do TCC.
- A etiqueta com "Quantidade" > 1 imprime cópias do mesmo registro (mesmo código), não registros separados.
