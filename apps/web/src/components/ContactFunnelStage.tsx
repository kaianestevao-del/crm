import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Stage {
  id: string;
  name: string;
  order: number;
}

export function ContactFunnelStage({ contactId }: { contactId: string }) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [currentStageId, setCurrentStageId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    Promise.all([api.get("/pipelines"), api.get(`/pipelines/contacts/${contactId}/deal`)])
      .then(([pipelinesRes, dealRes]) => {
        if (cancelled) return;
        const pipeline = pipelinesRes.data[0];
        const sortedStages: Stage[] = pipeline
          ? [...pipeline.stages].sort((a: Stage, b: Stage) => a.order - b.order)
          : [];
        setStages(sortedStages);
        setCurrentStageId(dealRes.data?.stageId ?? null);
      })
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  async function handleChange(stageId: string) {
    setCurrentStageId(stageId);
    await api.put(`/pipelines/contacts/${contactId}/deal-stage`, { stageId });
  }

  if (!loaded || stages.length === 0) return null;

  return (
    <select
      value={currentStageId ?? ""}
      onChange={(e) => handleChange(e.target.value)}
      title="Etapa no funil"
      className={`rounded-full border px-2 py-0.5 text-xs focus:outline-none ${
        currentStageId
          ? "border-brand bg-brand/10 text-brand-dark"
          : "border-dashed border-gray-300 bg-white text-gray-500"
      }`}
    >
      <option value="" disabled>
        📊 Funil: selecionar etapa
      </option>
      {stages.map((stage) => (
        <option key={stage.id} value={stage.id}>
          📊 {stage.name}
        </option>
      ))}
    </select>
  );
}
