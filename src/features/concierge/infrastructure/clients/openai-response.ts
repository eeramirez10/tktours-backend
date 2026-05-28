import OpenAI from 'openai';

export type ResponsesTextResult = {
  id: string;
  outputText: string;
  raw: OpenAI.Responses.Response;
};

type OpenAiResponsesClientOptions = {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
};

export class OpenAiResponsesClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: OpenAiResponsesClientOptions) {
    const { apiKey, model, timeoutMs } = options;
    this.client = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
    const configuredModel = model?.trim() || process.env.OPENAI_MODEL?.trim();
    this.model = configuredModel && configuredModel.length > 0 ? configuredModel : 'gpt-5.4-nano';
    this.timeoutMs = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000;
  }

  getModel(): string {
    return this.model;
  }

  async createTextResponse(params: {
    instructions: string;
    input: string | Array<Record<string, unknown>>;
    tools?: Array<Record<string, unknown>>;
    previousResponseId?: string;
    timeoutMs?: number;
  }): Promise<ResponsesTextResult> {
    const timeoutMs =
      typeof params.timeoutMs === 'number' && Number.isFinite(params.timeoutMs) && params.timeoutMs > 0
        ? params.timeoutMs
        : this.timeoutMs;
    const controller = new AbortController();
    const timeoutErrorMessage = `OpenAI responses timeout after ${timeoutMs}ms`;
    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        controller.abort();
        reject(new Error(timeoutErrorMessage));
      }, timeoutMs);
    });

    let response: OpenAI.Responses.Response;

    try {
      const requestPromise = this.client.responses.create(
        {
          model: this.model,
          instructions: params.instructions,
          input: params.input as never,
          tools: params.tools as never,
          previous_response_id: params.previousResponseId,
        },
        {
          signal: controller.signal,
        },
      );

      response = await Promise.race([requestPromise, timeoutPromise]);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(timeoutErrorMessage);
      }
      throw error;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }

    return {
      id: response.id,
      outputText: response.output_text ?? '',
      raw: response,
    };
  }
}
