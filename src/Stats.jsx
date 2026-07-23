import React, { useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid, Brush,
} from "recharts";

/* ============================================================
   Estatísticas dos Eventos — gráficos sobre os dados existentes.
   ============================================================ */
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const PALETTE = ["#FF7A3D", "#F5B841", "#7FD4FF", "#9BC98F", "#E8B4FF", "#F09A6A", "#8FD9C9", "#C77DFF"];
const BIGPAL = ["#FF7A3D", "#F5B841", "#7FD4FF", "#9BC98F", "#E8B4FF", "#F09A6A", "#8FD9C9", "#C77DFF",
  "#FFD166", "#5FA8D3", "#EF476F", "#06D6A0", "#B5838D", "#FFB4A2", "#A0C4FF", "#BDB2FF", "#CAFFBF", "#FDFFB6"];
const norm = (t) => String(t || "").trim();

const axis = { stroke: "#3A322A", tick: { fill: "#9C9184", fontSize: 12 } };
const tooltipStyle = { background: "#211C17", border: "1px solid #3A322A", borderRadius: 8, color: "#F0E9DF" };

function Card({ title, children, sub, wide, fullrow }) {
  return (
    <div className={`stat-card ${wide ? "wide" : ""} ${fullrow ? "fullrow" : ""}`}>
      <h4>{title}</h4>
      {sub && <p className="hint" style={{ marginTop: -4 }}>{sub}</p>}
      {children}
    </div>
  );
}

export default function StatsView({ events, members }) {
  const evs = useMemo(() => (events || []).filter((e) => e.dateStart), [events]);

  /* --- por ano --- */
  const byYear = useMemo(() => {
    const m = {};
    evs.forEach((e) => { const y = e.dateStart.slice(0, 4); m[y] = (m[y] || 0) + 1; });
    return Object.keys(m).sort().map((y) => ({ ano: y, eventos: m[y] }));
  }, [evs]);

  /* --- por mês do ano (agregado) --- */
  const byMonth = useMemo(() => {
    const m = Array(12).fill(0);
    evs.forEach((e) => { const mo = Number(e.dateStart.slice(5, 7)) - 1; if (mo >= 0 && mo < 12) m[mo]++; });
    return MESES.map((nome, i) => ({ mes: nome, eventos: m[i] }));
  }, [evs]);

  /* --- presenças médias por ano (eventos concluídos com presenças) --- */
  const attByYear = useMemo(() => {
    const acc = {};
    evs.forEach((e) => {
      const p = Object.values(e.presences || {}).filter(Boolean).length;
      if (!p) return;
      const y = e.dateStart.slice(0, 4);
      (acc[y] = acc[y] || []).push(p);
    });
    return Object.keys(acc).sort().map((y) => ({
      ano: y, media: Math.round((acc[y].reduce((a, b) => a + b, 0) / acc[y].length) * 10) / 10,
    }));
  }, [evs]);

  /* --- locais --- */
  const locCounts = useMemo(() => {
    const m = {};
    evs.forEach((e) => { const l = norm(e.location); if (l) m[l] = (m[l] || 0) + 1; });
    return Object.entries(m).map(([local, n]) => ({ local, n })).sort((a, b) => b.n - a.n);
  }, [evs]);
  const top5 = useMemo(() => locCounts.slice(0, 5).map((x) => x.local), [locCounts]);

  const anos = useMemo(() => [...new Set(evs.map((e) => e.dateStart.slice(0, 4)))].sort(), [evs]);
  const [selLocs, setSelLocs] = useState(null); // null = top5
  const activeLocs = selLocs || top5;

  /* evolução por ano dos locais selecionados */
  const locEvolution = useMemo(() => {
    return anos.map((y) => {
      const row = { ano: y };
      activeLocs.forEach((l) => {
        row[l] = evs.filter((e) => e.dateStart.slice(0, 4) === y && norm(e.location) === l).length;
      });
      return row;
    });
  }, [anos, activeLocs, evs]);

  /* --- presenças por membro ao longo dos anos --- */
  const memPresent = useMemo(
    () => (members || []).filter((m) => evs.some((e) => e.presences?.[m.id])),
    [members, evs]
  );
  const [selMembers, setSelMembers] = useState(null); // null = todos
  const [cumul, setCumul] = useState(false);
  const activeMembers = selMembers || memPresent.map((m) => m.id);
  const memTotals = useMemo(() => {
    const t = {};
    memPresent.forEach((m) => { t[m.id] = evs.filter((e) => e.presences?.[m.id]).length; });
    return t;
  }, [memPresent, evs]);
  const nameOf = (id) => (members.find((m) => m.id === id)?.name || id);
  /* meses com pelo menos uma presença (ignora meses vazios) */
  const meses = useMemo(() => {
    const set = new Set();
    evs.forEach((e) => { if (Object.values(e.presences || {}).some(Boolean)) set.add(e.dateStart.slice(0, 7)); });
    return [...set].sort();
  }, [evs]);
  const fmtMes = (k) => { const [y, m] = k.split("-"); return `${MESES[Number(m) - 1]}/${y.slice(2)}`; };
  const attMemberEvolution = useMemo(() => {
    const running = {};
    return meses.map((k) => {
      const row = { mes: fmtMes(k) };
      activeMembers.forEach((id) => {
        const c = evs.filter((e) => e.dateStart.slice(0, 7) === k && e.presences?.[id]).length;
        running[id] = (running[id] || 0) + c;
        row[nameOf(id)] = cumul ? running[id] : c;
      });
      return row;
    });
  }, [meses, activeMembers, evs, cumul]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalEventos = evs.length;
  const totalConcluidos = evs.filter((e) => Object.values(e.presences || {}).some(Boolean)).length;
  const totalLocais = locCounts.length;
  const semLocal = evs.filter((e) => !norm(e.location)).length;

  if (!evs.length) return <p className="empty">Ainda não há eventos para gerar estatísticas.</p>;

  return (
    <div className="stats">
      <StatsStyle />
      <div className="stat-kpis">
        <div className="kpi"><span className="kpi-n">{totalEventos}</span><span className="kpi-l">Eventos</span></div>
        <div className="kpi"><span className="kpi-n">{totalConcluidos}</span><span className="kpi-l">Com presenças</span></div>
        <div className="kpi"><span className="kpi-n">{totalLocais}</span><span className="kpi-l">Locais distintos</span></div>
        <div className="kpi"><span className="kpi-n">{anos.length}</span><span className="kpi-l">Anos ativos</span></div>
      </div>

        <Card title="Presenças dos membros ao longo do tempo" sub={cumul ? "Total acumulado de presenças, mês a mês" : "Presenças de cada membro em cada mês"} wide fullrow>
          <div className="segmented" style={{ marginBottom: 10 }}>
            <button className={!cumul ? "on" : ""} onClick={() => setCumul(false)}>Por mês</button>
            <button className={cumul ? "on" : ""} onClick={() => setCumul(true)}>Cumulativo</button>
          </div>
          <div className="loc-picker">
            {[...memPresent].sort((a, b) => (memTotals[b.id] || 0) - (memTotals[a.id] || 0)).map((m) => {
              const on = activeMembers.includes(m.id);
              return (
                <button key={m.id} type="button" className={`pill ${on ? "on" : ""}`}
                  onClick={() => {
                    const base = selMembers || memPresent.map((x) => x.id);
                    setSelMembers(on ? base.filter((x) => x !== m.id) : [...base, m.id]);
                  }}>
                  {m.name} ({memTotals[m.id] || 0})
                </button>
              );
            })}
            {selMembers && <button className="btn ghost small" onClick={() => setSelMembers(null)}>Todos</button>}
          </div>
          <ResponsiveContainer width="100%" height={420}>
            <LineChart data={attMemberEvolution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A241E" />
              <XAxis dataKey="mes" {...axis} interval="preserveStartEnd" minTickGap={20} /><YAxis allowDecimals={false} {...axis} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {activeMembers.map((id, i) => (
                <Line key={id} type="monotone" dataKey={nameOf(id)} stroke={BIGPAL[i % BIGPAL.length]} strokeWidth={2} dot={{ r: 2 }} />
              ))}
              <Brush dataKey="mes" height={22} travellerWidth={8} stroke="#FF7A3D" fill="#211C17" />
            </LineChart>
          </ResponsiveContainer>
        </Card>


      <div className="stat-grid">
        <Card title="Eventos por ano">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byYear}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A241E" />
              <XAxis dataKey="ano" {...axis} /><YAxis allowDecimals={false} {...axis} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,122,61,.08)" }} />
              <Bar dataKey="eventos" fill="#FF7A3D" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Distribuição por mês do ano" sub="Somando todos os anos">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={byMonth.filter((d) => d.eventos > 0)} dataKey="eventos" nameKey="mes" outerRadius={90} label={({ name }) => name}>
                {byMonth.filter((d) => d.eventos > 0).map((d, i) => <Cell key={d.mes} fill={PALETTE[i % PALETTE.length]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Top 5 locais" sub="Por número de eventos">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={locCounts.slice(0, 5)} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A241E" />
              <XAxis type="number" allowDecimals={false} {...axis} />
              <YAxis type="category" dataKey="local" width={110} {...axis} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,122,61,.08)" }} />
              <Bar dataKey="n" radius={[0, 4, 4, 0]}>
                {locCounts.slice(0, 5).map((d, i) => <Cell key={d.local} fill={PALETTE[i % PALETTE.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Presenças médias por ano" sub="Média de presentes por evento">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={attByYear}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A241E" />
              <XAxis dataKey="ano" {...axis} /><YAxis allowDecimals={false} {...axis} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="media" stroke="#F5B841" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Evolução dos locais ao longo dos anos" sub="Escolhe os locais a comparar" wide>
          <div className="loc-picker">
            {locCounts.slice(0, 12).map((x, i) => {
              const on = activeLocs.includes(x.local);
              return (
                <button key={x.local} type="button" className={`pill ${on ? "on" : ""}`}
                  style={on ? { borderColor: PALETTE[activeLocs.indexOf(x.local) % PALETTE.length] } : undefined}
                  onClick={() => {
                    const base = selLocs || top5;
                    const next = on ? base.filter((l) => l !== x.local) : [...base, x.local];
                    setSelLocs(next);
                  }}>
                  {x.local} ({x.n})
                </button>
              );
            })}
            {selLocs && <button className="btn ghost small" onClick={() => setSelLocs(null)}>Repor top 5</button>}
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={locEvolution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A241E" />
              <XAxis dataKey="ano" {...axis} /><YAxis allowDecimals={false} {...axis} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {activeLocs.map((l, i) => (
                <Line key={l} type="monotone" dataKey={l} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2.5} dot={{ r: 2 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Card>

      </div>
      {semLocal > 0 && <p className="hint">{semLocal} evento(s) sem localização não entram nos gráficos de locais — associa-os na Gestão › Gestão de eventos.</p>}
    </div>
  );
}

function StatsStyle() {
  return (
    <style>{`
      .stat-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-bottom: 18px; }
      .kpi { background: var(--surface2); border: 1px solid var(--line); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 2px; }
      .kpi-n { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: var(--ember); line-height: 1; }
      .kpi-l { font-size: 12px; color: var(--muted); }
      .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
      .stat-card { background: var(--surface2); border: 1px solid var(--line); border-radius: 12px; padding: 16px 16px 8px; }
      .stat-card h4 { margin: 0 0 8px; }
      .loc-picker { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
      .stat-card.wide { grid-column: span 2; }
      .stat-card.fullrow { width: 100%; margin-bottom: 16px; box-sizing: border-box; }
      @media (max-width: 720px) { .stat-card.wide { grid-column: span 1; } }
    `}</style>
  );
}
