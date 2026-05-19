# GastroTag 🏷️🥑

> "O cérebro digital da cozinha."

O **GastroTag** é uma solução inteligente de software desenvolvida para automatizar a gestão de validade, rastreabilidade e rotulagem de produtos alimentícios pós-abertos. Projetado especificamente para operar em dispositivos como **tablets e totens dedicados** dentro de cozinhas pedagógicas e comerciais, o sistema substitui os métodos manuais ineficientes (como escrita em fita crepe) por um processo digital imutável e ágil.

O projeto nasceu focado em atender às cozinhas pedagógicas do **SENAC Amazonas**, em conformidade rigorosa com a resolução **RDC 216 da ANVISA**, com alto potencial de escalabilidade para o mercado B2B gastronômico.

---

## 🚀 Principais Funcionalidades (MVP)

* **Motor de Cálculo Automático:** Determina instantaneamente a nova data de descarte pós-abertura com base nas regras de conservação da ANVISA (distinguindo automaticamente se o insumo será refrigerado ou congelado).
* **Interface Totem/Tablet UI:** Design focado em UX operacional para telas de toque em ambientes de alta pressão de cozinhas profissionais.
* **Identificação via Short-Code ID:** Busca rápida e registro ágil utilizando códigos curtos para os insumos.
* **Geração e Impressão de Etiquetas:** Emissão automática de layouts de etiquetas contendo Nome, Lote, Data de Abertura, Data de Descarte, Modo de Armazenamento, e Campo de Assinatura do manipulador.
* **Integração Térmica:** Conexão direta com mini impressoras térmicas locais para impressão física resistente à umidade e ao frio da cozinha.
* **Módulo de Identidade Visual:** Personalização das etiquetas impressas com o logotipo da instituição (SENAC-AM ou restaurante parceiro).
* **Alertas Visuais por Cores:** Dashboard com alertas baseados em cores para identificar produtos com validades e descartes próximos.

---

## 🚫 Fora do Escopo Atual (MVP)

Para garantir a máxima eficiência na entrega do núcleo da aplicação, os seguintes módulos **não fazem parte** do escopo atual:
* Controle quantitativo de estoque ou inventário físico.
* Gestão/pesagem de desperdício e análise de sobras.
* Integração com leitura de códigos de barras ou QR Codes (método focado em Short-Code e busca nominal).

---

## 🛠️ Tech Stack & Arquitetura

* **Backend:** Python (Lógica de negócios e APIs de integração)
* **Ambiente de Operação:** Dispositivos móveis dedicados (Tablets/Totens) conectados à rede local/nuvem.
* **Persistência:** Banco de dados relacional para armazenamento de regras de insumos, usuários e histórico de rotulagem.

<!-- ## 📦 Como Executar o Projeto Localmente

### Pré-requisitos
* Docker e Docker Compose instalados.
* *(Opcional)* Python 3.10+ configurado se for rodar o ambiente bare-metal.

### Passos para Inicialização (Via Docker)

1. Clone o repositório do projeto:
   ```bash
   git clone [https://github.com/seu-usuario/gastrotag.git](https://github.com/seu-usuario/gastrotag.git)
   cd gastrotag
