import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Zap, ArrowRight, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';
import { Button } from '../components/ui/button';

const inputCls =
  'w-full px-4 py-3 rounded-xl text-sm placeholder-[var(--text-dim)] focus:outline-none focus:ring-2 focus:ring-violet-500 transition-colors';
const inputStyle = {
  background: 'linear-gradient(135deg, var(--bg-card), var(--bg-card-alt))',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
};

export function LoginPage() {
  const navigate = useNavigate();
  const login = useProjectStore((s) => s.login);
  const authError = useProjectStore((s) => s.authError);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    try {
      // login() throws on failure; only navigate when it resolves successfully.
      // Don't infer success from currentUser (which can be stale from a prior
      // session in localStorage) — that's how we accidentally let bad creds in.
      await login(email, password);
      navigate('/projects', { replace: true });
    } catch {
      // authError is set inside the store; the form below renders it.
    } finally {
      setIsLoading(false);
    }
  }

  function fillDemo(e: React.MouseEvent, demoEmail: string, demoPassword: string) {
    e.preventDefault();
    setEmail(demoEmail);
    setPassword(demoPassword);
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'linear-gradient(180deg, var(--bg-deep) 0%, var(--bg-deep) 100%)' }}
    >
      <motion.div
        className="w-full max-w-sm"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)',
              boxShadow: '0 0 20px rgba(124,58,237,0.5)',
            }}
          >
            <Zap size={16} className="text-white" />
          </div>
          <div>
            <p className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>WBS Builder</p>
            <p className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>by the agency</p>
          </div>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-7"
          style={{
            background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-card-alt) 100%)',
            border: '1px solid var(--border)',
          }}
        >
          <h1 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Sign in</h1>
          <p className="text-xs mb-6" style={{ color: 'var(--text-muted)' }}>Access the WBS pipeline</p>

          {/* autoComplete="off" on the form, plus per-field overrides below,
              prevents browsers from pre-filling saved credentials. We want
              the user to type fresh credentials on every visit. */}
          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
                Email
              </label>
              <input
                type="email"
                name="wbs-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                required
                autoComplete="off"
                className={inputCls}
                style={inputStyle}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="wbs-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  // 'new-password' tells most browsers this is a registration
                  // field, suppressing the saved-password autofill. Trade-off:
                  // browser won't offer to save it after login, but that's OK
                  // for an internal tool with demo creds shown below.
                  autoComplete="new-password"
                  className={inputCls}
                  style={{ ...inputStyle, paddingRight: '2.75rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {authError && (
              <motion.div
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <AlertCircle size={13} />
                {authError}
              </motion.div>
            )}

            <Button type="submit" className="w-full gap-2 mt-2" disabled={isLoading}>
              {isLoading ? 'Signing in…' : 'Sign In'}
              {!isLoading && <ArrowRight size={14} />}
            </Button>
          </form>

          {/* Demo credentials hint */}
          <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: 'var(--text-dim)' }}>Demo credentials</p>
            <div className="space-y-1.5">
              {[
                { label: 'Admin', email: 'admin@wbs.io', password: 'admin123', color: 'var(--accent-text)' },
                { label: 'PM', email: 'pm@wbs.io', password: 'pm123', color: '#60a5fa' },
              ].map((demo) => (
                <button
                  key={demo.email}
                  onClick={(e) => fillDemo(e, demo.email, demo.password)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-all"
                  style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)' }}
                >
                  <span
                    className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                    style={{ color: demo.color, background: `${demo.color}18`, border: `1px solid ${demo.color}30` }}
                  >
                    {demo.label}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>{demo.email}</span>
                  <span style={{ color: 'var(--text-dim)' }}>click to fill</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
