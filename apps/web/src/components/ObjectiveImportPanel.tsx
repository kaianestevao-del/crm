import { useState } from "react";
import { OBJECTIVE_TAGS_PT } from "@crm/shared";
import { api } from "../lib/api";

interface ImportSummary {
  objective: string;
  numbersInSheet: number;
  invalidRows: number;
  foundInCrm: number;
  alreadyHadObjective: number;
  willLink: number;
  notInCrm: number;
  notInCrmSample: { phoneNumber: string; name: string | null }[];
  dryRun: boolean;
  linked?: number;
  created?: number;
}

// "Vincular objetivo por planilha": pick an objective and a spreadsheet (e.g. a WaSpeed export),
// see how many of its numbers are in the CRM, then link them. Two steps on purpose — nothing
// changes until "Vincular" is clicked. Contacts are matched by number (with or without the 9th
// digit) and never duplicated.
export function ObjectiveImportPanel({ onDone }: { onDone: () => void }) {
  const [objective, setObjective] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [createMissing, setCreateMissing] = useState(false);
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(dryRun: boolean) {
    if (!objective || !file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("objective", objective);
    form.append("dryRun", String(dryRun));
    form.append("createMissing", String(createMissing));
    setBusy(true);
    setError(null);
    try {
      const res = await api.post("/contacts/import-objective", form, { headers: { "Content-Type": "multipart/form-data" } });
      if (dryRun) setPreview(res.data);
      else {
        setResult(res.data);
        setPreview(null);
        onDone();
      }
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(
        code === "phone_column_not_found"
          ? "Não achei a coluna de telefone. A primeira linha precisa ter um título como WhatsApp, Telefone ou Celular."
          : "Não foi possível ler a planilha.",
      );
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
  }

  return (
    <div className="mb-4 max-w-xl rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="mb-1 text-sm font-medium text-gray-900">Vincular objetivo por planilha</p>
      <p className="mb-3 text-xs text-gray-500">
        Envie uma planilha com a coluna de WhatsApp/telefone. Todos os contatos dela recebem o objetivo escolhido. O número é
        reconhecido com ou sem o 9, e nenhum contato é duplicado.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={objective}
          onChange={(e) => {
            setObjective(e.target.value);
            setPreview(null);
            setResult(null);
          }}
          className="rounded-xl border border-gray-300 px-3 py-2 text-xs focus:border-brand focus:outline-none"
        >
          <option value="">Escolha o objetivo...</option>
          {OBJECTIVE_TAGS_PT.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPreview(null);
            setResult(null);
          }}
          className="text-xs text-gray-600"
        />
      </div>

      <label className="mb-3 flex items-center gap-2 text-xs text-gray-600">
        <input
          type="checkbox"
          checked={createMissing}
          onChange={(e) => {
            setCreateMissing(e.target.checked);
            setPreview(null);
          }}
        />
        Salvar também, como contato novo, os números que ainda não estão no CRM
      </label>

      {!preview && !result && (
        <button
          onClick={() => send(true)}
          disabled={busy || !objective || !file}
          className="rounded-xl border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? "Conferindo..." : "Conferir planilha"}
        </button>
      )}

      {preview && (
        <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-700">
          <p className="mb-1 font-medium">Antes de vincular a {preview.objective}:</p>
          <p>{preview.numbersInSheet} números na planilha</p>
          <p>{preview.foundInCrm} já estão no CRM</p>
          <p>
            <span className="font-medium">{preview.willLink}</span> vão receber o objetivo
            {preview.alreadyHadObjective > 0 && ` (${preview.alreadyHadObjective} já tinham)`}
          </p>
          <p>
            {preview.notInCrm} não estão no CRM
            {preview.notInCrm > 0 && (createMissing ? " (serão salvos como contato novo com o objetivo)" : " (ficam de fora)")}
          </p>
          {preview.invalidRows > 0 && <p>{preview.invalidRows} linhas com número inválido (ignoradas)</p>}
          {preview.notInCrmSample.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-gray-500">Ver alguns que não estão no CRM</summary>
              <ul className="mt-1 space-y-0.5 text-gray-500">
                {preview.notInCrmSample.map((m) => (
                  <li key={m.phoneNumber}>
                    +{m.phoneNumber} {m.name ? `· ${m.name}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => send(false)}
              disabled={busy}
              className="rounded-xl bg-brand-dark px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Vinculando..." : "Vincular"}
            </button>
            <button onClick={() => setPreview(null)} className="text-xs text-gray-500 hover:underline">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-xl bg-green-50 p-3 text-xs text-green-800">
          <p className="font-medium">Pronto: {result.objective}</p>
          <p>{result.linked} contatos receberam o objetivo.</p>
          {!!result.created && <p>{result.created} contatos novos foram salvos.</p>}
          {result.alreadyHadObjective > 0 && <p>{result.alreadyHadObjective} já tinham esse objetivo.</p>}
          <button onClick={reset} className="mt-2 font-medium underline">
            Enviar outra planilha
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
