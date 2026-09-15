import { FormEvent, useEffect, useState } from "react";
import axios from "axios";
import { api } from "../lib/api";

type TemplateStatus = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED";
type TemplateCategory = "MARKETING" | "UTILITY";

interface Template {
  id: string;
  name: string;
  category: TemplateCategory;
  language: string;
  bodyText: string;
  variableCount: number;
  status: TemplateStatus;
  rejectionReason: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<TemplateStatus, string> = {
  DRAFT: "Rascunho",
  PENDING: "Em análise na Meta",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
};

const STATUS_STYLE: Record<TemplateStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  PENDING: "bg-yellow-100 text-yellow-700",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
};

function insertVariable(text: string, textarea: HTMLTextAreaElement | null, nextIndex: number) {
  const tag = `{{${nextIndex}}}`;
  if (!textarea) return `${text}${tag}`;
  const start = textarea.selectionStart ?? text.length;
  const end = textarea.selectionEnd ?? text.length;
  return `${text.slice(0, start)}${tag}${text.slice(end)}`;
}

function CreateTemplateForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<TemplateCategory>("UTILITY");
  const [bodyText, setBodyText] = useState("");
  const [examples, setExamples] = useState<string[]>([]);
  const [textarea, setTextarea] = useState<HTMLTextAreaElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const variableCount = new Set(Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g)).map((m) => m[1])).size;

  function updateExample(index: number, value: string) {
    setExamples((prev) => {
      const next = [...prev];
      while (next.length < variableCount) next.push("");
      next[index] = value;
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedExamples = examples.slice(0, variableCount).map((v) => v.trim());
    if (!name.trim() || !bodyText.trim() || trimmedExamples.some((v) => !v) || trimmedExamples.length !== variableCount) return;
    setSaving(true);
    setError(null);
    try {
      await api.post("/templates", { name: name.trim(), category, bodyText: bodyText.trim(), bodyExamples: trimmedExamples });
      onCreated();
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(
        message === "name_must_be_lowercase_underscore"
          ? "O nome só pode ter letras minúsculas, números e underline (_)."
          : message === "body_examples_count_mismatch"
            ? "Preencha um valor de exemplo para cada variável."
            : "Não foi possível criar o template.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Nome do template (minúsculas_com_underline)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
            placeholder="ex: promocao_setembro"
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Categoria</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as TemplateCategory)}
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          >
            <option value="UTILITY">Utility (transacional, mais barato)</option>
            <option value="MARKETING">Marketing (promocional)</option>
          </select>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs font-medium text-gray-500">Texto da mensagem</label>
          <button
            type="button"
            onClick={() => setBodyText((prev) => insertVariable(prev, textarea, variableCount + 1))}
            className="text-xs font-medium text-brand-dark hover:underline"
          >
            + variável {`{{${variableCount + 1}}}`}
          </button>
        </div>
        <textarea
          ref={setTextarea}
          value={bodyText}
          onChange={(e) => setBodyText(e.target.value)}
          rows={4}
          placeholder="Ex: Olá {{1}}, sua consulta está confirmada para {{2}}."
          className="w-full resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
        <p className="mt-1 text-xs text-gray-400">
          Use {"{{1}}"}, {"{{2}}"}... para os campos que a Meta vai exigir preencher ao disparar (formato dela, diferente das
          tags {"{{nome}}"} das Respostas Rápidas).
        </p>
      </div>

      {variableCount > 0 && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">
            Valores de exemplo (a Meta exige um exemplo real por variável para aprovar)
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: variableCount }).map((_, i) => (
              <input
                key={i}
                value={examples[i] ?? ""}
                onChange={(e) => updateExample(i, e.target.value)}
                placeholder={`Exemplo para {{${i + 1}}}`}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={
            saving ||
            !name.trim() ||
            !bodyText.trim() ||
            Array.from({ length: variableCount }).some((_, i) => !examples[i]?.trim())
          }
          className="rounded-xl bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Salvando..." : "Salvar rascunho"}
        </button>
      </div>
    </form>
  );
}

export function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function refresh() {
    const res = await api.get("/templates");
    setTemplates(res.data);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function submitForApproval(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      await api.post(`/templates/${id}/submit`);
      await refresh();
    } catch (err) {
      const code = axios.isAxiosError(err) ? (err.response?.data as { error?: string } | undefined)?.error : undefined;
      setActionError({
        id,
        message:
          code === "cloud_api_waba_not_configured"
            ? "Salve o WABA ID e o token de acesso em Conexão WhatsApp antes de enviar."
            : code === "no_cloud_api_session_connected"
              ? "Nenhuma conexão via API Oficial encontrada."
              : code?.startsWith("meta_template_submit_failed:")
                ? `Meta recusou: ${code.slice("meta_template_submit_failed:".length)}`
                : "Não foi possível enviar para aprovação.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function syncStatus(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      await api.post(`/templates/${id}/sync-status`);
      await refresh();
    } catch {
      setActionError({ id, message: "Não foi possível consultar o status na Meta." });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    await api.delete(`/templates/${id}`);
    setConfirmDeleteId(null);
    await refresh();
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Templates</h1>
          <p className="text-sm text-gray-500">Modelos de mensagem aprovados pela Meta, usados nas Campanhas.</p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="rounded-xl bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90">
            + Novo template
          </button>
        )}
      </div>

      {showForm && (
        <CreateTemplateForm
          onCreated={() => {
            setShowForm(false);
            refresh();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div className="space-y-2">
        {templates.map((t) => (
          <div key={t.id} className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-medium text-gray-900">{t.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{t.category}</span>
              </div>
              <div className="flex items-center gap-2">
                {(t.status === "DRAFT" || t.status === "REJECTED") && (
                  <button
                    onClick={() => submitForApproval(t.id)}
                    disabled={busyId === t.id}
                    className="text-xs font-medium text-brand-dark hover:underline disabled:opacity-50"
                  >
                    Enviar para aprovação da Meta
                  </button>
                )}
                {(t.status === "PENDING" || (t.status === "REJECTED" && !t.rejectionReason)) && (
                  <button onClick={() => syncStatus(t.id)} disabled={busyId === t.id} className="text-xs font-medium text-gray-500 hover:underline">
                    Atualizar status
                  </button>
                )}
                {confirmDeleteId === t.id ? (
                  <span className="flex items-center gap-1 text-xs">
                    <span className="text-gray-500">Apagar?</span>
                    <button onClick={() => remove(t.id)} className="font-medium text-red-600 hover:underline">
                      Sim
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)} className="text-gray-500 hover:underline">
                      Não
                    </button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmDeleteId(t.id)} className="text-xs text-red-600 hover:underline">
                    Apagar
                  </button>
                )}
              </div>
            </div>
            <p className="whitespace-pre-wrap text-sm text-gray-600">{t.bodyText}</p>
            {t.status === "REJECTED" && t.rejectionReason && (
              <p className="mt-1 text-xs text-red-600">Motivo da rejeição: {t.rejectionReason}</p>
            )}
            {actionError?.id === t.id && <p className="mt-1 text-xs text-red-600">{actionError.message}</p>}
          </div>
        ))}
        {templates.length === 0 && !showForm && <p className="text-sm text-gray-400">Nenhum template criado ainda.</p>}
      </div>
    </div>
  );
}
