import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { shortKes } from '../lib/format.js';

const COLORS = ['#2563eb', '#15803d', '#b45309', '#7c3aed', '#dc2626', '#0891b2', '#db2777', '#65a30d'];

export function TrendChart({ data, dataKey = 'collected', xKey = 'label' }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="fillCollect" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f7" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: '#64708a' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 12, fill: '#64708a' }} axisLine={false} tickLine={false} tickFormatter={shortKes} width={70} />
        <Tooltip formatter={(v) => shortKes(v)} contentStyle={{ borderRadius: 10, border: '1px solid #e5e9f2', fontSize: 13 }} />
        <Area type="monotone" dataKey={dataKey} stroke="#2563eb" strokeWidth={2.5} fill="url(#fillCollect)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BarsChart({ data, xKey, dataKey, color = '#2563eb', formatter }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f7" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: '#64708a' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 12, fill: '#64708a' }} axisLine={false} tickLine={false} tickFormatter={formatter || shortKes} width={70} />
        <Tooltip formatter={formatter || ((v) => shortKes(v))} contentStyle={{ borderRadius: 10, border: '1px solid #e5e9f2', fontSize: 13 }} />
        <Bar dataKey={dataKey} fill={color} radius={[6, 6, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ data, nameKey = 'name', valueKey = 'value' }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey={valueKey} nameKey={nameKey} innerRadius={62} outerRadius={96} paddingAngle={3}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e5e9f2', fontSize: 13 }} />
        <Legend wrapperStyle={{ fontSize: 12.5 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export { COLORS };
