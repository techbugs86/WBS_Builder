import type { Domain } from '../data/mockData';

interface DomainBadgeProps {
  domain: Domain;
}

const DOMAIN_STYLES: Record<Domain, string> = {
  auth: 'bg-blue-100 text-blue-800 border border-blue-200',
  billing: 'bg-green-100 text-green-800 border border-green-200',
  search: 'bg-orange-100 text-orange-800 border border-orange-200',
  messaging: 'bg-purple-100 text-purple-800 border border-purple-200',
  profile: 'bg-pink-100 text-pink-800 border border-pink-200',
  admin: 'bg-gray-100 text-gray-800 border border-gray-200',
  notifications: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
};

export function DomainBadge({ domain }: DomainBadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${DOMAIN_STYLES[domain]}`}>
      {domain}
    </span>
  );
}
