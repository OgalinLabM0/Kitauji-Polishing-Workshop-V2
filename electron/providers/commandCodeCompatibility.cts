import type { ProviderErrorCode, ProviderProtocol } from './models.cjs';

export const COMMAND_CODE_BASE_URL = 'https://api.commandcode.ai/provider/v1';

const CLAUDE_MODEL = /(?:^|[/:._-])claude(?:$|[/:._-])/iu;
const DEEPSEEK_V4_MODEL = /(?:^|[/:._-])deepseek[-_.]?v4(?:$|[/:._-])/iu;

/** Command Code requires Claude models on Anthropic Messages and all other models on OpenAI Chat. */
export const commandCodeProtocolForModel = (model: string): ProviderProtocol => (
  CLAUDE_MODEL.test(model.trim()) ? 'anthropic-messages' : 'chat-completions'
);

/** Used only to decide whether the upstream may accept native JSON mode. */
export const isCommandCodeDeepSeekModel = (model: string) => DEEPSEEK_V4_MODEL.test(model.trim());

export const isCommandCodeJsonFormatRejection = (
  code: ProviderErrorCode,
  status: number | null,
  message: string,
) => (
  code === 'bad-request' && [400, 422, null].includes(status)
  && /response_format|json_object|json\s*(?:mode|format)|structured\s*output|结构化输出/iu.test(message)
);

/** Keep the provider profile on the single documented Command Code API root. */
export const normalizeCommandCodeBaseUrl = (normalizedBaseUrl: string) => {
  const parsed = new URL(normalizedBaseUrl);
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'commandcode.ai' || hostname === 'www.commandcode.ai') return COMMAND_CODE_BASE_URL;
  if (hostname !== 'api.commandcode.ai') {
    throw new Error('Command Code 服务类型只能使用官方 api.commandcode.ai 地址。');
  }
  if (!['', '/', '/v1', '/provider', '/provider/v1'].includes(parsed.pathname)) {
    throw new Error('Command Code 地址应为 https://api.commandcode.ai/provider/v1。');
  }
  return COMMAND_CODE_BASE_URL;
};
