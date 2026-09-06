import { useEffect, useState } from "react";
import { PIPELINE_STAGE_ROLES, PIPELINE_STAGE_ROLE_LABELS, PipelineStageRole } from "@crm/shared";
import { api } from "../lib/api";

interface Stage {
  id: string;
  name: string;
  order: number;
  role: PipelineStageRole | null;
}

interface Pipeline {
  id: string;
  name: string;
  stages: Stage[];
}

export function SettingsPage() {
  const [followUpTarget, setFollowUpTarget] = useState("");
  const [savingTarget, setSavingTarget] = useState(false);
  const [targetSaved, setTargetSaved] = useState(false);

  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [savingStageId, setSavingStageId] = useState<string | null>(null);

  async function refresh() {
    const [orgRes, pipelinesRes] = await Promise.all([api.get("/organizations/me"), api.get("/pipelines")]);
    setFollowUpTarget(String(orgRes.data.followUpMessageTarget));
    setPipeline(pipelinesRes.data[0] ?? null);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSaveTarget() {
    const value = Number(followUpTarget);
    if (!Number.isInteger(value) || value < 1) return;
    setSavingTarget(true);
    setTargetSaved(false);
    try {
      await api.patch("/organizations/me", { followUpMessageTarget: value });
      setTargetSaved(true);
    } finally {
      setSavingTarget(false);
    }
  }

  async function handleStageRoleChange(stageId: string, role: PipelineStageRole | "") {
    setPipeline((prev) =>
      prev
        ? { ...prev, stages: prev.stages.map((s) => (s.id === stageId ? { ...s, role: role || null } : s)) }
        : prev,
    );
    setSavingStageId(stageId);
    try {
      await api.patch(`/pipelines/stages/${stageId}`, { role: role || null });
    } finally {
      setSavingStageId(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-1 text-lg font-semibold">Configurações</h1>
      <p className="mb-6 max-w-2xl text-sm text-gray-500">
        Ajustes gerais da organização usados pelo Dashboard e pelo Funil.
      </p>

      <div className="max-w-2xl space-y-6">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="mb-1 text-sm font-medium">Meta de mensagens no Follow-up</p>
          <p className="mb-3 text-xs text-gray-500">
            Quantidade de mensagens que conta como "completar" a sequência de follow-up de um lead — aparece como
            "X de N" nos cards do Funil.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={followUpTarget}
              onChange={(e) => {
                setFollowUpTarget(e.target.value);
                setTargetSaved(false);
              }}
              className="w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none"
            />
            <button
              onClick={handleSaveTarget}
              disabled={savingTarget || !followUpTarget.trim()}
              className="rounded-md bg-brand-dark px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Salvar
            </button>
            {targetSaved && <span className="text-xs text-emerald-600">Salvo ✓</span>}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="mb-1 text-sm font-medium">Papel das etapas do Funil</p>
          <p className="mb-3 text-xs text-gray-500">
            Diz ao Dashboard o que cada etapa representa (paciente ativo, vencido, follow-up ou perdido), para
            calcular as métricas corretamente — não muda o nome nem a ordem da etapa.
          </p>
          {!pipeline ? (
            <p className="text-sm text-gray-400">Carregando...</p>
          ) : (
            <div className="space-y-2">
              {pipeline.stages
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((stage) => (
                  <div key={stage.id} className="flex items-center justify-between gap-3 rounded-md border border-gray-100 px-3 py-2">
                    <span className="text-sm text-gray-700">{stage.name}</span>
                    <div className="flex items-center gap-2">
                      <select
                        value={stage.role ?? ""}
                        onChange={(e) => handleStageRoleChange(stage.id, e.target.value as PipelineStageRole | "")}
                        disabled={savingStageId === stage.id}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-brand focus:outline-none"
                      >
                        <option value="">Nenhum</option>
                        {PIPELINE_STAGE_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {PIPELINE_STAGE_ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
