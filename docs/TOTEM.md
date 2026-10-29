# Modo Totem — etiqueta em 2 toques

Rota: `http://<servidor>/totem` (mesmo frontend, mesma API, nenhum campo novo no banco).

## Fluxo

| Toque | Tela | O que acontece |
|---|---|---|
| 1 | Início | Toca no produto (mais usados primeiro; busca e categorias disponíveis) |
| 2 | Etiqueta | Confere a data de descarte (já calculada pelo servidor) e toca **IMPRIMIR ETIQUETA** |
| — | Pronto | Confirmação + Reimprimir / Concluir; volta sozinho ao início em 10 s |

Se precisar trocar o armazenamento (refrigerado/congelado), é 1 toque a mais. Cada cartão já mostra a data de descarte daquele armazenamento.

## O que vem preenchido

| Campo | Origem |
|---|---|
| Data de abertura | Hoje |
| Armazenamento | Último usado para o produto neste totem; senão o primeiro disponível |
| Temperatura | 4 °C (refrigerado) / -18 °C (congelado); editável por teclado numérico |
| Lote | Último lote usado para o produto neste totem; senão `L` + data (ex.: `L20261023`); editável |
| Responsável | Escolhido uma vez por turno (expira em 10 h); nomes recentes em um toque |

As memórias ficam no `localStorage` do navegador do totem. A **regra sanitária, o teto pela validade do fabricante e a data de descarte continuam sendo calculados no backend** (`POST /api/labels/preview` e `POST /api/labels`).

## Salvaguardas

- Produto **vencido** aparece em vermelho, no fim da lista, e não gera etiqueta.
- Se a data for limitada pela validade do fabricante, o aviso aparece na tela antes de imprimir.
- Se a regra recusar a temperatura, a mensagem aparece no cartão do armazenamento.
- O botão trava durante a geração (sem etiqueta duplicada por toque duplo).
- Após 60 s sem toque, volta ao início (e limpa busca/filtros).
- Etiqueta criada com falha de impressão fica salva; a tela oferece "Tentar imprimir".

## Instalação do totem

1. Abra `http://<servidor>/totem` e faça o login **uma vez** (conta ADMIN ou OPERATOR). A sessão se renova sozinha enquanto o totem for usado pelo menos 1 vez a cada 7 dias.
2. Defina a impressora de etiquetas como **padrão** do sistema e ajuste o tamanho do papel no driver.
3. Abra o navegador em modo quiosque com impressão direta (sem diálogo), exemplo no Windows:

```
chrome.exe --kiosk --kiosk-printing --disable-pinch --overscroll-history-navigation=0 http://<servidor>/totem
```

Sem `--kiosk-printing` o Chrome mostra o diálogo de impressão e exige um toque extra.

**Saída do totem:** segure o logo por ~1,5 s para abrir o menu do administrador (painel administrativo ou encerrar sessão).

## Limitações conhecidas

- O responsável é um **nome digitado**, não uma conta: não há PIN por operador. Recomendado para o MVP (usuários + PIN).
- A temperatura da etiqueta é a de armazenamento padrão/informada, não uma leitura de sensor.
- A data de abertura é sempre a do dia; para outra data, use o painel administrativo.
- O login do totem usa o teclado do sistema operacional (feito uma vez, por um administrador).
- Impressão pelo navegador; integração direta com impressora térmica continua fora do escopo do TCC.
- A etiqueta com "Quantidade" > 1 imprime cópias do mesmo registro (mesmo código), não registros separados.
