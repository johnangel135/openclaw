'use strict';

const {
  ANTHROPIC_API_KEY,
  GEMINI_API_KEY,
  OPENAI_API_KEY,
  PROXY_UPSTREAM_TIMEOUT_MS,
} = require('./config');

class ProxyError extends Error {
  constructor(message, { statusCode = 500, errorCode = 'proxy_error', provider = 'unknown', responseBody = null } = {}) {
    super(message);
    this.name = 'ProxyError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.provider = provider;
    this.responseBody = responseBody;
  }
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractTextFromMessageContent(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }

  const parts = [];
  for (const entry of content) {
    if (typeof entry === 'string') {
      parts.push(entry);
      continue;
    }

    if (entry && typeof entry.text === 'string') {
      parts.push(entry.text);
    }
  }

  return parts.join('\n').trim();
}

function normalizeMessages(input, messages) {
  if (Array.isArray(messages) && messages.length > 0) {
    return messages
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
        content: extractTextFromMessageContent(message.content),
      }))
      .filter((message) => message.content.length > 0);
  }

  if (typeof input === 'string' && input.trim().length > 0) {
    return [{ role: 'user', content: input.trim() }];
  }

  return [];
}

function extractUsageFromOpenAI(payload) {
  const usage = payload && payload.usage ? payload.usage : {};
  const inputTokens = asNumber(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = asNumber(usage.completion_tokens ?? usage.output_tokens);
  const totalTokens = asNumber(usage.total_tokens || (inputTokens + outputTokens));

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
}

function extractUsageFromAnthropic(payload) {
  const usage = payload && payload.usage ? payload.usage : {};
  const inputTokens = asNumber(usage.input_tokens);
  const outputTokens = asNumber(usage.output_tokens);
  const totalTokens = asNumber(inputTokens + outputTokens);

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
}

function extractUsageFromGemini(payload) {
  const usage = payload && payload.usageMetadata ? payload.usageMetadata : {};
  const inputTokens = asNumber(usage.promptTokenCount);
  const outputTokens = asNumber(usage.candidatesTokenCount);
  const totalTokens = asNumber(usage.totalTokenCount || (inputTokens + outputTokens));

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
}

function extractAssistantTextFromOpenAI(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.length > 0) {
    return payload.output_text;
  }

  if (Array.isArray(payload?.choices) && payload.choices.length > 0) {
    return extractTextFromMessageContent(payload.choices[0]?.message?.content);
  }

  if (Array.isArray(payload?.output) && payload.output.length > 0) {
    const outputContent = payload.output[0]?.content;
    if (Array.isArray(outputContent)) {
      return outputContent
        .map((item) => item?.text || item?.content?.[0]?.text || '')
        .filter(Boolean)
        .join('\n')
        .trim();
    }
  }

  return '';
}

function extractAssistantTextFromAnthropic(payload) {
  if (!Array.isArray(payload?.content)) {
    return '';
  }

  return payload.content
    .map((entry) => entry?.text || '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractAssistantTextFromGemini(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map((part) => part?.text || '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function parseJsonSafely(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

async function postJson(url, headers, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const rawText = await response.text();
    const jsonBody = rawText ? parseJsonSafely(rawText) : {};

    return {
      ok: response.ok,
      statusCode: response.status,
      body: jsonBody || { raw: rawText },
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new ProxyError('Upstream request timed out', {
        statusCode: 504,
        errorCode: 'upstream_timeout',
      });
    }

    throw new ProxyError(`Upstream request failed: ${error.message}`, {
      statusCode: 502,
      errorCode: 'upstream_unreachable',
    });
  } finally {
    clearTimeout(timer);
  }
}

function inferToOpenAIPayload(inferBody) {
  const model = inferBody.model;
  const messages = normalizeMessages(inferBody.input, inferBody.messages);
  const options = inferBody.options || {};

  return {
    model,
    messages,
    temperature: options.temperature,
    max_tokens: options.max_tokens,
    top_p: options.top_p,
  };
}

function inferToAnthropicPayload(inferBody) {
  const model = inferBody.model;
  const messages = normalizeMessages(inferBody.input, inferBody.messages);
  const options = inferBody.options || {};

  const systemMessages = messages.filter((message) => message.role === 'system');
  const userAssistantMessages = messages.filter((message) => message.role !== 'system');

  return {
    model,
    max_tokens: options.max_tokens || 512,
    temperature: options.temperature,
    system: systemMessages.map((message) => message.content).join('\n\n') || undefined,
    messages: userAssistantMessages.map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    })),
  };
}

function inferToGeminiPayload(inferBody) {
  const model = inferBody.model;
  const messages = normalizeMessages(inferBody.input, inferBody.messages);
  const options = inferBody.options || {};

  return {
    model,
    body: {
      contents: messages.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
      generationConfig: {
        temperature: options.temperature,
        maxOutputTokens: options.max_tokens,
        topP: options.top_p,
      },
    },
  };
}

function mapOpenAIChatToInfer(body) {
  return {
    provider: body.provider || 'openai',
    model: body.model,
    messages: body.messages,
    options: {
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      top_p: body.top_p,
    },
  };
}

function mapOpenAIResponsesToInfer(body) {
  const input = typeof body.input === 'string' ? body.input : undefined;
  const messages = Array.isArray(body.input)
    ? body.input
        .map((entry) => ({
          role: entry.role || 'user',
          content: typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content),
        }))
    : undefined;

  return {
    provider: body.provider || 'openai',
    model: body.model,
    input,
    messages,
    options: {
      temperature: body.temperature,
      max_tokens: body.max_output_tokens,
      top_p: body.top_p,
    },
  };
}

function toOpenAIChatResponse(result) {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    id: `chatcmpl_proxy_${Date.now()}`,
    object: 'chat.completion',
    created: timestamp,
    model: result.model,
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: result.output_text || '',
        },
      },
    ],
    usage: {
      prompt_tokens: result.usage.input_tokens,
      completion_tokens: result.usage.output_tokens,
      total_tokens: result.usage.total_tokens,
    },
  };
}

function toOpenAIResponsesResponse(result) {
  return {
    id: `resp_proxy_${Date.now()}`,
    object: 'response',
    created_at: new Date().toISOString(),
    model: result.model,
    output_text: result.output_text || '',
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: result.output_text || '',
          },
        ],
      },
    ],
    usage: {
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      total_tokens: result.usage.total_tokens,
    },
  };
}

function toErrorCode(payload, fallback) {
  if (payload && typeof payload === 'object') {
    if (typeof payload.error?.code === 'string') {
      return payload.error.code;
    }
    if (typeof payload.code === 'string') {
      return payload.code;
    }
  }
  return fallback;
}

async function invokeInfer(inferBody, timeoutMs = PROXY_UPSTREAM_TIMEOUT_MS) {
  if (!inferBody || typeof inferBody !== 'object') {
    throw new ProxyError('Request body must be a JSON object', {
      statusCode: 400,
      errorCode: 'invalid_request',
    });
  }

  const provider = (inferBody.provider || 'openai').toLowerCase();
  const model = inferBody.model;
  if (!model || typeof model !== 'string') {
    throw new ProxyError('`model` is required', {
      statusCode: 400,
      errorCode: 'missing_model',
      provider,
    });
  }

  if (provider === 'openai') {
    if (!OPENAI_API_KEY) {
      throw new ProxyError('OPENAI_API_KEY is not configured', {
        statusCode: 503,
        errorCode: 'config_missing_openai_api_key',
        provider,
      });
    }

    const payload = inferToOpenAIPayload(inferBody);
    const response = await postJson(
      'https://api.openai.com/v1/chat/completions',
      {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      payload,
      timeoutMs,
    );

    if (!response.ok) {
      throw new ProxyError('OpenAI request failed', {
        statusCode: response.statusCode,
        errorCode: toErrorCode(response.body, 'openai_request_failed'),
        provider,
        responseBody: response.body,
      });
    }

    const usage = extractUsageFromOpenAI(response.body);
    return {
      provider,
      model: response.body.model || model,
      usage,
      output_text: extractAssistantTextFromOpenAI(response.body),
      upstream_status_code: response.statusCode,
      raw_response: response.body,
    };
  }

  if (provider === 'anthropic') {
    if (!ANTHROPIC_API_KEY) {
      throw new ProxyError('ANTHROPIC_API_KEY is not configured', {
        statusCode: 503,
        errorCode: 'config_missing_anthropic_api_key',
        provider,
      });
    }

    const payload = inferToAnthropicPayload(inferBody);
    const response = await postJson(
      'https://api.anthropic.com/v1/messages',
      {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      payload,
      timeoutMs,
    );

    if (!response.ok) {
      throw new ProxyError('Anthropic request failed', {
        statusCode: response.statusCode,
        errorCode: toErrorCode(response.body, 'anthropic_request_failed'),
        provider,
        responseBody: response.body,
      });
    }

    const usage = extractUsageFromAnthropic(response.body);
    return {
      provider,
      model: response.body.model || model,
      usage,
      output_text: extractAssistantTextFromAnthropic(response.body),
      upstream_status_code: response.statusCode,
      raw_response: response.body,
    };
  }

  if (provider === 'gemini') {
    if (!GEMINI_API_KEY) {
      throw new ProxyError('GEMINI_API_KEY is not configured', {
        statusCode: 503,
        errorCode: 'config_missing_gemini_api_key',
        provider,
      });
    }

    const payload = inferToGeminiPayload(inferBody);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(payload.model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const response = await postJson(
      url,
      {
        'Content-Type': 'application/json',
      },
      payload.body,
      timeoutMs,
    );

    if (!response.ok) {
      throw new ProxyError('Gemini request failed', {
        statusCode: response.statusCode,
        errorCode: toErrorCode(response.body, 'gemini_request_failed'),
        provider,
        responseBody: response.body,
      });
    }

    const usage = extractUsageFromGemini(response.body);
    return {
      provider,
      model,
      usage,
      output_text: extractAssistantTextFromGemini(response.body),
      upstream_status_code: response.statusCode,
      raw_response: response.body,
    };
  }

  throw new ProxyError(`Unsupported provider: ${provider}`, {
    statusCode: 400,
    errorCode: 'unsupported_provider',
    provider,
  });
}

module.exports = {
  ProxyError,
  extractUsageFromAnthropic,
  extractUsageFromGemini,
  extractUsageFromOpenAI,
  invokeInfer,
  mapOpenAIChatToInfer,
  mapOpenAIResponsesToInfer,
  toOpenAIChatResponse,
  toOpenAIResponsesResponse,
};
