interface ProviderBadgeProps {
  provider: 'anthropic' | 'openai';
}

const PROVIDER_STYLES: Record<ProviderBadgeProps['provider'], string> = {
  anthropic: 'bg-violet-100 text-violet-800 border border-violet-200',
  openai: 'bg-teal-100 text-teal-800 border border-teal-200',
};

const PROVIDER_LABELS: Record<ProviderBadgeProps['provider'], string> = {
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI GPT',
};

export function ProviderBadge({ provider }: ProviderBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${PROVIDER_STYLES[provider]}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {PROVIDER_LABELS[provider]}
    </span>
  );
}
