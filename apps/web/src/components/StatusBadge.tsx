import type { TaskStatus, EpicStatus, JourneyStatus } from '../data/mockData';

type Status = TaskStatus | EpicStatus | JourneyStatus;

interface StatusBadgeProps {
  status: Status;
}

const STATUS_STYLES: Record<Status, string> = {
  pending: 'bg-amber-100 text-amber-800 border border-amber-200',
  approved: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  flagged: 'bg-red-100 text-red-800 border border-red-200',
};

const STATUS_LABELS: Record<Status, string> = {
  pending: 'Pending',
  approved: 'Approved',
  flagged: 'Flagged',
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
