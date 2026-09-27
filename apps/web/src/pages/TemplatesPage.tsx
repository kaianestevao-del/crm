import { FormEvent, useEffect, useState } from "react";
import axios from "axios";
import { api } from "../lib/api";
import { fillTemplateBody } from "@crm/shared";

type TemplateStatus = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED";
type TemplateCategory = "MARKETING" | "UTILITY";

interface Template {
  id: string;
  name: string;
  category: TemplateCategory;
  language: string;
  bodyText: string;
  bodyExamples: string[];
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

interface TemplateFormInitial {
  name: string;
  category: TemplateCategory;
  bodyText: string;
  bodyExamples: string[];
}

function TemplateForm({
  editingId,
  initial,
  onSaved,
  onCancel,
}: {
  editingId?: string;
  initial?: TemplateFormInitial;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState<TemplateCategory>(initial?.category ?? "UTILITY");
  const [bodyText, setBodyText] = useState(initial?.bodyText ?? "");
  const [examples, setExamples] = useState<string[]>(initial?.bodyExamples ?? []);
  const [textarea, setTextarea] = useState<HTMLTextAreaElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const variableCount = new Set(Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g)).map((m) => m[1])).size;
  // A contact tag like {{nome}} in an example is the most common mix-up — it's only resolved in
  // the Campaign, and Meta's reviewer would just see the literal braces.
  const exampleHasTag = examples.slice(0, variableCount).some((v) => /\{\{.*\}\}/.test(v));

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
      const payload = { name: name.trim(), category, bodyText: bodyText.trim(), bodyExamples: trimmedExamples };
      if (editingId) {
        await api.patch(`/templates/${editingId}`, payload);
      } else {
        await api.post("/templates", payload);
      }
      onSaved();
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(
        message === "name_must_be_lowercase_underscore"
          ? "O nome só pode ter letras minúsculas, números e underline (_)."
          : message === "body_examples_count_mismatch"
            ? "Preencha um valor de exemplo para cada variável."
            : `Não foi possível ${editingId ? "salvar" : "criar"} o template.`,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
        <p className="mb-1 font-semibold">Como funcionam as variáveis</p>
        <ol className="list-decimal space-y-0.5 pl-4">
          <li>
            Aqui você escreve o <strong>modelo</strong> da mensagem. Onde o texto muda de um envio pro outro (nome, dia...), clique em{" "}
            <strong>+ variável</strong> — ela vira um espaço em branco numerado: {"{{1}}"}, {"{{2}}"}...
          </li>
          <li>
            Para cada espaço, dê um <strong>exemplo real</strong> (ex: Maria, segunda-feira). Ele serve só pra Meta aprovar — não é o
            que vai ser enviado.
          </li>
          <li>
            O que vai de verdade em cada espaço você escolhe depois, ao criar a <strong>Campanha</strong> — lá sim dá pra colocar o
            nome de cada paciente automaticamente.
          </li>
        </ol>
        <p className="mt-1">
          Dica: o que é sempre igual, escreva direto no texto. Use variável só no que muda — assim o mesmo template serve pra
          vários disparos sem nova aprovação.
        </p>
      </div>

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
          <p className="mt-1 text-xs text-gray-400">
            Convite, promoção ou "que tal começar..." é Marketing — se marcar Utility, a Meta reclassifica e cobra como Marketing
            mesmo assim.
          </p>
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
          Ex: Oi {"{{1}}"}, sua consulta está confirmada para {"{{2}}"}. — o {"{{1}}"} e o {"{{2}}"} são só a ordem dos espaços,
          não o conteúdo.
        </p>
      </div>

      {variableCount > 0 && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Exemplos para a Meta aprovar</label>
          <p className="mb-2 text-xs text-gray-400">
            Escreva um valor real de amostra (ex: Maria). <strong>Não</strong> use {"{{nome}}"} aqui — o nome de cada paciente é
            escolhido na Campanha.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: variableCount }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-10 shrink-0 font-mono text-xs text-gray-500">{`{{${i + 1}}}`}</span>
                <input
                  value={examples[i] ?? ""}
                  onChange={(e) => updateExample(i, e.target.value)}
                  placeholder={i === 0 ? "ex: Maria" : "ex: segunda-feira"}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
              </div>
            ))}
          </div>
          {exampleHasTag && (
            <p className="mt-2 text-xs text-amber-600">
              Coloque um exemplo real no lugar de {"{{...}}"} — a Meta pode recusar o template.
            </p>
          )}
          <div className="mt-3 rounded-xl bg-gray-50 p-3">
            <p className="mb-1 text-xs font-medium text-gray-500">Como a Meta vai ver o exemplo</p>
            <p className="whitespace-pre-wrap text-sm text-gray-700">
              {fillTemplateBody(
                bodyText,
                Array.from({ length: variableCount }, (_, i) => examples[i]?.trim() || `{{${i + 1}}}`),
              )}
            </p>
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
          {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Salvar rascunho"}
        </button>
      </div>
    </form>
  );
}

type FormMode = { type: "create" } | { type: "edit"; template: Template } | { type: "duplicate"; template: Template };

export function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [recategorized, setRecategorized] = useState<{ id: string; name: string; from: TemplateCategory; to: TemplateCategory }[]>([]);

  async function refresh() {
    const res = await api.get("/templates");
    setTemplates(res.data);
  }

  useEffect(() => {
    refresh();
    // Pulls status + category from Meta for every submitted template — Meta may have
    // re-classified one (typically Utility → Marketing), which changes what it's billed as.
    api
      .post("/templates/sync-all")
      .then((res) => {
        setRecategorized(res.data.recategorized ?? []);
        return refresh();
      })
      .catch(() => {});
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
          <p className="text-sm text-gray-500">
            Modelos de mensagem aprovados pela Meta. O conteúdo de cada variável ({"{{1}}"}, {"{{2}}"}...) é escolhido na hora de
            criar a Campanha.
          </p>
        </div>
        {!formMode && (
          <button
            onClick={() => setFormMode({ type: "create" })}
            className="rounded-xl bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            + Novo template
          </button>
        )}
      </div>

      {recategorized.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-semibold">A Meta mudou a categoria destes templates:</p>
          <ul className="mt-1 list-disc pl-4">
            {recategorized.map((r) => (
              <li key={r.id}>
                <span className="font-mono">{r.name}</span>: {r.from} → <strong>{r.to}</strong>
              </li>
            ))}
          </ul>
          <p className="mt-1">
            A Meta passa a cobrar pela categoria nova. Textos de convite ou promoção são sempre Marketing — Utility só vale para avisos
            sobre algo que o paciente já contratou (confirmação, lembrete de consulta).
          </p>
        </div>
      )}

      {formMode && (
        <TemplateForm
          editingId={formMode.type === "edit" ? formMode.template.id : undefined}
          initial={
            formMode.type === "edit"
              ? {
                  name: formMode.template.name,
                  category: formMode.template.category,
                  bodyText: formMode.template.bodyText,
                  bodyExamples: formMode.template.bodyExamples,
                }
              : formMode.type === "duplicate"
                ? {
                    name: `${formMode.template.name}_copia`,
                    category: formMode.template.category,
                    bodyText: formMode.template.bodyText,
                    bodyExamples: formMode.template.bodyExamples,
                  }
                : undefined
          }
          onSaved={() => {
            setFormMode(null);
            refresh();
          }}
          onCancel={() => setFormMode(null)}
        />
      )}

      <div className="space-y-2">
        {templates.map((t) => (
          <div key={t.id} className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-medium text-gray-900">{t.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    t.category === "MARKETING" ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {t.category === "MARKETING" ? "Marketing (mais caro)" : "Utility"}
                </span>
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
                {(t.status === "DRAFT" || t.status === "REJECTED") && (
                  <button
                    onClick={() => setFormMode({ type: "edit", template: t })}
                    className="text-xs font-medium text-gray-500 hover:underline"
                  >
                    Editar
                  </button>
                )}
                <button
                  onClick={() => setFormMode({ type: "duplicate", template: t })}
                  className="text-xs font-medium text-gray-500 hover:underline"
                >
                  Duplicar
                </button>
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
        {templates.length === 0 && !formMode && <p className="text-sm text-gray-400">Nenhum template criado ainda.</p>}
      </div>
    </div>
  );
}
