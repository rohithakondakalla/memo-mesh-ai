// Server-only helper that connects the AI SDK to the Lovable AI Gateway.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const GATEWAY_BASE_URL = "https://ai.gateway.lovable.dev/v1";

export function createLovableAiGatewayProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "lovable-gateway",
    baseURL: GATEWAY_BASE_URL,
    headers: {
      "Lovable-API-Key": apiKey,
    },
  });
}

export const GATEWAY_URL = GATEWAY_BASE_URL;
