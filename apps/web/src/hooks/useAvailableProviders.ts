import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { AIProvider } from '../constants/enums';

interface SettingInfo { set: boolean }

interface State {
  providers: AIProvider[];
  loading: boolean;
}

/**
 * Returns the AI providers that currently have an API key configured in
 * /admin/settings. Used to decide whether the project-creation pages should
 * render the Anthropic/OpenAI toggle: with 0 or 1 providers, picking is
 * pointless and we hide the control.
 */
export function useAvailableProviders(): State {
  const [state, setState] = useState<State>({ providers: [], loading: true });

  useEffect(() => {
    let cancelled = false;
    api
      .get<Record<string, SettingInfo>>('/admin/settings')
      .then((data) => {
        if (cancelled) return;
        const providers: AIProvider[] = [];
        if (data['anthropic_api_key']?.set) providers.push('anthropic');
        if (data['openai_api_key']?.set) providers.push('openai');
        setState({ providers, loading: false });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ providers: [], loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
