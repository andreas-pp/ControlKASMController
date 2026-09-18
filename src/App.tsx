import { useState, useEffect, useRef } from 'react';

type ProxyStatus = 'offline' | 'activating' | 'online' | 'terminating';
type Page = 'controller' | 'healthcheck';
type CompStatus = 'healthy' | 'degraded' | 'down' | 'checking';

interface LogEntry {
  time: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'OK';
  msg: string;
}

interface Incident {
  id: string;
  title: string;
  severity: 'P1' | 'P2' | 'P3';
  reportedBy: string;
  openedAt: string;
}

interface Component {
  id: string;
  name: string;
  role: string;
  host: string;
  port: number;
  version: string;
  status: CompStatus;
  latency: number | null;
  uptime: string;
  lastChecked: string;
  detail: string;
}

const PROXY_CONFIG = {
  host: 'kasm-proxy.internal',
  port: 8443,
  node: 'node-03.dc-jkt01',
  version: 'KasmVNC 1.15.0',
};

const ACTIVATE_LOGS: LogEntry[] = [
  { time: '', level: 'INFO', msg: 'Initializing KASM proxy bridge...' },
  { time: '', level: 'INFO', msg: `Binding to ${PROXY_CONFIG.host}:${PROXY_CONFIG.port}` },
  { time: '', level: 'INFO', msg: 'Validating TLS certificates...' },
  { time: '', level: 'INFO', msg: 'Starting KasmVNC reverse proxy on node-03.dc-jkt01' },
  { time: '', level: 'INFO', msg: 'Applying incident access policy: RESTRICTED' },
  { time: '', level: 'OK',   msg: 'KASM proxy online. Incident desktop accessible.' },
];

const TERMINATE_LOGS: LogEntry[] = [
  { time: '', level: 'INFO', msg: 'Termination requested by operator.' },
  { time: '', level: 'WARN', msg: 'Closing all active KASM sessions...' },
  { time: '', level: 'INFO', msg: 'Revoking incident access tokens.' },
  { time: '', level: 'INFO', msg: 'Flushing proxy state on node-03.dc-jkt01' },
  { time: '', level: 'INFO', msg: 'Sending SIGTERM to KasmVNC process.' },
  { time: '', level: 'OK',   msg: 'KASM proxy offline. Incident interface closed.' },
];

const INITIAL_COMPONENTS: Component[] = [
  { id: 'proxy',    name: 'KASM Proxy',          role: 'Reverse Proxy',      host: 'kasm-proxy.internal',   port: 8443,  version: 'KasmVNC 1.15.0',  status: 'checking', latency: null, uptime: '99.98%', lastChecked: '--', detail: 'TLS reverse proxy gateway for VNC sessions' },
  { id: 'api',      name: 'KASM API Server',      role: 'REST API',           host: 'kasm-api.internal',     port: 8080,  version: 'KASM 1.15.0',      status: 'checking', latency: null, uptime: '99.95%', lastChecked: '--', detail: 'Core API handling session management and auth' },
  { id: 'db',       name: 'PostgreSQL',           role: 'Primary Database',   host: 'kasm-db-01.internal',   port: 5432,  version: 'PostgreSQL 15.4',  status: 'checking', latency: null, uptime: '99.99%', lastChecked: '--', detail: 'Stores session state, user records, audit logs' },
  { id: 'redis',    name: 'Redis Cache',          role: 'Session Cache',      host: 'kasm-redis.internal',   port: 6379,  version: 'Redis 7.2',        status: 'checking', latency: null, uptime: '99.97%', lastChecked: '--', detail: 'Ephemeral session tokens and rate limiting data' },
  { id: 'agent1',   name: 'Agent node-01',        role: 'Container Agent',    host: 'kasm-node-01.dc-jkt01', port: 4902,  version: 'Agent 1.15.0',     status: 'checking', latency: null, uptime: '100%',   lastChecked: '--', detail: 'Spawns and manages KasmVNC containers' },
  { id: 'agent2',   name: 'Agent node-02',        role: 'Container Agent',    host: 'kasm-node-02.dc-jkt01', port: 4902,  version: 'Agent 1.15.0',     status: 'checking', latency: null, uptime: '99.91%', lastChecked: '--', detail: 'Spawns and manages KasmVNC containers' },
  { id: 'agent3',   name: 'Agent node-03',        role: 'Container Agent',    host: 'kasm-node-03.dc-jkt01', port: 4902,  version: 'Agent 1.15.0',     status: 'checking', latency: null, uptime: '99.88%', lastChecked: '--', detail: 'Active proxy node — currently assigned' },
  { id: 'manager',  name: 'Container Manager',    role: 'Orchestrator',       host: 'kasm-mgr.internal',     port: 8181,  version: 'KASM 1.15.0',      status: 'checking', latency: null, uptime: '99.96%', lastChecked: '--', detail: 'Schedules containers across agent nodes' },
  { id: 'auth',     name: 'Auth Service',         role: 'Identity Provider',  host: 'kasm-auth.internal',    port: 443,   version: 'SAML 2.0 / LDAP',  status: 'checking', latency: null, uptime: '99.99%', lastChecked: '--', detail: 'SSO and LDAP authentication gateway' },
  { id: 'storage',  name: 'Persistent Storage',   role: 'Volume Driver',      host: 'kasm-nfs.internal',     port: 2049,  version: 'NFS 4.1',          status: 'checking', latency: null, uptime: '99.93%', lastChecked: '--', detail: 'Shared workspace volumes for desktop sessions' },
  { id: 'logging',  name: 'Log Aggregator',       role: 'Audit & Logging',    host: 'kasm-log.internal',     port: 9200,  version: 'Loki 2.9',         status: 'checking', latency: null, uptime: '98.70%', lastChecked: '--', detail: 'Centralized logging and compliance audit trail' },
  { id: 'monitor',  name: 'Health Monitor',       role: 'Watchdog',           host: 'kasm-mon.internal',     port: 9090,  version: 'Prometheus 2.47',  status: 'checking', latency: null, uptime: '99.80%', lastChecked: '--', detail: 'System metrics collection and alerting' },
];

// Simulated health outcomes per component
const OUTCOMES: Record<string, { status: CompStatus; latency: number }> = {
  proxy:   { status: 'healthy',  latency: 4  },
  api:     { status: 'healthy',  latency: 11 },
  db:      { status: 'healthy',  latency: 2  },
  redis:   { status: 'healthy',  latency: 1  },
  agent1:  { status: 'healthy',  latency: 8  },
  agent2:  { status: 'degraded', latency: 210 },
  agent3:  { status: 'healthy',  latency: 7  },
  manager: { status: 'healthy',  latency: 14 },
  auth:    { status: 'healthy',  latency: 22 },
  storage: { status: 'healthy',  latency: 18 },
  logging: { status: 'down',     latency: 0  },
  monitor: { status: 'healthy',  latency: 6  },
};

function nowTime() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

const SAMPLE_INCIDENT: Incident = {
  id: 'INC-20260918-047',
  title: 'Database cluster failover — prod-db-01',
  severity: 'P1',
  reportedBy: 'monitoring@corp.id',
  openedAt: '09:14:03',
};

export default function App() {
  const [page, setPage] = useState<Page>('controller');
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus>('offline');
  const [incident] = useState<Incident>(SAMPLE_INCIDENT);
  const [uptime, setUptime] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const uptimeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transitionRef = useRef(false);

  // Health check state
  const [components, setComponents] = useState<Component[]>(INITIAL_COMPONENTS);
  const [checking, setChecking] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);

  useEffect(() => {
    if (proxyStatus === 'online') {
      uptimeRef.current = setInterval(() => setUptime(u => u + 1), 1000);
    } else {
      if (uptimeRef.current) clearInterval(uptimeRef.current);
      if (proxyStatus === 'offline') setUptime(0);
    }
    return () => { if (uptimeRef.current) clearInterval(uptimeRef.current); };
  }, [proxyStatus]);

  function streamLogs(lines: LogEntry[], onDone: () => void) {
    if (transitionRef.current) return;
    transitionRef.current = true;
    let i = 0;
    const iv = setInterval(() => {
      setLogs(prev => [...prev, { ...lines[i], time: nowTime() }]);
      i++;
      if (i >= lines.length) {
        clearInterval(iv);
        setTimeout(() => { transitionRef.current = false; onDone(); }, 400);
      }
    }, 480);
  }

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  function handleActivate() {
    if (proxyStatus !== 'offline') return;
    setProxyStatus('activating');
    streamLogs(ACTIVATE_LOGS, () => setProxyStatus('online'));
  }

  function handleTerminate() {
    if (proxyStatus !== 'online') return;
    setProxyStatus('terminating');
    streamLogs(TERMINATE_LOGS, () => setProxyStatus('offline'));
  }

  function runHealthCheck() {
    if (checking) return;
    setChecking(true);
    setComponents(prev => prev.map(c => ({ ...c, status: 'checking', latency: null })));

    // Stagger results per component
    INITIAL_COMPONENTS.forEach((comp, idx) => {
      setTimeout(() => {
        const result = OUTCOMES[comp.id];
        setComponents(prev => prev.map(c =>
          c.id === comp.id
            ? { ...c, status: result.status, latency: result.latency, lastChecked: nowTime() }
            : c
        ));
        if (idx === INITIAL_COMPONENTS.length - 1) {
          setChecking(false);
          setLastScan(nowTime());
        }
      }, 300 + idx * 220);
    });
  }

  const fmt = (s: number) => {
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${sec}`;
  };

  const statusMeta: Record<ProxyStatus, { label: string; dot: string; text: string }> = {
    offline:     { label: 'OFFLINE',     dot: 'bg-[#6e7681]',               text: 'text-[#6e7681]' },
    activating:  { label: 'ACTIVATING',  dot: 'bg-[#d29922] animate-pulse', text: 'text-[#d29922]' },
    online:      { label: 'ONLINE',      dot: 'bg-[#3fb950] animate-pulse', text: 'text-[#3fb950]' },
    terminating: { label: 'TERMINATING', dot: 'bg-[#da3633] animate-pulse', text: 'text-[#da3633]' },
  };

  const severityColor: Record<Incident['severity'], string> = {
    P1: 'text-[#f85149] border-[#da3633]/40 bg-[#da3633]/10',
    P2: 'text-[#d29922] border-[#d29922]/40 bg-[#d29922]/10',
    P3: 'text-[#3fb950] border-[#3fb950]/40 bg-[#3fb950]/10',
  };

  const levelColor: Record<LogEntry['level'], string> = {
    INFO: 'text-[#8b949e]', WARN: 'text-[#d29922]',
    ERROR: 'text-[#f85149]', OK: 'text-[#3fb950]',
  };

  const sm = statusMeta[proxyStatus];
  const canActivate  = proxyStatus === 'offline';
  const canTerminate = proxyStatus === 'online';

  const healthy  = components.filter(c => c.status === 'healthy').length;
  const degraded = components.filter(c => c.status === 'degraded').length;
  const down     = components.filter(c => c.status === 'down').length;
  const total    = components.length;

  return (
    <div className="min-h-screen bg-[#080c10] text-[#c9d1d9] font-sans">
      {/* Top bar */}
      <header className="border-b border-[#21262d] px-6 lg:px-10 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-[3px] bg-[#da3633] flex items-center justify-center shrink-0">
            <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 16 16">
              <path d="M8 1L1 14h14L8 1zm0 4l4.5 8h-9L8 5z" />
            </svg>
          </div>
          <div>
            <p className="font-mono text-xs font-bold text-[#e6edf3] leading-none tracking-wider">UIRP</p>
            <p className="font-mono text-[9px] text-[#6e7681] tracking-widest leading-none mt-0.5">URGENT INCIDENT RESPONSE PLATFORM</p>
          </div>
        </div>

        {/* Nav tabs */}
        <nav className="flex items-center gap-1">
          {([['controller', 'Controller'], ['healthcheck', 'Health Check']] as [Page, string][]).map(([p, label]) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`font-mono text-xs px-3 py-1.5 rounded-[3px] transition-colors tracking-wide
                ${page === p
                  ? 'bg-[#21262d] text-[#e6edf3]'
                  : 'text-[#6e7681] hover:text-[#c9d1d9] hover:bg-[#161b22]'
                }`}
            >
              {label}
              {p === 'healthcheck' && down > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[#da3633] text-white text-[9px] font-bold">
                  {down}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${sm.dot}`} />
            <span className={`font-mono text-[10px] font-semibold tracking-widest uppercase ${sm.text}`}>
              KASM — {sm.label}
            </span>
          </div>
        </div>
      </header>

      {/* Pages */}
      {page === 'controller' && (
        <ControllerPage
          proxyStatus={proxyStatus}
          incident={incident}
          uptime={uptime}
          logs={logs}
          logRef={logRef}
          canActivate={canActivate}
          canTerminate={canTerminate}
          handleActivate={handleActivate}
          handleTerminate={handleTerminate}
          fmt={fmt}
          statusMeta={statusMeta}
          severityColor={severityColor}
          levelColor={levelColor}
        />
      )}

      {page === 'healthcheck' && (
        <HealthCheckPage
          components={components}
          checking={checking}
          lastScan={lastScan}
          healthy={healthy}
          degraded={degraded}
          down={down}
          total={total}
          runHealthCheck={runHealthCheck}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────── Controller Page */

function ControllerPage({ proxyStatus, incident, uptime, logs, logRef, canActivate, canTerminate,
  handleActivate, handleTerminate, fmt, statusMeta, severityColor, levelColor }: {
  proxyStatus: ProxyStatus;
  incident: Incident;
  uptime: number;
  logs: LogEntry[];
  logRef: React.RefObject<HTMLDivElement | null>;
  canActivate: boolean;
  canTerminate: boolean;
  handleActivate: () => void;
  handleTerminate: () => void;
  fmt: (s: number) => string;
  statusMeta: Record<ProxyStatus, { label: string; dot: string; text: string }>;
  severityColor: Record<Incident['severity'], string>;
  levelColor: Record<LogEntry['level'], string>;
}) {
  const [localLogs, setLocalLogs] = useState(logs);
  useEffect(() => { setLocalLogs(logs); }, [logs]);

  const severityColorFn = severityColor[incident.severity];

  return (
    <main className="px-6 lg:px-10 py-7">
      <div className="mb-6 border border-[#da3633]/30 bg-[#da3633]/5 rounded-[4px] px-5 py-4 flex items-start gap-4">
        <svg className="w-4 h-4 text-[#f85149] shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 16 16">
          <path d="M8 1L1 14h14L8 1zm0 4l4.5 8h-9L8 5z" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-[3px] border ${severityColorFn}`}>
              {incident.severity}
            </span>
            <span className="font-mono text-xs text-[#6e7681]">{incident.id}</span>
            <span className="font-mono text-[10px] text-[#6e7681]">opened {incident.openedAt}</span>
          </div>
          <p className="font-mono text-sm text-[#e6edf3] font-medium mt-1.5">{incident.title}</p>
          <p className="font-mono text-[10px] text-[#6e7681] mt-0.5">Reported by: {incident.reportedBy}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="flex flex-col gap-5">
          <div className="bg-[#0d1117] border border-[#21262d] rounded-[4px] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#21262d] flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-[#6e7681]" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
                <circle cx="8" cy="8" r="6" /><path d="M8 4v4l3 2" strokeLinecap="round" />
              </svg>
              <span className="font-mono text-xs text-[#8b949e] uppercase tracking-widest">KASM Proxy Configuration</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4">
              {[
                { label: 'Host',    val: PROXY_CONFIG.host },
                { label: 'Port',    val: `:${PROXY_CONFIG.port}` },
                { label: 'Node',    val: PROXY_CONFIG.node },
                { label: 'Version', val: PROXY_CONFIG.version },
              ].map(({ label, val }) => (
                <div key={label} className="px-4 py-3.5 border-b border-r border-[#21262d] last:border-r-0">
                  <p className="font-mono text-[10px] text-[#6e7681] uppercase tracking-widest mb-1">{label}</p>
                  <p className="font-mono text-xs text-[#e6edf3] truncate">{val}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <MetricTile label="Proxy Uptime"  value={proxyStatus === 'online' ? fmt(uptime) : '--:--:--'} active={proxyStatus === 'online'} />
            <MetricTile label="Incident ID"   value={incident.id} active />
            <MetricTile label="Access Mode"   value={proxyStatus === 'online' ? 'RESTRICTED' : 'CLOSED'}
              valueColor={proxyStatus === 'online' ? 'text-[#d29922]' : 'text-[#6e7681]'} active={proxyStatus === 'online'} />
          </div>

          <div className="bg-[#0d1117] border border-[#21262d] rounded-[4px]">
            <div className="px-4 py-3 border-b border-[#21262d] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-[#6e7681]" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
                  <path d="M2 4h12M2 8h8M2 12h5" strokeLinecap="round" />
                </svg>
                <span className="font-mono text-xs text-[#8b949e] uppercase tracking-widest">Proxy Event Log</span>
              </div>
              <button onClick={() => setLocalLogs([])} className="font-mono text-[10px] text-[#6e7681] hover:text-[#c9d1d9] transition-colors uppercase tracking-widest">Clear</button>
            </div>
            <div ref={logRef} className="h-52 overflow-y-auto p-4 space-y-1.5">
              {logs.length === 0 ? (
                <p className="font-mono text-xs text-[#3c444d]">— awaiting proxy events —</p>
              ) : (
                logs.map((e, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="font-mono text-[10px] text-[#3c444d] shrink-0 mt-0.5 w-16">{e.time}</span>
                    <span className={`font-mono text-[10px] uppercase shrink-0 mt-0.5 w-9 font-semibold ${levelColor[e.level]}`}>{e.level}</span>
                    <span className="font-mono text-xs text-[#8b949e] leading-tight">{e.msg}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="bg-[#0d1117] border border-[#21262d] rounded-[4px] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#21262d]">
              <span className="font-mono text-xs text-[#8b949e] uppercase tracking-widest">Proxy Controls</span>
            </div>
            <div className="p-5 flex flex-col gap-3">
              <button onClick={handleActivate} disabled={!canActivate}
                className={`w-full py-3.5 px-4 rounded-[4px] font-mono text-sm font-bold tracking-wide flex items-center justify-center gap-2.5 transition-all duration-150
                  ${canActivate ? 'bg-[#238636] hover:bg-[#2ea043] text-white cursor-pointer active:scale-[0.98] border border-[#3fb950]/30'
                    : 'bg-[#161b22] text-[#3c444d] cursor-not-allowed border border-[#21262d]'}`}>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-1 4l5 3-5 3V5z" /></svg>
                Activate KASM Proxy
              </button>
              <button onClick={handleTerminate} disabled={!canTerminate}
                className={`w-full py-3.5 px-4 rounded-[4px] font-mono text-sm font-bold tracking-wide flex items-center justify-center gap-2.5 transition-all duration-150
                  ${canTerminate ? 'bg-[#21262d] hover:bg-[#da3633] text-[#f85149] hover:text-white cursor-pointer active:scale-[0.98] border border-[#da3633]/50 hover:border-[#da3633]'
                    : 'bg-[#161b22] text-[#3c444d] cursor-not-allowed border border-[#21262d]'}`}>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1" /></svg>
                Terminate KASM Proxy
              </button>
              <div className="w-full h-0.5 bg-[#161b22] rounded-full overflow-hidden mt-1">
                <div className={`h-full rounded-full transition-all duration-[3200ms] ease-linear ${
                  proxyStatus === 'online' ? 'w-full bg-[#3fb950]' :
                  proxyStatus === 'activating' ? 'w-3/4 bg-[#d29922]' :
                  proxyStatus === 'terminating' ? 'w-1/4 bg-[#da3633]' : 'w-0'}`} />
              </div>
            </div>
          </div>

          <div className="bg-[#0d1117] border border-[#21262d] rounded-[4px] p-4">
            <p className="font-mono text-[10px] text-[#6e7681] uppercase tracking-widest mb-2">Usage Policy</p>
            <p className="font-mono text-[11px] text-[#8b949e] leading-relaxed">
              KASM proxy must be activated <span className="text-[#e6edf3]">only during active IT incidents</span>. Terminate immediately upon resolution. All access is logged and audited.
            </p>
          </div>

          <div className={`bg-[#0d1117] border rounded-[4px] overflow-hidden transition-all duration-300 ${
            proxyStatus === 'online' ? 'border-[#3fb950]/30 opacity-100' : 'border-[#21262d] opacity-40'}`}>
            <div className="px-4 py-3 border-b border-[#21262d]">
              <span className="font-mono text-xs text-[#8b949e] uppercase tracking-widest">Incident Desktop</span>
            </div>
            <div className="p-4">
              <p className="font-mono text-[10px] text-[#6e7681] mb-2">Proxy endpoint</p>
              <p className="font-mono text-xs text-[#3fb950] break-all">https://{PROXY_CONFIG.host}:{PROXY_CONFIG.port}</p>
              <button disabled={proxyStatus !== 'online'}
                className={`mt-3 w-full py-2 px-3 rounded-[3px] font-mono text-xs transition-all duration-150 border
                  ${proxyStatus === 'online' ? 'border-[#3fb950]/30 text-[#3fb950] hover:bg-[#3fb950]/10 cursor-pointer'
                    : 'border-[#21262d] text-[#3c444d] cursor-not-allowed'}`}>
                Open Incident Interface ↗
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

/* ──────────────────────────────────────────── Health Check Page */

const compStatusMeta: Record<CompStatus, { label: string; dot: string; text: string; bg: string; border: string }> = {
  healthy:  { label: 'HEALTHY',  dot: 'bg-[#3fb950]',               text: 'text-[#3fb950]', bg: 'bg-[#3fb950]/8',  border: 'border-[#3fb950]/20' },
  degraded: { label: 'DEGRADED', dot: 'bg-[#d29922] animate-pulse', text: 'text-[#d29922]', bg: 'bg-[#d29922]/8',  border: 'border-[#d29922]/25' },
  down:     { label: 'DOWN',     dot: 'bg-[#da3633] animate-pulse', text: 'text-[#f85149]', bg: 'bg-[#da3633]/8',  border: 'border-[#da3633]/30' },
  checking: { label: 'CHECKING', dot: 'bg-[#6e7681] animate-pulse', text: 'text-[#6e7681]', bg: 'bg-transparent',  border: 'border-[#21262d]' },
};

function HealthCheckPage({ components, checking, lastScan, healthy, degraded, down, total, runHealthCheck }: {
  components: Component[];
  checking: boolean;
  lastScan: string | null;
  healthy: number;
  degraded: number;
  down: number;
  total: number;
  runHealthCheck: () => void;
}) {
  const overallOk = !checking && down === 0 && degraded === 0 && components.every(c => c.status !== 'checking');

  return (
    <main className="px-6 lg:px-10 py-7">
      {/* Summary bar */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-6">
          <div>
            <p className="font-mono text-[10px] text-[#6e7681] uppercase tracking-widest mb-1">Overall</p>
            <p className={`font-mono text-sm font-bold ${overallOk ? 'text-[#3fb950]' : down > 0 ? 'text-[#f85149]' : 'text-[#d29922]'}`}>
              {checking ? 'SCANNING...' : overallOk ? 'ALL SYSTEMS GO' : down > 0 ? 'INCIDENT DETECTED' : 'DEGRADED'}
            </p>
          </div>
          <div className="w-px h-8 bg-[#21262d]" />
          <div className="flex items-center gap-5">
            <Stat label="Healthy"  value={healthy}  color="text-[#3fb950]" />
            <Stat label="Degraded" value={degraded} color="text-[#d29922]" />
            <Stat label="Down"     value={down}     color="text-[#f85149]" />
            <Stat label="Total"    value={total}    color="text-[#8b949e]" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastScan && (
            <span className="font-mono text-[10px] text-[#6e7681]">Last scan: {lastScan}</span>
          )}
          <button
            onClick={runHealthCheck}
            disabled={checking}
            className={`flex items-center gap-2 px-4 py-2 rounded-[4px] font-mono text-xs font-semibold tracking-wide transition-all duration-150 border
              ${checking
                ? 'bg-[#161b22] text-[#3c444d] cursor-not-allowed border-[#21262d]'
                : 'bg-[#21262d] hover:bg-[#1f6feb] text-[#c9d1d9] hover:text-white cursor-pointer border-[#30363d] hover:border-[#1f6feb]'
              }`}
          >
            <svg className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.8}>
              <path d="M13.5 8A5.5 5.5 0 112.5 8" strokeLinecap="round" />
              <path d="M13.5 4v4h-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {checking ? 'Scanning...' : 'Run Health Check'}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {checking && (
        <div className="mb-5 w-full h-0.5 bg-[#161b22] rounded-full overflow-hidden">
          <div className="h-full bg-[#1f6feb] rounded-full animate-pulse w-2/3 transition-all duration-700" />
        </div>
      )}

      {/* Component grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {components.map(comp => {
          const m = compStatusMeta[comp.status];
          return (
            <div key={comp.id} className={`bg-[#0d1117] border rounded-[4px] overflow-hidden transition-all duration-300 ${m.border}`}>
              {/* Card header */}
              <div className="px-4 py-3 border-b border-[#21262d] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.dot}`} />
                  <span className="font-mono text-xs text-[#e6edf3] font-semibold truncate">{comp.name}</span>
                </div>
                <span className={`font-mono text-[10px] font-bold uppercase tracking-widest shrink-0 ${m.text}`}>
                  {m.label}
                </span>
              </div>

              {/* Body */}
              <div className="px-4 py-3 space-y-2.5">
                <p className="font-mono text-[10px] text-[#6e7681] leading-relaxed">{comp.detail}</p>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1">
                  <Field label="Role"    val={comp.role} />
                  <Field label="Host"    val={comp.host.split('.')[0]} />
                  <Field label="Port"    val={`:${comp.port}`} />
                  <Field label="Version" val={comp.version.split(' ').slice(0, 2).join(' ')} />
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-[#21262d]">
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-mono text-[9px] text-[#6e7681] uppercase tracking-widest">Latency</p>
                      <p className={`font-mono text-xs font-semibold ${
                        comp.latency === null ? 'text-[#6e7681]' :
                        comp.latency === 0    ? 'text-[#f85149]' :
                        comp.latency > 100    ? 'text-[#d29922]' : 'text-[#3fb950]'
                      }`}>
                        {comp.latency === null ? '—' : comp.latency === 0 ? 'timeout' : `${comp.latency} ms`}
                      </p>
                    </div>
                    <div>
                      <p className="font-mono text-[9px] text-[#6e7681] uppercase tracking-widest">Uptime</p>
                      <p className="font-mono text-xs text-[#8b949e]">{comp.uptime}</p>
                    </div>
                  </div>
                  <p className="font-mono text-[9px] text-[#3c444d]">{comp.lastChecked !== '--' ? `@ ${comp.lastChecked}` : '—'}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}

/* ──────────────────────────────────────────── Shared */

function MetricTile({ label, value, active, valueColor }: {
  label: string; value: string; active?: boolean; valueColor?: string;
}) {
  return (
    <div className={`bg-[#0d1117] border border-[#21262d] rounded-[4px] px-4 py-3.5 transition-opacity duration-300 ${active ? 'opacity-100' : 'opacity-50'}`}>
      <p className="font-mono text-[10px] text-[#6e7681] uppercase tracking-widest mb-1.5">{label}</p>
      <p className={`font-mono text-xs font-semibold truncate ${valueColor ?? 'text-[#e6edf3]'}`}>{value}</p>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] text-[#6e7681] uppercase tracking-widest">{label}</p>
      <p className={`font-mono text-xl font-bold leading-tight ${color}`}>{value}</p>
    </div>
  );
}

function Field({ label, val }: { label: string; val: string }) {
  return (
    <div>
      <p className="font-mono text-[9px] text-[#6e7681] uppercase tracking-widest">{label}</p>
      <p className="font-mono text-[10px] text-[#8b949e] truncate">{val}</p>
    </div>
  );
}
