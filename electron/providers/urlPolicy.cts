import type { ProviderProtocol } from './models.cjs';

const ENDPOINT_SUFFIX = /\/(?:chat\/completions|responses|messages|models)\/?$/iu;

export const normalizeProviderBaseUrl = (value: string) => {
  const raw = value.trim();
  if (!raw || raw.length > 2_048) throw new Error('服务地址不能为空或过长。');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('服务地址不是有效网址。');
  }
  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalhost)) {
    throw new Error('服务地址必须使用 HTTPS；只有本机服务允许 HTTP。');
  }
  if (parsed.username || parsed.password) throw new Error('服务地址不能包含用户名或密码。');
  if (parsed.search || parsed.hash) throw new Error('服务地址不能包含查询参数或片段。');
  parsed.pathname = parsed.pathname.replace(ENDPOINT_SUFFIX, '').replace(/\/+$/u, '') || '/';
  return parsed.toString().replace(/\/$/u, '');
};

export const endpointForProtocol = (baseUrl: string, protocol: ProviderProtocol) => (
  `${normalizeProviderBaseUrl(baseUrl)}/${protocol === 'chat-completions'
    ? 'chat/completions'
    : protocol === 'anthropic-messages'
      ? 'messages'
      : 'responses'}`
);

export const modelsEndpoint = (baseUrl: string) => `${normalizeProviderBaseUrl(baseUrl)}/models`;
