# GastroTag — Totem Prototype

Protótipo visual funcional do Totem GastroTag para demonstração de Sprint.

## O que funciona

- Tela inicial do Totem
- Simulação de leitura de QR Code
- Entrada manual de código
- Consulta simulada do produto
- Seleção de operação
- Fluxo de abertura do produto
- Tela de processamento simulando chamada à API
- Resultado da operação
- Responsividade para telas menores
- Visual otimizado para touchscreen

## Rodar localmente

Requer Node.js 20+.

```bash
npm install
npm run dev
```

Depois abra a URL mostrada pelo Vite, normalmente:

http://localhost:5173

## Observação

Este é um protótipo de frontend. Ele ainda NÃO está conectado ao backend real e não grava dados no PostgreSQL.

A próxima etapa é substituir os dados simulados por chamadas à API GastroTag, preservando o fluxo visual.
