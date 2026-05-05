import { useEffect, useState } from 'react';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandSeparator } from 'cmdk';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { FileText, ClipboardList, Layers, Map, CheckSquare, RefreshCw, CheckCircle, Zap } from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';

interface CommandAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  group: 'navigate' | 'action';
  onSelect: () => void;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const approveAllEpics = useProjectStore((s) => s.approveAllEpics);

  const handleClose = () => setOpen(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const demoProjectId = 'proj-1';

  const navActions: CommandAction[] = [
    {
      id: 'goto-projects',
      label: 'Go to All Projects',
      icon: <FileText size={14} />,
      group: 'navigate',
      onSelect: () => { navigate('/projects'); handleClose(); },
    },
    {
      id: 'goto-brief',
      label: 'Go to Brief',
      icon: <ClipboardList size={14} />,
      group: 'navigate',
      onSelect: () => { navigate(`/projects/${demoProjectId}/brief`); handleClose(); },
    },
    {
      id: 'goto-epics',
      label: 'Go to Epics',
      icon: <Layers size={14} />,
      group: 'navigate',
      onSelect: () => { navigate(`/projects/${demoProjectId}/epics`); handleClose(); },
    },
    {
      id: 'goto-journeys',
      label: 'Go to Journeys',
      icon: <Map size={14} />,
      group: 'navigate',
      onSelect: () => { navigate(`/projects/${demoProjectId}/journeys`); handleClose(); },
    },
    {
      id: 'goto-tasks',
      label: 'Go to Tasks',
      icon: <CheckSquare size={14} />,
      group: 'navigate',
      onSelect: () => { navigate(`/projects/${demoProjectId}/tasks`); handleClose(); },
    },
    {
      id: 'goto-sync',
      label: 'Go to Sync Dashboard',
      icon: <RefreshCw size={14} />,
      group: 'navigate',
      onSelect: () => { navigate(`/projects/${demoProjectId}/sync`); handleClose(); },
    },
  ];

  const actionCommands: CommandAction[] = [
    {
      id: 'approve-all-epics',
      label: 'Approve All Epics',
      icon: <CheckCircle size={14} />,
      group: 'action',
      onSelect: () => { approveAllEpics(); handleClose(); },
    },
    {
      id: 'approve-all-journeys',
      label: 'Approve All Journeys',
      icon: <CheckCircle size={14} />,
      group: 'action',
      onSelect: () => { handleClose(); },
    },
    {
      id: 'sync-clickup',
      label: 'Sync to ClickUp',
      icon: <Zap size={14} />,
      group: 'action',
      onSelect: () => { navigate(`/projects/${demoProjectId}/sync`); handleClose(); },
    },
  ];

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: -8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: -8 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="w-full max-w-[560px] mx-4"
                >
                  <Dialog.Title className="sr-only">Command Palette</Dialog.Title>
                  <Command
                    className="rounded-xl shadow-2xl shadow-black/60 overflow-hidden"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                    loop
                  >
                    <div className="flex items-center px-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <CommandInput
                        placeholder="Type a command or search..."
                        className="flex h-12 w-full bg-transparent py-3 text-sm outline-none placeholder:opacity-50"
                        style={{ color: 'var(--text-primary)' }}
                      />
                    </div>
                    <CommandList className="max-h-80 overflow-y-auto p-2">
                      <CommandEmpty className="py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                        No results found.
                      </CommandEmpty>
                      <CommandGroup
                        heading="Navigate"
                        className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
                        style={{ '--group-heading-color': 'var(--text-muted)' } as React.CSSProperties}
                      >
                        {navActions.map((action) => (
                          <CommandItem
                            key={action.id}
                            value={action.label}
                            onSelect={action.onSelect}
                            className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm cursor-pointer transition-colors outline-none aria-selected:bg-white/5 hover:bg-white/5"
                            style={{ color: 'var(--text-secondary)' }}
                          >
                            <span style={{ color: 'var(--text-dim)' }}>{action.icon}</span>
                            {action.label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                      <CommandSeparator className="my-2 h-px" style={{ background: 'var(--border-subtle)' }} />
                      <CommandGroup
                        heading="Actions"
                        className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
                      >
                        {actionCommands.map((action) => (
                          <CommandItem
                            key={action.id}
                            value={action.label}
                            onSelect={action.onSelect}
                            className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm cursor-pointer transition-colors outline-none aria-selected:bg-white/5 hover:bg-white/5"
                            style={{ color: 'var(--text-secondary)' }}
                          >
                            <span className="text-violet-400">{action.icon}</span>
                            {action.label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                    <div className="px-3 py-2 flex items-center gap-3 text-[10px]" style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                      <span><kbd className="font-mono rounded px-1 py-0.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>↑↓</kbd> navigate</span>
                      <span><kbd className="font-mono rounded px-1 py-0.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>↵</kbd> select</span>
                      <span><kbd className="font-mono rounded px-1 py-0.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>esc</kbd> close</span>
                    </div>
                  </Command>
                </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
