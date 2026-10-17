import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ScanLine, ArrowRight, ArrowLeft, PackageOpen, Archive,
  ArrowRightLeft, Trash2, CheckCircle2, AlertCircle,
  CalendarDays, Clock3, Snowflake, RefreshCw, ShieldCheck,
  History, Settings, Info, UserRound, LogOut, RotateCcw
} from "lucide-react";
import "./styles.css";

const product = {
  name: "Frango Temperado",
  code: "GT-8F72A9",
  batch: "L20260930",
  originalExpiry: "05/10/2026",
  storage: "Refrigerado",
  openedAt: "30/09/2026 10:27",
  useUntil: "03/10/2026 10:27"
};

const operations = [
  { id: "open", title: "Abrir produto", description: "Registrar abertura do produto", icon: PackageOpen },
  { id: "store", title: "Armazenar", description: "Mover para outro local de armazenamento", icon: Archive },
  { id: "transfer", title: "Transferir", description: "Enviar para outra área ou cozinha", icon: ArrowRightLeft },
  { id: "discard", title: "Descartar", description: "Registrar descarte do produto", icon: Trash2 }
];

function Header({ onHome }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={onHome} aria-label="Voltar ao início">
        <span className="brand-mark"><ShieldCheck size={21} /></span>
        <span>GastroTag</span>
      </button>
      <div className="top-meta">
        <span>30/09/2026&nbsp; 10:27</span>
        <span className="device"><UserRound size={13} /> TOTEM-01</span>
      </div>
    </header>
  );
}

function Shell({ children, onHome }) {
  return (
    <div className="app">
      <Header onHome={onHome} />
      <main className="main">{children}</main>
    </div>
  );
}

function Home({ go }) {
  return (
    <Shell onHome={() => go("home")}>
      <section className="home-screen">
        <div className="hero">
          <span className="eyebrow">INTELIGÊNCIA E SEGURANÇA ALIMENTAR</span>
          <h1>Controle simples.<br /><span>Segurança em cada etiqueta.</span></h1>
          <p>Registre, consulte e acompanhe os alimentos da sua cozinha em poucos segundos.</p>
        </div>

        <button className="scan-button" onClick={() => go("scan")}>
          <span className="scan-icon"><ScanLine size={34} /></span>
          <span>
            <strong>ESCANEAR ETIQUETA</strong>
            <small>Aponte a câmera para o QR Code</small>
          </span>
          <ArrowRight size={25} />
        </button>

        <div className="divider"><span>Ou digite o código manualmente</span></div>

        <button className="manual-input" onClick={() => go("manual")}>
          <span>Digite o código da etiqueta...</span>
          <span className="round-arrow"><ArrowRight size={17} /></span>
        </button>

        <div className="home-footer">
          <span><ShieldCheck size={15} /> Sistema operacional</span>
          <span>Totem 01</span>
        </div>
      </section>
    </Shell>
  );
}

function Scan({ go }) {
  return (
    <Shell onHome={() => go("home")}>
      <div className="back-row"><button onClick={() => go("home")}><ArrowLeft size={17} /> Voltar</button></div>
      <section className="scan-screen">
        <div className="scan-copy">
          <span className="eyebrow">LEITURA DE ETIQUETA</span>
          <h2>Aponte a câmera<br />para o QR Code</h2>
          <p>Posicione a etiqueta dentro da área indicada.</p>
        </div>
        <div className="camera-card">
          <div className="fake-camera">
            <div className="corner tl" /><div className="corner tr" />
            <div className="corner bl" /><div className="corner br" />
            <div className="fake-qr">
              <div className="qr-square one" /><div className="qr-square two" /><div className="qr-square three" />
              <div className="qr-dots">GASTRO<br />TAG</div>
            </div>
            <div className="scan-line" />
          </div>
          <div className="camera-label"><ScanLine size={18} /> Simulação de câmera</div>
        </div>
        <button className="primary-button wide" onClick={() => go("product")}>
          Simular leitura <ArrowRight size={19} />
        </button>
      </section>
    </Shell>
  );
}

function Manual({ go }) {
  return (
    <Shell onHome={() => go("home")}>
      <div className="back-row"><button onClick={() => go("home")}><ArrowLeft size={17} /> Voltar</button></div>
      <section className="form-card centered">
        <span className="eyebrow">IDENTIFICAÇÃO MANUAL</span>
        <h2>Digite o código da etiqueta</h2>
        <p>Informe o código para consultar o produto.</p>
        <input className="code-input" defaultValue={product.code} />
        <div className="keypad">
          {["1","2","3","4","5","6","7","8","9","0"].map(n => <button key={n}>{n}</button>)}
          <button className="clear"><RotateCcw size={17} /></button>
        </div>
        <button className="primary-button wide" onClick={() => go("product")}>Consultar produto <ArrowRight size={19} /></button>
      </section>
    </Shell>
  );
}

function Product({ go }) {
  return (
    <Shell onHome={() => go("home")}>
      <div className="back-row"><button onClick={() => go("home")}><ArrowLeft size={17} /> Voltar</button></div>
      <section className="content-card">
        <div className="product-top">
          <div className="food-photo"><span>FRANGO</span></div>
          <div>
            <span className="status-pill"><CheckCircle2 size={15} /> Produto encontrado</span>
            <h2>{product.name}</h2>
            <p className="code">{product.code}</p>
            <div className="product-tags">
              <span><Archive size={15} /> Lote: {product.batch}</span>
              <span><CalendarDays size={15} /> Validade: {product.originalExpiry}</span>
              <span><Snowflake size={15} /> {product.storage}</span>
            </div>
          </div>
        </div>
        <div className="info-banner">
          <CheckCircle2 size={20} />
          <div><strong>Produto encontrado com sucesso!</strong><span>Verifique as informações e selecione a operação desejada.</span></div>
        </div>
        <button className="primary-button wide" onClick={() => go("operations")}>Continuar <ArrowRight size={19} /></button>
      </section>
    </Shell>
  );
}

function Operations({ go }) {
  return (
    <Shell onHome={() => go("home")}>
      <div className="back-row"><button onClick={() => go("product")}><ArrowLeft size={17} /> Voltar</button></div>
      <section className="content-card">
        <span className="eyebrow">FRANGO TEMPERADO · GT-8F72A9</span>
        <h2>O que você deseja fazer?</h2>
        <p className="subtitle">Selecione a operação desejada para este produto.</p>
        <div className="operation-grid">
          {operations.map(({ id, title, description, icon: Icon }) => (
            <button key={id} className={"operation " + (id === "discard" ? "danger-operation" : "")} onClick={() => go(id === "open" ? "open" : "result")}>
              <span className="operation-icon"><Icon size={25} /></span>
              <span><strong>{title}</strong><small>{description}</small></span>
              <ArrowRight size={18} />
            </button>
          ))}
        </div>
      </section>
    </Shell>
  );
}

function OpenProduct({ go }) {
  return (
    <Shell onHome={() => go("home")}>
      <div className="back-row"><button onClick={() => go("operations")}><ArrowLeft size={17} /> Voltar</button></div>
      <section className="form-card">
        <span className="eyebrow">ABRIR PRODUTO</span>
        <h2>Informe os dados da abertura</h2>
        <div className="form-grid">
          <label>Data de abertura<div className="field"><CalendarDays size={17} />30/09/2026</div></label>
          <label>Horário<div className="field"><Clock3 size={17} />10:27</div></label>
        </div>
        <label>Observações <span className="optional">(opcional)</span>
          <textarea placeholder="Ex.: Motivo da abertura, responsável, etc." />
        </label>
        <div className="rule-note"><ShieldCheck size={19} /><span>A data limite será calculada pela API conforme as regras sanitárias cadastradas.</span></div>
        <button className="primary-button wide" onClick={() => go("processing")}>Confirmar abertura <CheckCircle2 size={19} /></button>
      </section>
    </Shell>
  );
}

function Processing({ go }) {
  return (
    <Shell onHome={() => go("home")}>
      <section className="processing">
        <div className="spinner"><RefreshCw size={38} /></div>
        <span className="eyebrow">GASTROTAG API</span>
        <h2>Processando operação...</h2>
        <p>Calculando a data limite de uso conforme as regras sanitárias.</p>
        <button className="ghost-button" onClick={() => go("result")}>Simular resposta da API</button>
      </section>
    </Shell>
  );
}

function Result({ go }) {
  return (
    <Shell onHome={() => go("home")}>
      <section className="result-card">
        <div className="success-icon"><CheckCircle2 size={38} /></div>
        <span className="eyebrow">OPERAÇÃO CONCLUÍDA</span>
        <h2>Operação registrada!</h2>
        <p>O produto foi aberto com sucesso.</p>
        <div className="result-product"><div className="food-thumb">FRANGO</div><div><strong>{product.name}</strong><span>{product.code} · {product.batch}</span></div></div>
        <div className="result-grid">
          <div><CalendarDays size={18} /><small>Aberto em</small><strong>30/09/2026 10:27</strong></div>
          <div><CalendarDays size={18} /><small>Utilizar até</small><strong>03/10/2026 10:27</strong></div>
        </div>
        <div className="rule-note"><ShieldCheck size={19} /><span>Data calculada conforme regra sanitária cadastrada.</span></div>
        <button className="primary-button wide" onClick={() => go("home")}>Finalizar <ArrowRight size={19} /></button>
      </section>
    </Shell>
  );
}

function ErrorScreen({ go }) {
  return (
    <Shell onHome={() => go("home")}>
      <section className="error-card">
        <div className="error-icon"><AlertCircle size={42} /></div>
        <h2>Etiqueta não encontrada</h2>
        <p>O código informado não existe no sistema ou está inválido.</p>
        <button className="secondary-button wide" onClick={() => go("manual")}><RefreshCw size={18} /> Tentar novamente</button>
        <button className="text-button" onClick={() => go("home")}>Voltar para o início</button>
      </section>
    </Shell>
  );
}

function App() {
  const [screen, setScreen] = useState("home");

  const go = (next) => setScreen(next);

  if (screen === "home") return <Home go={go} />;
  if (screen === "scan") return <Scan go={go} />;
  if (screen === "manual") return <Manual go={go} />;
  if (screen === "product") return <Product go={go} />;
  if (screen === "operations") return <Operations go={go} />;
  if (screen === "open") return <OpenProduct go={go} />;
  if (screen === "processing") return <Processing go={go} />;
  if (screen === "result") return <Result go={go} />;
  if (screen === "error") return <ErrorScreen go={go} />;
  return <Home go={go} />;
}

createRoot(document.getElementById("root")).render(<App />);
