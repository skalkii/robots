import { useMemo } from 'react';
import type { AgentClient } from '../agent/AgentClient';
import { MockAgent } from '../agent/MockAgent';
import { ClaudeAgent } from '../agent/ClaudeAgent';
import { ServerProxyAgent } from '../agent/ServerProxyAgent';

export type Provider = 'mock' | 'claude' | 'server';

const VALID_PROVIDERS: Provider[] = ['mock', 'claude', 'server'];

/** Read the persisted provider with a defensive check so stale localStorage
 *  values don't lock the agent into an unknown state. */
export function readProvider(raw: string | null): Provider {
  return VALID_PROVIDERS.includes(raw as Provider) ? (raw as Provider) : 'mock';
}

export function useChatAgent(provider: Provider, apiKey: string, proxyEndpoint: string): AgentClient {
  return useMemo(() => {
    if (provider === 'claude' && apiKey) return new ClaudeAgent(apiKey);
    if (provider === 'server' && proxyEndpoint) return new ServerProxyAgent(proxyEndpoint);
    return new MockAgent();
  }, [provider, apiKey, proxyEndpoint]);
}
