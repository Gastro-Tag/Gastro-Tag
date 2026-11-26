import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Printer, RefreshCw, ShieldCheck } from 'lucide-react';
import { labelApi, settingsApi } from '@/services';
import { extractError } from '@/services/api';
import type { LabelReport, ReportRow } from '@/types';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadError } from '@/components/ui/LoadError';
import { PageLoader, Spinner } from '@/components/ui/Spinner';
import { useToastContext } from '@/components/ui/Toast';
import { formatBR, formatDateTimeBR } from '@/utils/date';
import { REASON_LABEL, REASON_OPTIONS } from '@/utils/labelStatus';
import {
  REPORT_HEADER_MAX, reportClosedDetail, reportKitchenTitle, reportLotText, reportPeriodText, reportSituation,
} from '@/utils/report';

const STORAGE_LABEL = { REFRIGERADO: 'Refrigerado', CONGELADO: 'Congelado' } as const;
const COLUMNS = ['Código', 'Criada em', 'Produto', 'Lote', 'Abertura', 'Descarte', 'Armaz. / Temp.', 'Responsável', 'Situação'];

/** Relatório do período para imprimir ou "Salvar como PDF" no navegador. Só ADMIN (rota sob AdminRoute). */
export function ReportPage() {
  const { toast } = useToastContext();
  const [report, setReport] = useState<LabelReport | null>(null);
  const hasReport = useRef(false);
  const headerLoaded = useRef(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');     // falha sem relatório na tela
  const [periodError, setPeriodError] = useState(''); // 422 etc.: mantém o relatório anterior
  const [nameDraft, setNameDraft] = useState('');
  const [respDraft, setRespDraft] = useState('');
  const [savingHeader, setSavingHeader] = useState(false);

  const load = useCallback(async (params?: { from: string; to: string }) => {
    setLoading(true);
    setPeriodError('');
    try {
      const { data } = await labelApi.report(params);
      const next = data.data;
      hasReport.current = true;
      setReport(next);
      setFrom(next.from);
      setTo(next.to);
      // Só na primeira carga: "Atualizar" não apaga o que foi digitado e ainda não salvo.
      if (!headerLoaded.current) {
        headerLoaded.current = true;
        setNameDraft(next.kitchen.name ?? '');
        setRespDraft(next.kitchen.technicalResponsible ?? '');
      }
      setLoadError('');
    } catch (err) {
      const message = extractError(err);
      if (hasReport.current) setPeriodError(message);
      else setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function saveHeader() {
    setSavingHeader(true);
    try {
      const { data } = await settingsApi.update({ kitchenName: nameDraft.trim(), technicalResponsible: respDraft.trim() });
      const saved = data.data;
      setReport((current) => current && {
        ...current,
        kitchen: { name: saved.kitchenName ?? null, technicalResponsible: saved.technicalResponsible ?? null },
      });
      setNameDraft(saved.kitchenName ?? '');
      setRespDraft(saved.technicalResponsible ?? '');
      toast('Cabeçalho do relatório salvo.', 'success');
    } catch (err) {
      toast(extractError(err), 'error');
    } finally {
      setSavingHeader(false);
    }
  }

  if (!report && loading) return <PageLoader />;
  if (!report) return <LoadError title="Não foi possível carregar o relatório" message={loadError} onRetry={() => void load()} />;

  const { summary, rows, kitchen, today } = report;
  const rangeInverted = Boolean(from && to && to < from);
  const periodInvalid = !from || !to || rangeInverted;

  return (
    <div className="space-y-6">
      {/* Controles: só na tela */}
      <div className="space-y-4 print:hidden">
        <div className="card p-5">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="report-from" className="mb-1 block text-xs font-bold text-slate-500">De</label>
              <input id="report-from" type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label htmlFor="report-to" className="mb-1 block text-xs font-bold text-slate-500">Até</label>
              <input id="report-to" type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </div>
            <button type="button" className="btn btn-outline" disabled={loading || periodInvalid} onClick={() => void load({ from, to })}>
              {loading ? <Spinner size="sm" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />} Atualizar
            </button>
            <button type="button" className="btn btn-primary" disabled={loading} onClick={() => window.print()}>
              <Printer className="h-4 w-4" aria-hidden="true" /> Imprimir / Salvar em PDF
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            O período vale pela data de criação da etiqueta (até 31 dias). No diálogo de impressão, escolha Salvar como PDF.
          </p>
          {rangeInverted && <p role="alert" className="mt-2 text-sm text-rose-600">A data final não pode ser anterior à inicial.</p>}
          {periodError && <p role="alert" className="mt-2 text-sm font-semibold text-rose-600">{periodError}</p>}
        </div>

        <div className="card p-5">
          <h2 className="section-label">Cabeçalho do relatório</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="report-kitchen" className="mb-1 block text-xs font-bold text-slate-500">Nome da cozinha</label>
              <input id="report-kitchen" className="input" maxLength={REPORT_HEADER_MAX} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
            </div>
            <div>
              <label htmlFor="report-resp" className="mb-1 block text-xs font-bold text-slate-500">Responsável técnico</label>
              <input id="report-resp" className="input" maxLength={REPORT_HEADER_MAX} value={respDraft} onChange={(e) => setRespDraft(e.target.value)} />
            </div>
          </div>
          <button type="button" className="btn btn-outline mt-3" disabled={savingHeader} onClick={() => void saveHeader()}>
            {savingHeader && <Spinner size="sm" />} Salvar cabeçalho
          </button>
        </div>
      </div>

      {/* Conteúdo impresso */}
      <article
        className={`rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 print:rounded-none print:border-0 print:p-0 ${loading ? 'opacity-60 print:opacity-100' : ''}`}
        aria-busy={loading}
      >
        <header className="border-b-2 border-slate-800 pb-3">
          <h1 className="text-2xl font-extrabold print:text-[16pt]">{reportKitchenTitle(kitchen.name)}</h1>
          <p className="text-lg font-bold print:text-[12pt]">Relatório de etiquetas</p>
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 print:grid-cols-2 print:text-[9pt]">
            <div><dt className="inline font-bold">Período (criação): </dt><dd className="inline">{reportPeriodText(report.from, report.to)}</dd></div>
            <div><dt className="inline font-bold">Responsável técnico: </dt><dd className="inline">{kitchen.technicalResponsible?.trim() || 'não informado'}</dd></div>
            <div><dt className="inline font-bold">Emitido em: </dt><dd className="inline">{formatDateTimeBR(report.generatedAt)}</dd></div>
            <div><dt className="inline font-bold">Situação na data de emissão: </dt><dd className="inline">{formatBR(today)}</dd></div>
          </dl>
        </header>

        <section className="mt-4 break-inside-avoid" aria-label="Resumo">
          <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide print:text-[9pt]">Resumo do período</h2>
          <ul className="grid gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2 print:grid-cols-2 print:text-[9pt]">
            <li>Etiquetas criadas (inclui canceladas): <strong>{summary.total}</strong></li>
            <li>Ativas: <strong>{summary.active}</strong> (das quais vencidas: <strong>{summary.activeExpired}</strong>)</li>
            {(summary.activeBeforeClosing ?? 0) > 0 && (
              <li>Anteriores ao encerramento (sem registro de destino): <strong>{summary.activeBeforeClosing}</strong></li>
            )}
            <li>Usadas: <strong>{summary.used}</strong></li>
            <li>Canceladas: <strong>{summary.cancelled}</strong></li>
            <li>
              Descartadas: <strong>{summary.discarded}</strong>
              {summary.discarded > 0 && (
                <> ({REASON_OPTIONS.filter((r) => summary.discardedByReason[r] > 0)
                  .map((r) => `${REASON_LABEL[r].toLowerCase()}: ${summary.discardedByReason[r]}`).join('; ')})</>
              )}
            </li>
            <li>Operador confirmado com PIN: <strong>{summary.handlerVerified}</strong></li>
            <li>Sem regra validada: <strong>{summary.withoutRule}</strong></li>
            <li>
              Temperatura (sem canceladas) sugerida: <strong>{summary.temperatureSuggested}</strong>; digitada: <strong>{summary.temperatureTyped}</strong>
              {(summary.temperatureUnknown ?? 0) > 0 && <>; sem registro: <strong>{summary.temperatureUnknown}</strong></>}
            </li>
          </ul>
        </section>

        <section className="mt-5" aria-label="Etiquetas">
          <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide print:text-[9pt]">Etiquetas</h2>
          {rows.length === 0 ? (
            <>
              <div className="print:hidden">
                <EmptyState icon={<FileText className="h-7 w-7 text-slate-400" aria-hidden="true" />} title="Nenhuma etiqueta no período" desc="Escolha outro período e clique em Atualizar." />
              </div>
              <p className="hidden text-sm print:block">Nenhuma etiqueta criada no período.</p>
            </>
          ) : (
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full border-collapse text-left text-xs print:text-[7.5pt]">
                <thead className="table-header-group">
                  <tr className="bg-slate-100 print:bg-transparent">
                    {COLUMNS.map((h) => (
                      <th key={h} scope="col" className="border border-slate-400 px-1.5 py-1 font-bold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <ReportRows rows={rows} today={today} />
              </table>
            </div>
          )}
        </section>

        <section className="mt-8 grid break-inside-avoid gap-6 text-sm sm:grid-cols-3 print:grid-cols-3 print:text-[9pt]" aria-label="Assinaturas">
          <div>
            <div className="h-10 border-b border-slate-800" />
            <p className="mt-1 font-semibold">Responsável técnico</p>
            <p className="text-slate-600">{kitchen.technicalResponsible?.trim() || ' '}</p>
          </div>
          <div>
            <div className="h-10 border-b border-slate-800" />
            <p className="mt-1 font-semibold">Conferido por</p>
          </div>
          <div>
            <div className="h-10 border-b border-slate-800" />
            <p className="mt-1 font-semibold">Data</p>
          </div>
        </section>

        <footer className="mt-6 border-t border-slate-300 pt-2 text-xs text-slate-600 print:text-[8pt]">
          Gerado pelo GastroTag. Os prazos seguem as regras cadastradas pela cozinha.
        </footer>
      </article>
    </div>
  );
}

/** Linhas da tabela, memorizadas: digitar no cabeçalho ou nas datas não redesenha até 2000 linhas. */
const ReportRows = memo(function ReportRows({ rows, today }: { rows: ReportRow[]; today: string }) {
  return (
    <tbody>
      {rows.map((row) => (
        <tr key={row.id} className="break-inside-avoid align-top">
                      <td className="border border-slate-300 px-1.5 py-1 font-mono">{row.shortCode}</td>
                      <td className="border border-slate-300 px-1.5 py-1">{formatDateTimeBR(row.createdAt)}</td>
                      <td className="border border-slate-300 px-1.5 py-1">
                        <span className="font-semibold">{row.productName}</span>
                        {row.productBrand && <span className="text-slate-600"> ({row.productBrand})</span>}
                        {row.noRule && <span className="block text-amber-700">sem regra validada</span>}
                      </td>
                      <td className="border border-slate-300 px-1.5 py-1">{reportLotText(row)}</td>
                      <td className="border border-slate-300 px-1.5 py-1">{formatBR(row.openedAt)}</td>
                      <td className="border border-slate-300 px-1.5 py-1">{formatBR(row.discardAt)}</td>
                      <td className="border border-slate-300 px-1.5 py-1">{STORAGE_LABEL[row.storageType]} · {row.storageTemp}</td>
                      <td className="border border-slate-300 px-1.5 py-1">
                        {row.responsibleName ?? '—'}
                        {row.handlerVerified && (
                          <span className="ml-1 whitespace-nowrap font-semibold" title="Operador confirmado com PIN">
                            <ShieldCheck className="inline h-3 w-3" aria-hidden="true" /> PIN
                          </span>
                        )}
                      </td>
                      <td className="border border-slate-300 px-1.5 py-1">
                {reportSituation(row, today)}
                {row.status === 'ENCERRADA' && reportClosedDetail(row, formatDateTimeBR) && (
                  <span className="block text-slate-600">{reportClosedDetail(row, formatDateTimeBR)}</span>
                )}
              </td>
                    </tr>
      ))}
    </tbody>
  );
});
