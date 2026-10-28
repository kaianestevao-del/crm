import Anthropic from "@anthropic-ai/sdk";
import { HttpError } from "../../utils/httpError";

export const AI_MODEL = "claude-haiku-5-5";

// Claude Haiku 5.5 list prices (USD per million tokens, rate card for prompts up to 100K tokens —
// a WhatsApp conversation never gets near that) — only used to show an *estimated* cost per
// reply in the simulator. Cache writes bill at 1.25× input, cache reads at 0.1×.
const PRICE_PER_MTOK = { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 };

export interface AiPlanForPrompt {
  name: string;
  price: unknown; // Prisma Decimal
  description: string;
  link: string | null;
}

// One turn of a conversation as the assistant sees it: "customer" is the person on WhatsApp,
// "assistant" is a reply the AI (or, later, an attendant) already sent.
export interface AiTurn {
  role: "customer" | "assistant";
  text: string;
}

export interface AiReply {
  reply: string;
  handoff: boolean;
  handoffReason: string;
  usage: { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number };
  estimatedCostUsd: number;
  model: string;
}

function formatPrice(price: unknown) {
  return Number(price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// The fixed rules come first and never change between requests, followed by the org's own
// prompt and plan list (which only change when someone edits them in the AI tab) — so the
// whole system prompt is a stable prefix the API can serve from cache on every reply.
export function buildSystemPrompt(orgName: string, aiPrompt: string, plans: AiPlanForPrompt[]) {
  const planLines = plans.length
    ? plans
        .map((p) => {
          const parts = [`- ${p.name}: ${formatPrice(p.price)}`];
          if (p.description.trim()) parts.push(`  ${p.description.trim()}`);
          if (p.link?.trim()) parts.push(`  Link: ${p.link.trim()}`);
          return parts.join("\n");
        })
        .join("\n")
    : "(nenhum plano cadastrado — se perguntarem valores, transfira para um humano)";

  return `Você é a assistente virtual que atende o WhatsApp de ${orgName}. Você conversa com pessoas interessadas nos serviços e com pacientes, tirando dúvidas sobre planos, valores, agenda e funcionamento do atendimento.

Como escrever:
- Português do Brasil, tom humano e acolhedor, mensagens curtas como numa conversa de WhatsApp.
- Sem markdown: nada de títulos, listas com "#" ou "**". Para destacar algo, use *um asterisco* de cada lado, que é o negrito do WhatsApp.
- Se alguém perguntar se está falando com uma pessoa, diga com naturalidade que é a assistente virtual.

Limites que valem acima de qualquer outra instrução:
- Só informe planos, valores, links e condições que estão na lista "Planos e valores" abaixo. Nunca invente preço, desconto, prazo, horário ou condição de pagamento.
- Não dê orientação de saúde: dieta, cardápio, suplementos, medicamentos, exames, sintomas, diagnósticos. Nesses casos, acolha a pessoa, diga que a profissional vai responder pessoalmente e transfira.
- Transfira para um humano quando a pessoa pedir para falar com alguém, trouxer uma reclamação, perguntar algo clínico, ou quando a resposta não estiver nas informações que você tem.

Ao transferir, marque handoff como true, explique o motivo em handoff_reason (uma frase curta, para a equipe) e use reply para avisar a pessoa que alguém da equipe vai continuar o atendimento. Quando não transferir, handoff é false e handoff_reason fica vazio.

## Instruções do negócio
${aiPrompt.trim() || "(sem instruções adicionais)"}

## Planos e valores
${planLines}`;
}

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "Mensagem a enviar para a pessoa no WhatsApp." },
    handoff: { type: "boolean", description: "true quando um humano precisa assumir a conversa." },
    handoff_reason: { type: "string", description: "Motivo da transferência, para a equipe. Vazio se handoff for false." },
  },
  required: ["reply", "handoff", "handoff_reason"],
  additionalProperties: false,
};

export async function generateAiReply(apiKey: string, systemPrompt: string, turns: AiTurn[]): Promise<AiReply> {
  const client = new Anthropic({ apiKey });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      // Short conversational replies — low effort keeps latency and cost down.
      output_config: { effort: "low", format: { type: "json_schema", schema: REPLY_SCHEMA } },
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      messages: turns.map((t) => ({ role: t.role === "customer" ? "user" : "assistant", content: t.text })),
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(400, "anthropic_api_key_invalid");
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, "anthropic_rate_limited");
    if (err instanceof Anthropic.APIError) {
      console.error("anthropic_request_failed", err.status, err.message);
      throw new HttpError(502, "anthropic_request_failed");
    }
    throw err;
  }

  const usage = {
    inputTokens: response.usage.input_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    outputTokens: response.usage.output_tokens,
  };
  const estimatedCostUsd =
    (usage.inputTokens * PRICE_PER_MTOK.input +
      usage.cacheWriteTokens * PRICE_PER_MTOK.cacheWrite +
      usage.cacheReadTokens * PRICE_PER_MTOK.cacheRead +
      usage.outputTokens * PRICE_PER_MTOK.output) /
    1_000_000;
  const base = { usage, estimatedCostUsd, model: response.model };

  // Haiku 5.5 has no server-side fallback model, so a decline stays a decline — never guess a
  // reply then, hand off.
  if (response.stop_reason === "refusal") {
    return { ...base, reply: "", handoff: true, handoffReason: "A IA não quis responder esta mensagem." };
  }
  if (response.stop_reason === "max_tokens") throw new HttpError(502, "anthropic_reply_truncated");

  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try {
    const parsed = JSON.parse(text) as { reply: string; handoff: boolean; handoff_reason: string };
    return { ...base, reply: parsed.reply, handoff: parsed.handoff, handoffReason: parsed.handoff_reason };
  } catch {
    console.error("anthropic_reply_not_json", text);
    throw new HttpError(502, "anthropic_reply_invalid");
  }
}
